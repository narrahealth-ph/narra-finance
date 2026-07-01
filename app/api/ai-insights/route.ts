import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { generateInvestorNarrative, detectAnomalies, assessChurnRisk, answerFinancialQuestion } from '@/lib/ai'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, type, question, pipelineDeals = [], pendingCollection = [] } = await req.json()

  const period = await query('SELECT * FROM periods WHERE id = $1', [periodId])
  const p = period.rows[0]
  if (!p) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const [bankTxsRes, mrrRes, prevRevenueRes, prevBurnRes, prevMrrRes, latestMrrRes] = await Promise.all([
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

    // Previous month's MRR entries (for new client detection)
    query(`
      SELECT client_name
      FROM mrr_entries
      WHERE period_id = (
        SELECT id FROM periods
        WHERE start_date < (SELECT start_date FROM periods WHERE id = $1)
        ORDER BY start_date DESC
        LIMIT 1
      )
    `, [periodId]),

    // Latest MRR entries from ANY period with data (fallback when current period has no MRR yet)
    query(`
      SELECT m.client_name, m.amount_usd, p2.label AS period_label
      FROM mrr_entries m
      JOIN periods p2 ON p2.id = m.period_id
      WHERE p2.id = (
        SELECT id FROM periods
        WHERE id IN (SELECT DISTINCT period_id FROM mrr_entries)
        ORDER BY start_date DESC
        LIMIT 1
      )
      ORDER BY m.amount_usd DESC
    `),
  ])

  const bankTxs = bankTxsRes.rows

  // Accrual revenue = MRR entries (what was earned this month under contracts)
  // If current period has no MRR yet (e.g. month not closed), fall back to latest known MRR
  const currentMrr = mrrRes.rows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const latestMrrRows = latestMrrRes.rows
  const latestMrrTotal = latestMrrRows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const latestMrrPeriodLabel = latestMrrRows[0]?.period_label || null

  // Use current period MRR if available, otherwise use latest known (annual contracts = still active)
  const totalMrr = currentMrr > 0 ? currentMrr : latestMrrTotal
  const activeMrrRows = currentMrr > 0 ? mrrRes.rows : latestMrrRows
  const mrrIsFallback = currentMrr === 0 && latestMrrTotal > 0

  // Cash revenue = actual bank deposits this month (can be $0 for annual-plan months)
  const safeAmt = (r: any) =>
    (r.amount_usd != null && parseFloat(r.amount_usd) > 0) ? parseFloat(r.amount_usd)
    : (r.currency === 'USD' || !r.currency) ? parseFloat(r.amount || 0)
    : 0

  const totalCashRevenue = bankTxs.filter((r: any) => r.type === 'revenue').reduce((s: number, r: any) => s + safeAmt(r), 0)

  // Expenses from bank transactions (source of truth, consistent with Reports page)
  const expenseTxs = bankTxs.filter((r: any) => r.type === 'expense')
  const totalBankExpenses = expenseTxs.reduce((s: number, r: any) => s + safeAmt(r), 0)

  // Global cash position — sum across ALL periods (opening + revenue + investment - expenses)
  // This is the true bank balance, not just this month's delta
  const globalCashRes = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'opening'    THEN amount_usd ELSE 0 END), 0) +
      COALESCE(SUM(CASE WHEN type = 'revenue'    THEN amount_usd ELSE 0 END), 0) +
      COALESCE(SUM(CASE WHEN type = 'investment' THEN amount_usd ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'expense'    THEN amount_usd ELSE 0 END), 0) AS cash_position
    FROM bank_transactions
  `)
  const cashBalance = parseFloat(globalCashRes.rows[0]?.cash_position || 0)

  // Avg monthly burn from last 3 months (for runway calculation)
  const recentBurnMonths = prevBurnRes.rows.filter((r: any) => parseFloat(r.expenses) > 0)
  const avgMonthlyBurn = recentBurnMonths.length > 0
    ? recentBurnMonths.reduce((s: number, r: any) => s + parseFloat(r.expenses), 0) / recentBurnMonths.length
    : totalBankExpenses
  const runway = avgMonthlyBurn > 0 ? Math.floor(cashBalance / avgMonthlyBurn) : 999

  // Historical context
  const prevRevenue = prevRevenueRes.rows.map((r: any) => ({ label: r.label, revenue: parseFloat(r.revenue) }))
  const prevBurn    = prevBurnRes.rows.map((r: any) => ({ label: r.label, expenses: parseFloat(r.expenses) }))

  // New clients this month (names in current MRR but not in previous month)
  const prevClientNames = new Set(prevMrrRes.rows.map((r: any) => r.client_name?.toLowerCase().trim()))
  const newClients = mrrRes.rows
    .filter((r: any) => !prevClientNames.has((r.client_name || '').toLowerCase().trim()))
    .map((r: any) => ({ name: r.client_name, amount: parseFloat(r.amount_usd || 0) }))

  // MoM cost % change (current vs most recent prior month with expenses)
  const prevMonthExpenses = prevBurn.length > 0 ? prevBurn[0].expenses : 0
  const costMoMPct = prevMonthExpenses > 0
    ? Math.round(((totalBankExpenses - prevMonthExpenses) / prevMonthExpenses) * 100)
    : null

  // Billing context for the AI — key insight about annual plans
  const mrrFallbackNote = mrrIsFallback && latestMrrPeriodLabel
    ? `NOTE: The selected period (${p.label}) has no MRR entries recorded yet. The MRR and client data below is from the most recently closed month (${latestMrrPeriodLabel}). Because Narra Health clients are on ANNUAL AUTO-RENEWING contracts, these clients and their MRR are still active and ongoing — they do not disappear just because the current month hasn't been entered yet.`
    : ''

  const annualBillingNote = mrrFallbackNote ||
    (totalMrr > 0 && totalCashRevenue === 0
      ? `IMPORTANT BILLING CONTEXT: No cash was received from clients this month, but this does NOT mean there is no revenue. Narra Health clients are on annual plans — they pay the full year upfront. The $${totalMrr.toLocaleString()} MRR shown represents revenue earned this month under those annual contracts. $0 cash received months are normal when clients have already pre-paid.`
      : totalMrr > 0 && totalCashRevenue < totalMrr * 0.5
      ? `BILLING CONTEXT: Cash received ($${totalCashRevenue.toLocaleString()}) is lower than accrual MRR ($${totalMrr.toLocaleString()}) this month. Normal — some clients are on annual plans and already paid upfront earlier in the year.`
      : '')

  let result: any = {}

  if (type === 'narrative' || type === 'all') {
    const narrative = await generateInvestorNarrative({
      period:            p.label,
      totalRevenue:      totalMrr,
      cashRevenue:       totalCashRevenue,
      totalExpenses:     totalBankExpenses,
      netProfit:         totalMrr - totalBankExpenses,
      mrr:               totalMrr,
      mrrGrowth:         0,
      clientCount:       activeMrrRows.length,
      cashBalance,
      runway,
      topClients:        activeMrrRows.slice(0, 3).map((r: any) => ({ name: r.client_name, amount: parseFloat(r.amount_usd || 0) })),
      anomalies:         [],
      billingNote:       annualBillingNote,
      prevRevenue,
      prevBurn,
      newClients,
      costMoMPct,
      pendingCollection: pendingCollection as { clientName: string; amount: number; daysOutstanding: number }[],
      pipelineDeals:     pipelineDeals as { clientName: string; amount: number; billingType: string; notes?: string }[],
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

    // Use active MRR rows (fallback to latest period if current has none)
    const mrrByClient = [...activeMrrRows]
      .sort((a: any, b: any) => parseFloat(b.amount_usd || 0) - parseFloat(a.amount_usd || 0))
      .map((r: any) => ({ client: r.client_name, amount: parseFloat(r.amount_usd || 0) }))

    // Use avg monthly burn as the realistic expense baseline for hypothetical questions
    // (current period may be $0 if bank statements not yet imported for this month)
    const expenseBaseline = totalBankExpenses > 0 ? totalBankExpenses : avgMonthlyBurn

    const answer = await answerFinancialQuestion(question, {
      period:             p.label,
      totalRevenue:       totalMrr,
      cashRevenue:        totalCashRevenue,
      totalExpenses:      expenseBaseline,
      netProfit:          totalMrr - expenseBaseline,
      cashBalance,
      runway,
      totalMrr,
      billingNote:        annualBillingNote,
      expensesByCategory: Object.entries(expensesByCategory).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      topExpenses,
      mrrByClient,
      prevRevenue,
      avgMonthlyBurn,
      mrrPeriodNote:      mrrIsFallback && latestMrrPeriodLabel ? `MRR data shown is from ${latestMrrPeriodLabel} (most recent closed month) — these contracts auto-renew annually so clients are still active.` : '',
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
