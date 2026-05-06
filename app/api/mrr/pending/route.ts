import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

// GET /api/mrr/pending?periodId=1
// Returns invoices that are "sent" but have no matching bank transaction
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodId = new URL(req.url).searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ pending: [] })

  try {
    // Get all invoices for this period that are unmatched (sent but no bank match)
    const result = await query(
      `SELECT
         id,
         drive_file_name as "invoiceId",
         vendor          as "clientName",
         amount_usd      as "amount",
         date            as "issueDate",
         account_name    as "billingType",
         EXTRACT(DAY FROM NOW() - date)::int as "daysOutstanding"
       FROM invoices
       WHERE period_id = $1
         AND status = 'unmatched'
         AND amount_usd > 0
       ORDER BY date ASC`,
      [periodId]
    )

    const pending = result.rows.map(row => ({
      invoiceId:       row.invoiceId || `INV-${row.id}`,
      clientName:      row.clientName || 'Unknown',
      amount:          parseFloat(row.amount) || 0,
      issueDate:       row.issueDate ? new Date(row.issueDate).toISOString().split('T')[0] : '—',
      daysOutstanding: row.daysOutstanding || 0,
      billingType:     row.billingType || 'monthly',
    }))

    return NextResponse.json({ pending })
  } catch (err: any) {
    console.error('Pending invoices error:', err)
    return NextResponse.json({ pending: [] })
  }
}
