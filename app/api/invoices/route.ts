import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { toUSD } from '@/lib/fx'
import { google } from 'googleapis'

const INVOICE_SHEET_ID = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'

function getSheetClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

// GET /api/invoices?periodId=1
// GET /api/invoices?action=lookup&invoiceId=INV-20250201-001
// Returns all expense invoices for a period (used by ReconciliationPanel for match display)
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // ── Invoice lookup by ID from Google Sheet ──────────────────────────────────
  if (action === 'lookup') {
    const invoiceId = (searchParams.get('invoiceId') || '').trim().toUpperCase()
    if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })

    try {
      const sheets = getSheetClient()
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: INVOICE_SHEET_ID,
        range: 'All time!A2:I500',
      })
      const rows = res.data.values || []
      const row = rows.find(r => (r[0] || '').toString().trim().toUpperCase() === invoiceId)
      if (!row) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

      const parseNum = (v: any) => parseFloat((v || '').toString().replace(/[$,\s]/g, '')) || 0

      return NextResponse.json({
        invoiceId:   row[0] || '',
        clientName:  row[1] || '',
        issueDate:   row[2] || '',
        amount:      parseNum(row[3]),
        billingType: row[4] || '',
        status:      row[5] || '',
        distributor: row[6] || '',
      })
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Sheet lookup failed' }, { status: 500 })
    }
  }

  const periodId = searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

  const res = await query(
    `SELECT id, vendor, date, amount, amount_usd, currency, account_name, account_code,
            billing_type, status, matched_bank_id, drive_file_name, drive_file_id
     FROM invoices
     WHERE period_id = $1
     ORDER BY date`,
    [periodId]
  )
  return NextResponse.json({ invoices: res.rows })
}

// PATCH /api/invoices  { id, vendor, date, amount, currency, accountName }
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, vendor, date, amount, currency, accountName } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const inv = await query(
    `SELECT i.id, i.amount, i.vendor, p.locked FROM invoices i
     JOIN periods p ON p.id = i.period_id WHERE i.id = $1`,
    [id]
  )
  if (!inv.rows[0]) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (inv.rows[0].locked) return NextResponse.json({ error: 'Period is locked' }, { status: 403 })

  const old = inv.rows[0]

  // Compute amount_usd with FX conversion when amount or currency is being updated
  let amountUsd: number | null = null
  if (amount != null) {
    const effectiveCurrency = currency ?? inv.rows[0].currency ?? 'USD'
    const effectiveDate     = date ?? inv.rows[0].date ?? new Date().toISOString().split('T')[0]
    amountUsd = await toUSD(amount, effectiveCurrency, effectiveDate)
  }

  await query(
    `UPDATE invoices SET
       vendor       = COALESCE($2, vendor),
       date         = COALESCE($3, date),
       amount       = COALESCE($4, amount),
       amount_usd   = COALESCE($7, amount_usd),
       currency     = COALESCE($5, currency),
       account_name = COALESCE($6, account_name)
     WHERE id = $1`,
    [id, vendor ?? null, date ?? null, amount != null ? amount : null, currency ?? null, accountName ?? null, amountUsd]
  )

  await writeAudit('invoices', id, 'update',
    { vendor: old.vendor, amount: old.amount },
    { vendor, date, amount, currency, accountName },
    (session as any).email)

  return NextResponse.json({ ok: true })
}

// DELETE /api/invoices?id=X — delete a single invoice
export async function DELETE(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const inv = await query(
    `SELECT i.id, i.matched_bank_id, p.locked FROM invoices i
     JOIN periods p ON p.id = i.period_id WHERE i.id = $1`,
    [id]
  )
  if (!inv.rows[0]) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (inv.rows[0].locked) return NextResponse.json({ error: 'Period is locked' }, { status: 403 })

  // Unlink matched bank transaction
  if (inv.rows[0].matched_bank_id) {
    await query(
      "UPDATE bank_transactions SET status='unmatched', matched_invoice_id=NULL, discrepancy_pct=NULL WHERE id=$1",
      [inv.rows[0].matched_bank_id]
    )
  }
  await query('DELETE FROM invoices WHERE id=$1', [id])
  await writeAudit('invoices', id, 'delete', null, null, (session as any).email)

  return NextResponse.json({ ok: true })
}
