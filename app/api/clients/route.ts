import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { google } from 'googleapis'
import { cachedSheet } from '@/lib/sheets-cache'
import { namesMatch } from '@/lib/name-match'

const SPREADSHEET_ID      = '1057EJCsrTPT7LFHBYqsqYVVERuwgZ7kScmHy8j1Or8s'
const INVOICE_SHEET_ID    = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'
// Count invoices that are confirmed (sent, invoiced, outstanding, due, or any form of paid)
// Excludes drafts, cancelled, void, and pipeline (sales-sent)
function isCountableStatus(status: string): boolean {
  const s = (status || '').toLowerCase().trim()
  return s.includes('paid') || s === 'sent' || s === 'invoiced' || s === 'outstanding' || s === 'due'
}

function parseNum(val: any): number {
  if (!val) return 0
  return parseFloat(val.toString().replace(/[$,\s]/g, '')) || 0
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

// Run once at module load — not on every request
const tablesReady = (async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS holding_companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        holding_company_id INTEGER REFERENCES holding_companies(id) ON DELETE SET NULL,
        distributor TEXT,
        billing_type TEXT NOT NULL DEFAULT 'annual',
        notes TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await query(`
      ALTER TABLE clients
        ADD COLUMN IF NOT EXISTS contract_start DATE,
        ADD COLUMN IF NOT EXISTS contract_end DATE
    `)
    await query(`
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL
    `)
  } catch { /* tables already exist */ }
})()

async function ensureTables() { await tablesReady }

// GET /api/clients — list all clients + holding companies + revenue from outgoing invoices
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureTables()

  const [clientsRes, holdingRes, invRows, cashRes] = await Promise.all([
    query(`
      SELECT c.*, hc.name AS holding_company_name
      FROM clients c
      LEFT JOIN holding_companies hc ON hc.id = c.holding_company_id
      ORDER BY c.name
    `),
    query('SELECT * FROM holding_companies ORDER BY name'),
    // LTV from outgoing invoice sheet — matched by client name (col I) or holding company name
    cachedSheet('invoice-sheet', async () => {
      const sheets = getSheetsClient()
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: INVOICE_SHEET_ID,
        range: 'All time!A2:I500',
      })
      return res.data.values || []
    }).catch(() => []),
    query(`
      SELECT client_id, SUM(amount_usd) AS cash_received
      FROM bank_transactions
      WHERE type = 'revenue' AND client_id IS NOT NULL
      GROUP BY client_id
    `),
  ])

  // Build holding company subsidiary count (active only) for split calculation
  const holdingSubCount: Record<string, number> = {}
  for (const c of clientsRes.rows) {
    if (c.holding_company_name && c.active) {
      const key = c.holding_company_name.toLowerCase().trim()
      holdingSubCount[key] = (holdingSubCount[key] || 0) + 1
    }
  }

  // Compute LTV per client from sheet: match by client name or holding company name
  type LtvEntry = { total: number; count: number; groupTotal: number; groupCount: number }
  const ltvMap: Record<number, LtvEntry> = {}
  const blank = (): LtvEntry => ({ total: 0, count: 0, groupTotal: 0, groupCount: 0 })
  const matchedSheetNames = new Set<string>() // track which sheet names were matched

  // Normalize for HC word matching (same rules as name-match.ts)
  const normalizeWords = (s: string) =>
    s.toLowerCase().replace(/[.,\/#!$%^&*;:{}=_`~()'"]/g, '').split(' ').filter(w => w.length > 1)

  for (const r of (invRows as any[])) {
    const rawName   = ((r[8] || r[1]) || '').trim()
    const sheetName = rawName.toLowerCase()
    const amount    = parseNum(r[5])
    const status    = (r[6] || '').toLowerCase().trim()
    if (!sheetName || !amount || !isCountableStatus(status)) continue

    const sheetWords = normalizeWords(sheetName)

    // Holding company match: ALL words of the HC name must appear in the sheet name.
    // This is directional (HC ⊆ sheet) so "Rayomar Group" won't accidentally match
    // a client named "Rayomar" whose name is a subset of the HC name.
    const matchedHcKeys = new Set<string>()
    for (const c of clientsRes.rows) {
      if (!c.holding_company_name) continue
      const hcKey   = (c.holding_company_name as string).toLowerCase().trim()
      if (matchedHcKeys.has(hcKey)) continue
      const hcWords = normalizeWords(hcKey)
      if (hcWords.length > 0 && hcWords.every(w => sheetWords.includes(w))) {
        matchedHcKeys.add(hcKey)
      }
    }

    if (matchedHcKeys.size > 0) {
      // Holding company invoice — split across ACTIVE subsidiaries only.
      // If all subsidiaries are inactive, the HC match is ignored and we fall
      // through to direct name matching (avoids ghost-split inflation).
      let distributed = false
      for (const hcKey of matchedHcKeys) {
        const subCount = holdingSubCount[hcKey] || 0
        if (subCount === 0) continue  // no active subs for this HC — skip
        const share = amount / subCount
        for (const c of clientsRes.rows) {
          if (!c.active) continue
          if (!c.holding_company_name) continue
          if ((c.holding_company_name as string).toLowerCase().trim() !== hcKey) continue
          if (!ltvMap[c.id]) ltvMap[c.id] = blank()
          ltvMap[c.id].total      += share
          ltvMap[c.id].count      += 1
          ltvMap[c.id].groupTotal += share
          ltvMap[c.id].groupCount += 1
          distributed = true
        }
      }
      if (distributed) {
        matchedSheetNames.add(sheetName)
      } else {
        // All matched HCs had no active subsidiaries — fall through to direct match
        for (const c of clientsRes.rows) {
          if (namesMatch(sheetName, c.name)) {
            matchedSheetNames.add(sheetName)
            if (!ltvMap[c.id]) ltvMap[c.id] = blank()
            ltvMap[c.id].total += amount
            ltvMap[c.id].count += 1
          }
        }
      }
    } else {
      // No HC match — try direct client name match (fuzzy, bidirectional)
      for (const c of clientsRes.rows) {
        if (namesMatch(sheetName, c.name)) {
          matchedSheetNames.add(sheetName)
          if (!ltvMap[c.id]) ltvMap[c.id] = blank()
          ltvMap[c.id].total += amount
          ltvMap[c.id].count += 1
        }
      }
    }
  }

  // Unmatched invoice names — names in the sheet not matched to any client or holding company
  const unmatchedMap: Record<string, { name: string; total: number; count: number; last_date: string }> = {}
  for (const r of (invRows as any[])) {
    const rawName   = ((r[8] || r[1]) || '').trim()
    const sheetName = rawName.toLowerCase()
    if (!rawName || matchedSheetNames.has(sheetName)) continue
    const amount = parseNum(r[5])
    const status = (r[6] || '').toLowerCase().trim()
    if (!amount || !isCountableStatus(status)) continue
    if (!unmatchedMap[sheetName]) unmatchedMap[sheetName] = { name: rawName, total: 0, count: 0, last_date: '' }
    unmatchedMap[sheetName].total += amount
    unmatchedMap[sheetName].count += 1
    const date = (r[4] || '').trim()
    if (date > unmatchedMap[sheetName].last_date) unmatchedMap[sheetName].last_date = date
  }
  const unmatchedNames = Object.values(unmatchedMap).sort((a, b) => b.total - a.total)

  const cashMap: Record<number, number> = {}
  for (const row of cashRes.rows) cashMap[parseInt(row.client_id)] = parseFloat(row.cash_received || 0)

  const clients = clientsRes.rows.map((c: any) => ({
    ...c,
    ltv:                 Math.round(ltvMap[c.id]?.total || 0),
    invoice_count:       ltvMap[c.id]?.count || 0,
    group_invoice_count: ltvMap[c.id]?.groupCount || 0,
    group_ltv:           Math.round(ltvMap[c.id]?.groupTotal || 0),
    cash_received:       cashMap[c.id] || 0,
  }))

  return NextResponse.json({ clients, holdingCompanies: holdingRes.rows, unmatchedNames })
}

// POST /api/clients — create client or holding company
export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureTables()
  const body = await req.json()

  if (body.type === 'holding_company') {
    const res = await query(
      'INSERT INTO holding_companies (name, notes) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET notes=EXCLUDED.notes RETURNING *',
      [body.name, body.notes || null]
    )
    return NextResponse.json({ holdingCompany: res.rows[0] })
  }

  const holdingId    = body.holdingCompanyId ?? body.holding_company_id ?? null
  const billingType  = body.billingType || body.billing_type || 'annual'
  const contractStart = body.contract_start || body.contractStart || null
  const contractEnd   = body.contract_end   || body.contractEnd   || null
  const res = await query(
    `INSERT INTO clients (name, holding_company_id, distributor, billing_type, notes, contract_start, contract_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [body.name, holdingId || null, body.distributor || null, billingType, body.notes || null, contractStart, contractEnd]
  )
  return NextResponse.json({ client: res.rows[0] })
}

// PATCH /api/clients — update client or holding company
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.type === 'holding_company') {
    await query('UPDATE holding_companies SET name=$1, notes=$2 WHERE id=$3', [body.name, body.notes || null, body.id])
    return NextResponse.json({ ok: true })
  }

  const holdingId    = body.holdingCompanyId ?? body.holding_company_id ?? null
  const billingType  = body.billingType || body.billing_type || 'annual'
  const contractStart = body.contract_start || body.contractStart || null
  const contractEnd   = body.contract_end   || body.contractEnd   || null
  await query(
    `UPDATE clients
     SET name=$1, holding_company_id=$2, distributor=$3, billing_type=$4, notes=$5, active=$6,
         contract_start=$7, contract_end=$8, updated_at=NOW()
     WHERE id=$9`,
    [body.name, holdingId || null, body.distributor || null, billingType, body.notes || null, body.active !== false, contractStart, contractEnd, body.id]
  )

  // Sync updated client list to Google Sheet "Clients" tab
  try {
    await syncClientsToSheet()
  } catch (e) {
    console.error('[clients] Sheet sync failed:', e)
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/clients?id=X&type=client|holding_company
export async function DELETE(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id   = searchParams.get('id')
  const type = searchParams.get('type')

  if (type === 'holding_company') {
    await query('DELETE FROM holding_companies WHERE id=$1', [id])
  } else {
    await query('DELETE FROM clients WHERE id=$1', [id])
  }

  return NextResponse.json({ ok: true })
}

async function syncClientsToSheet() {
  const [clientsRes, holdingRes] = await Promise.all([
    query(`SELECT c.*, hc.name AS holding_company_name FROM clients c LEFT JOIN holding_companies hc ON hc.id=c.holding_company_id ORDER BY c.name`),
    query('SELECT * FROM holding_companies ORDER BY name'),
  ])

  const sheets = getSheetsClient()

  // Write to "Clients" tab — create if needed
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const exists = meta.data.sheets?.some((s: any) => s.properties?.title === 'Clients')

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: 'Clients' } } }],
      },
    })
  }

  const rows: any[][] = [
    ['Name', 'Holding Company', 'Distributor / Payer', 'Billing Type', 'Contract Start', 'Contract End', 'Notes', 'Active', 'LTV (USD)'],
    ...clientsRes.rows.map((c: any) => [
      c.name, c.holding_company_name || '', c.distributor || '', c.billing_type,
      c.contract_start ? new Date(c.contract_start).toISOString().split('T')[0] : '',
      c.contract_end   ? new Date(c.contract_end).toISOString().split('T')[0]   : '',
      c.notes || '', c.active ? 'Yes' : 'No', ''
    ]),
    [],
    ['--- Holding Companies ---'],
    ['Name', 'Notes'],
    ...holdingRes.rows.map((h: any) => [h.name, h.notes || '']),
  ]

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clients!A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  })
}
