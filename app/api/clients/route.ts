import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { google } from 'googleapis'

const SPREADSHEET_ID = '1057EJCsrTPT7LFHBYqsqYVVERuwgZ7kScmHy8j1Or8s'

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

  const [clientsRes, holdingRes, invoiceRevenueRes, cashRes] = await Promise.all([
    query(`
      SELECT c.*, hc.name AS holding_company_name
      FROM clients c
      LEFT JOIN holding_companies hc ON hc.id = c.holding_company_id
      ORDER BY c.name
    `),
    query('SELECT * FROM holding_companies ORDER BY name'),
    // Total invoiced per client from explicit sheet invoice assignments
    query(`
      SELECT client_id AS id,
             COALESCE(SUM(amount_usd), 0) AS assigned_total,
             COUNT(*) AS assigned_count
      FROM client_invoice_assignments
      GROUP BY client_id
    `),
    query(`
      SELECT client_id, SUM(amount_usd) AS cash_received
      FROM bank_transactions
      WHERE type = 'revenue' AND client_id IS NOT NULL
      GROUP BY client_id
    `),
  ])

  const invoiceMap: Record<number, { total: number; count: number }> = {}
  for (const row of invoiceRevenueRes.rows) {
    invoiceMap[parseInt(row.id)] = { total: parseFloat(row.assigned_total || 0), count: parseInt(row.assigned_count || 0) }
  }

  const cashMap: Record<number, number> = {}
  for (const row of cashRes.rows) cashMap[parseInt(row.client_id)] = parseFloat(row.cash_received || 0)

  const clients = clientsRes.rows.map((c: any) => ({
    ...c,
    ltv:           invoiceMap[c.id]?.total || 0,
    invoice_count: invoiceMap[c.id]?.count || 0,
    cash_received: cashMap[c.id] || 0,
  }))

  return NextResponse.json({ clients, holdingCompanies: holdingRes.rows })
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
