import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { google } from 'googleapis'
import { cachedSheet } from '@/lib/sheets-cache'

const INVOICE_SHEET_ID = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'

// Ensure assignment table exists
const tableReady = (async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS client_invoice_assignments (
        id           SERIAL PRIMARY KEY,
        client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        invoice_id   TEXT    NOT NULL,   -- invoice ID from col A of the sheet
        amount_usd   NUMERIC,
        vendor       TEXT,
        issue_date   TEXT,
        billing_type TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(client_id, invoice_id)
      )
    `)
  } catch { /* already exists */ }
})()

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

function parseNum(val: any): number {
  if (!val) return 0
  return parseFloat(val.toString().replace(/[$,\s]/g, '')) || 0
}

// Fetch all outgoing client invoices from the Google Sheet
async function fetchSheetInvoices() {
  const sheets = getSheetsClient()
  const rows = await cachedSheet('invoice-sheet', async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: INVOICE_SHEET_ID,
      range: 'All time!A2:I500',
    })
    return res.data.values || []
  })

  return rows
    .map((r: any[]) => ({
      invoice_id:   (r[0] || '').trim(),
      vendor:       (r[1] || '').trim(),
      description:  (r[2] || '').trim(),
      notes:        (r[3] || '').trim(),
      issue_date:   (r[4] || '').trim(),
      amount_usd:   parseNum(r[5]),
      status:       (r[6] || '').trim(),
      billing_type: (r[7] || 'annual').trim(),
    }))
    .filter((r: any) => r.invoice_id && r.amount_usd > 0)
}

// GET /api/clients/invoices?clientId=X  — sheet invoices assigned to this client
// GET /api/clients/invoices              — all sheet invoices with current assignments
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await tableReady

  const clientId = new URL(req.url).searchParams.get('clientId')

  // Fetch sheet data and DB assignments in parallel
  const [sheetInvoices, assignmentsRes] = await Promise.all([
    fetchSheetInvoices(),
    clientId
      ? query(`
          SELECT cia.invoice_id, cia.client_id, c.name AS client_name
          FROM client_invoice_assignments cia
          JOIN clients c ON c.id = cia.client_id
          WHERE cia.client_id = $1
        `, [clientId])
      : query(`
          SELECT cia.invoice_id, cia.client_id, c.name AS client_name
          FROM client_invoice_assignments cia
          JOIN clients c ON c.id = cia.client_id
        `),
  ])

  // Build assignment lookup: invoice_id → { client_id, client_name }
  const assignMap: Record<string, { client_id: number; client_name: string }> = {}
  for (const row of assignmentsRes.rows) {
    assignMap[row.invoice_id] = { client_id: parseInt(row.client_id), client_name: row.client_name }
  }

  if (clientId) {
    // Only invoices assigned to this client
    const assigned = sheetInvoices.filter((inv: any) => assignMap[inv.invoice_id]?.client_id === parseInt(clientId))
    return NextResponse.json({ invoices: assigned })
  }

  // All sheet invoices with assignment info
  const invoices = sheetInvoices.map((inv: any) => ({
    ...inv,
    client_id:   assignMap[inv.invoice_id]?.client_id   ?? null,
    client_name: assignMap[inv.invoice_id]?.client_name ?? null,
  }))
  return NextResponse.json({ invoices })
}

// PATCH /api/clients/invoices  { invoiceId, clientId, amount, vendor, issueDate, billingType }
// clientId = null to unassign
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await tableReady

  const { invoiceId, clientId, amount, vendor, issueDate, billingType } = await req.json()
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })

  if (!clientId) {
    await query(
      'DELETE FROM client_invoice_assignments WHERE invoice_id = $1',
      [invoiceId]
    )
  } else {
    await query(`
      INSERT INTO client_invoice_assignments (client_id, invoice_id, amount_usd, vendor, issue_date, billing_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (client_id, invoice_id) DO UPDATE
        SET amount_usd = EXCLUDED.amount_usd, vendor = EXCLUDED.vendor,
            issue_date = EXCLUDED.issue_date, billing_type = EXCLUDED.billing_type
    `, [clientId, invoiceId, amount ?? null, vendor ?? null, issueDate ?? null, billingType ?? null])
  }

  return NextResponse.json({ ok: true })
}
