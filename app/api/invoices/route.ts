import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { writeAudit } from '@/lib/audit'

// GET /api/invoices?periodId=1
// Returns all expense invoices for a period (used by ReconciliationPanel for match display)
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
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

  await query(
    `UPDATE invoices SET
       vendor       = COALESCE($2, vendor),
       date         = COALESCE($3, date),
       amount       = COALESCE($4, amount),
       amount_usd   = COALESCE($4, amount_usd),
       currency     = COALESCE($5, currency),
       account_name = COALESCE($6, account_name)
     WHERE id = $1`,
    [id, vendor ?? null, date ?? null, amount != null ? amount : null, currency ?? null, accountName ?? null]
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
