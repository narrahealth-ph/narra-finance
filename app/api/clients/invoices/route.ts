import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'

// GET /api/clients/invoices?clientId=X  — invoices assigned to this client
// GET /api/clients/invoices?unassigned=true  — all invoices not yet assigned to any client
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId   = searchParams.get('clientId')
  const unassigned = searchParams.get('unassigned')

  if (clientId) {
    const res = await query(`
      SELECT i.id, i.drive_file_name AS invoice_id, i.vendor, i.date, i.amount, i.amount_usd,
             i.currency, i.billing_type, i.status, p.label AS period_label
      FROM invoices i
      LEFT JOIN periods p ON p.id = i.period_id
      WHERE i.client_id = $1 AND i.amount_usd > 0
      ORDER BY i.date DESC
    `, [clientId])
    return NextResponse.json({ invoices: res.rows })
  }

  if (unassigned === 'true') {
    const res = await query(`
      SELECT i.id, i.drive_file_name AS invoice_id, i.vendor, i.date, i.amount, i.amount_usd,
             i.currency, i.billing_type, i.status, p.label AS period_label
      FROM invoices i
      LEFT JOIN periods p ON p.id = i.period_id
      WHERE i.client_id IS NULL AND i.amount_usd > 0
      ORDER BY i.date DESC
    `)
    return NextResponse.json({ invoices: res.rows })
  }

  // All invoices with their current assignment
  const res = await query(`
    SELECT i.id, i.drive_file_name AS invoice_id, i.vendor, i.date, i.amount, i.amount_usd,
           i.currency, i.billing_type, i.status, i.client_id, p.label AS period_label,
           c.name AS client_name
    FROM invoices i
    LEFT JOIN periods p ON p.id = i.period_id
    LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.amount_usd > 0
    ORDER BY i.date DESC
  `)
  return NextResponse.json({ invoices: res.rows })
}

// PATCH /api/clients/invoices  { invoiceId, clientId }  — assign (or pass null to unassign)
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { invoiceId, clientId } = await req.json()
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })

  await query(
    'UPDATE invoices SET client_id = $1 WHERE id = $2',
    [clientId ?? null, invoiceId]
  )
  return NextResponse.json({ ok: true })
}
