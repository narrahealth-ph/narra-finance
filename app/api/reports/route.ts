import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const periodId = searchParams.get('periodId')
  const type = searchParams.get('type') // gl | bs | pl | mrr | all

  if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

  const period = await query('SELECT * FROM periods WHERE id = $1', [periodId])
  if (!period.rows[0]) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const p = period.rows[0]

  // ── General Ledger ──────────────────────────────────────────────────────────
  const invoices = await query(
    'SELECT * FROM invoices WHERE period_id = $1 ORDER BY account_name, date',
    [periodId]
  )
  const bankTxs = await query(
    'SELECT * FROM bank_transactions WHERE period_id = $1 ORDER BY date',
    [periodId]
  )
  const mrr = await query(
    'SELECT * FROM mrr_entries WHERE period_id = $1 ORDER BY amount_usd DESC',
    [periodId]
  )

  // Totals
  const totalExpenses = invoices.rows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const revenueRows = bankTxs.rows.filter((r: any) => r.type === 'revenue')
  const totalRevenue = revenueRows.reduce((s: number, r: any) => s + parseFloat(r.amount || 0), 0)
  const bankOpeningRows = bankTxs.rows.filter((r: any) => r.type === 'opening')
  const cashOpening = bankOpeningRows.reduce((s: number, r: any) => s + parseFloat(r.amount || 0), 0)
  const totalMrr = mrr.rows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const netProfit = totalRevenue - totalExpenses
  const cashClosing = cashOpening + totalRevenue - totalExpenses

  // Group expenses by account
  const expenseByAccount: Record<string, any[]> = {}
  for (const inv of invoices.rows) {
    const acct = inv.account_name || 'Uncategorized'
    if (!expenseByAccount[acct]) expenseByAccount[acct] = []
    expenseByAccount[acct].push(inv)
  }

  const glData = {
    period: p,
    expenseByAccount,
    revenueRows,
    bankOpeningRows,
    totalExpenses,
    totalRevenue,
    netProfit,
    cashOpening,
    cashClosing,
  }

  const bsData = {
    period: p,
    cashClosing,
    arTotal: 420, // placeholder — enhance with AR module later
    prepayments: 1022.61,
    intangibleAssets: 16961.08,
    totalCurrentAssets: cashClosing + 420 + 1022.61,
    totalAssets: cashClosing + 420 + 1022.61 + 16961.08,
    retainedEarnings: netProfit,
    totalEquity: netProfit,
  }

  const plData = {
    period: p,
    revenueRows,
    expenseByAccount,
    totalRevenue,
    totalExpenses,
    netProfit,
    operatingMargin: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0',
  }

  const mrrData = {
    period: p,
    clients: mrr.rows,
    totalMrr,
    clientCount: mrr.rows.length,
  }

  // Unmatched items for reconciliation alerts
  const unmatchedInvoices = invoices.rows.filter((r: any) => r.status === 'unmatched')
  const unmatchedBank = bankTxs.rows.filter((r: any) => r.status === 'unmatched' && r.type === 'expense')

  return NextResponse.json({
    gl: glData,
    bs: bsData,
    pl: plData,
    mrr: mrrData,
    reconciliation: {
      unmatchedInvoices,
      unmatchedBank,
      matchedCount: invoices.rows.filter((r: any) => r.status === 'matched').length,
      totalInvoices: invoices.rows.length,
    }
  })
}
