import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = searchParams.get('year')
  if (!year) return NextResponse.json({ error: 'year required' }, { status: 400 })

  // All periods for the year
  const periodsRes = await query(
    `SELECT id, label, start_date, end_date, locked FROM periods
     WHERE EXTRACT(YEAR FROM start_date) = $1
     ORDER BY start_date`,
    [year]
  )
  const periods = periodsRes.rows
  if (periods.length === 0) {
    return NextResponse.json({
      year, months: [], totals: { revenue: 0, expenses: 0, net: 0, operatingMargin: '0.0', openingCash: 0, closingCash: 0 },
      expensesByDescription: [], lockedCount: 0, totalPeriods: 0,
    })
  }

  const periodIds = periods.map((p: any) => p.id)

  // Monthly revenue + expenses from bank transactions (parallel)
  const [monthlyRes, expenseBreakdownRes, openingRes, allTxRes] = await Promise.all([
    query(
      `SELECT
         p.id         AS period_id,
         p.label,
         p.start_date,
         p.locked,
         COALESCE(SUM(CASE WHEN bt.type = 'revenue' THEN bt.amount_usd ELSE 0 END), 0) AS revenue,
         COALESCE(SUM(CASE WHEN bt.type = 'expense' THEN bt.amount_usd ELSE 0 END), 0) AS expenses
       FROM periods p
       LEFT JOIN bank_transactions bt ON bt.period_id = p.id
       WHERE p.id = ANY($1)
       GROUP BY p.id, p.label, p.start_date, p.locked
       ORDER BY p.start_date`,
      [periodIds]
    ),
    // Expense breakdown by description across the full year
    query(
      `SELECT
         bt.description,
         bt.account,
         COUNT(*)        AS tx_count,
         SUM(bt.amount_usd) AS total
       FROM bank_transactions bt
       WHERE bt.period_id = ANY($1) AND bt.type = 'expense'
       GROUP BY bt.description, bt.account
       ORDER BY total DESC`,
      [periodIds]
    ),
    // Opening cash (sum of all opening-balance transactions for the year)
    query(
      `SELECT COALESCE(SUM(bt.amount_usd), 0) AS opening_cash
       FROM bank_transactions bt
       WHERE bt.period_id = ANY($1) AND bt.type = 'opening'`,
      [periodIds]
    ),
    // All individual bank transactions for GL
    query(
      `SELECT bt.date, bt.description, bt.amount_usd, bt.type, bt.account, bt.currency
       FROM bank_transactions bt
       WHERE bt.period_id = ANY($1) AND bt.type IN ('revenue', 'expense')
       ORDER BY bt.date`,
      [periodIds]
    ),
  ])

  const months = monthlyRes.rows.map((r: any) => ({
    periodId:  r.period_id,
    label:     r.label,
    startDate: r.start_date,
    locked:    r.locked,
    revenue:   parseFloat(r.revenue),
    expenses:  parseFloat(r.expenses),
    net:       parseFloat(r.revenue) - parseFloat(r.expenses),
  }))

  const totalRevenue  = months.reduce((s: number, m: any) => s + m.revenue,  0)
  const totalExpenses = months.reduce((s: number, m: any) => s + m.expenses, 0)
  const netProfit     = totalRevenue - totalExpenses
  const openingCash   = parseFloat(openingRes.rows[0]?.opening_cash || 0)

  // Last period ID (December or last month with data) — used for year-end Balance Sheet
  const lastPeriodId = periods[periods.length - 1]?.id || null

  return NextResponse.json({
    year,
    months,
    totals: {
      revenue:          totalRevenue,
      expenses:         totalExpenses,
      net:              netProfit,
      operatingMargin:  totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0',
      openingCash,
      closingCash:      openingCash + totalRevenue - totalExpenses,
    },
    expensesByDescription: expenseBreakdownRes.rows.map((r: any) => ({
      description: r.description,
      account:     r.account,
      txCount:     parseInt(r.tx_count),
      total:       parseFloat(r.total),
    })),
    allTransactions: allTxRes.rows.map((r: any) => ({
      date:        r.date,
      description: r.description,
      amount_usd:  parseFloat(r.amount_usd),
      type:        r.type,
      account:     r.account,
      currency:    r.currency,
    })),
    lastPeriodId,
    lockedCount:  months.filter((m: any) => m.locked).length,
    totalPeriods: months.length,
  })
}

// Lock all periods for the year
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { year } = await req.json()
  if (!year) return NextResponse.json({ error: 'year required' }, { status: 400 })

  await query(
    `UPDATE periods
     SET locked = TRUE, locked_at = NOW(), status = 'closed'
     WHERE EXTRACT(YEAR FROM start_date) = $1 AND locked = FALSE`,
    [year]
  )

  return NextResponse.json({ success: true })
}
