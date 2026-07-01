import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { generateInvestorNarrative, detectAnomalies, assessChurnRisk, answerFinancialQuestion } from '@/lib/ai'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, type, question } = await req.json()

  const period = await query('SELECT * FROM periods WHERE id = $1', [periodId])
  const p = period.rows[0]
  if (!p) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const [bankTxsRes, mrrRes, prevRevenueRes, prevBurnRes] = await Promise.all([
    query('SELECT * FROM bank_transactions WHERE period_id = $1', [periodId]),
    query('SELECT * FROM mrr_entries WHERE period_id = $1', [periodId]),

    // Last 3 months of cash revenue for context
    query(`
      SELECT p2.label, COALESCE(SUM(
        CASE WHEN bt.amount_usd IS NOT NULL AND bt.amount_usd > 0 THEN bt.amount_usd
             WHEN bt.currency = 'USD' OR bt.currency IS NULL THEN bt.amount
             ELSE 0 END
      ), 0) AS revenue
      FROM bank_transactions bt
      JOIN periods p2 ON p2.id = bt.period_id
      WHERE bt.type = 'revenue'
        AND bt.period_id != $1
        AND p2.start_date >= (SELECT start_date FROM periods WHERE id = $1) - INTERVAL '4 months'
        AND p2.start_date < (SELECT start_date FROM periods WHERE id = $1)
      GROUP BY p2.label, p2.start_date
      ORDER BY p2.start_date DESC
      LIMIT 3
    `, [periodId]),

    // Last 3 months of bank expenses for context
    query(`
      SELECT p2.label, COALESCE(SUM(
        CASE WHEN bt.amount_usd IS NOT NULL AND bt.amount_usd > 0 THEN bt.amount_usd
             WHEN bt.currency = 'USD' OR bt.currency IS NULL THEN bt.amount
             ELSE 0 END
      ), 0) AS expenses
      FROM bank_transactions bt
      JOIN periods p2 ON p2.id = bt.period_id
      WHERE bt.type = 'expense'
        AND bt.period_id != $1
        AND p2.start_date >= (SELECT start_date FROM periods WHERE id = $1) - INTERVAL '4 months'
        AND p2.start_date < (SELECT start_date FROM periods WHERE id = $1)
      GROUP BY p2.label, p2.start_date
      ORDER BY p2.start_date DESC
      LIMIT 3
    `, [periodId]),
  ])

  const bankTxs = bankTxsRes.rows

  // Accrual revenue = MRR entries (what was earned this month under contracts)
  const totalMrr = mrrRes.rows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)

  // Cash revenue = actual bank deposits this month (can be $0 for annual-plan months)
  const safeAmt = (r: any) =>
    (r.amount_usd != null && parseFloat(r.amount_usd) > 0) ? parseFloat(r.amount_usd)
    : (r.currency === 'USD' || !r.currency) ? parseFloat(r.amount || 0)
    : 0

  const totalCashRevenue = bankTxs.filter((r: any) => r.type === 'revenue').reduce((s: number, r: any) => s + safeAmt(r), 0)

  // Expenses from bank transactions (source of truth, consistent with Reports page)
  const expenseTxs = bankTxs.filter((r: any) => r.type === 'expense')
  const totalBankExpenses = expenseTxs.reduce((s: number, r: any) => s + safeAmt(r), 0)

  // Opening cash balance
  const cashOpening = bankTxs.filter((r: any) => r.type === 'opening').reduce((s: number, r: any) => s + safeAmt(r), 0)
  const cashBalance = cashOpening + totalCashRevenue - totalBankExpenses

  // Use MRR for runway (accrual basis is more meaningful than $0 cash months)
  const revenueForRunway = totalMrr > 0 ? totalMrr : totalCashRevenue
  const runway = totalBankExpenses > 0 ? Math.floor(cashBalance / totalBankExpenses) : 999

  // Historical context
  const prevRevenue = prevRevenueRes.rows.map((r: any) => ({ label: r.label, revenue: parseFloat(r.revenue) }))
  const prevBurn    = prevBurnRes.rows.map((r: any) => ({ label: r.label, expenses: parseFloat(r.expenses) }))

  // Billing context for the AI — key insight about annual plans
  const annualBillingNote = totalMrr > 0 && totalCashRevenue === 0
    ? `IMPORTANT BILLING CONTEXT: No cash was received from clients this month, but this does NOT mean there is no revenue. Narra Health clients are often on annual plans — they pay the full year upfront in one payment. The $${totalMrr.toLocaleString()} MRR shown above represents revenue earned this month under those annual contracts (accrual accounting). $0 cash received months are expected and normal when annual clients have already pre-paid.`
    : totalMrr > 0 && totalCashRevenue < totalMrr * 0.5
    ? `BILLING CONTEXT: Cash received ($${totalCashRevenue.toLocaleString()}) is lower than accrual MRR ($${totalMrr.toLocaleString()}) this month. This is normal — some clients are on annual plans and already paid upfront earlier in the year.`
    : ''

  let result: any = {}

  if (type === 'narrative' || type === 'all') {
    const narrative = await generateInvestorNarrative({
      period:            p.label,
      totalRevenue:      totalMrr,        // accrual = true earned revenue
      cashRevenue:       totalCashRevenue, // cash = what hit the bank this month
      totalExpenses:     totalBankExpenses,
      netProfit:         totalMrr - totalBankExpenses,
      mrr:               totalMrr,
      mrrGrowth:         0,
      clientCount:       mrrRes.rows.length,
      cashBalance,
      runway,
      topClients:        mrrRes.rows.slice(0, 3).map((r: any) => ({ name: r.client_name, amount: parseFloat(r.amount_usd || 0) })),
      anomalies:         [],
      billingNote:       annualBillingNote,
      prevRevenue,
      prevBurn,
    })
    result.narrative = narrative

    await query(
      `INSERT INTO ai_insights (period_id, type, content) VALUES ($1, 'narrative', $2)
       ON CONFLICT DO NOTHING`,
      [periodId, narrative]
    )
  }

  if (type === 'anomalies' || type === 'all') {
    const expenseByAccount: Record<string, number> = {}
    for (const tx of expenseTxs) {
      const acct = tx.account || tx.description || 'Other'
      expenseByAccount[acct] = (expenseByAccount[acct] || 0) + safeAmt(tx)
    }
    const anomalies = await detectAnomalies(expenseTxs, expenseByAccount, annualBillingNote)
    result.anomalies = anomalies
  }

  if (type === 'churn' || type === 'all') {
    const clients = mrrRes.rows.map((r: any) => ({
      name:        r.client_name,
      payments:    [parseFloat(r.amount_usd || 0)],
      lastPayment: r.created_at,
      seats:       r.seats || 0,
    }))
    const churn = await assessChurnRisk(clients)
    result.churn = churn
  }

  if (type === 'ask') {
    if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

    const expensesByCategory: Record<string, number> = {}
    for (const tx of expenseTxs) {
      const cat = tx.account || 'Other'
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + safeAmt(tx)
    }
    const topExpenses = [...expenseTxs]
      .sort((a, b) => safeAmt(b) - safeAmt(a))
      .map(r => ({ vendor: r.description || 'Unknown', amount: safeAmt(r), account: r.account || 'Other' }))

    const mrrByClient = [...mrrRes.rows]
      .sort((a, b) => parseFloat(b.amount_usd || 0) - parseFloat(a.amount_usd || 0))
      .map(r => ({ client: r.client_name, amount: parseFloat(r.amount_usd || 0) }))

    const answer = await answerFinancialQuestion(question, {
      period:             p.label,
      totalRevenue:       totalMrr,
      cashRevenue:        totalCashRevenue,
      totalExpenses:      totalBankExpenses,
      netProfit:          totalMrr - totalBankExpenses,
      cashBalance,
      runway,
      totalMrr,
      billingNote:        annualBillingNote,
      expensesByCategory: Object.entries(expensesByCategory).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      topExpenses,
      mrrByClient,
      prevRevenue,
    })
    result.answer = answer
  }

  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodId = new URL(req.url).searchParams.get('periodId')
  const res = await query(
    'SELECT * FROM ai_insights WHERE period_id = $1 ORDER BY generated_at DESC',
    [periodId]
  )
  return NextResponse.json({ insights: res.rows })
}
