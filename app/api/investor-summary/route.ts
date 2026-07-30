import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import {
  fetchAllTimeRows,
  fetchInvestmentTotals,
  calcMrrForMonth,
  isActiveStatus,
  parseNum,
  parseInvDate,
  contractEnd,
  calcMonthlyMrr,
} from '@/lib/mrr-calc'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function makeMonthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]}_${d.getFullYear()}`
}

/** Last N calendar months, newest last */
function lastNMonths(n: number) {
  const now = new Date()
  return Array.from({ length: n }, (_, i) => {
    const offset = n - 1 - i
    const start  = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const end    = new Date(start.getFullYear(), start.getMonth() + 1, 0) // last day
    return { label: makeMonthLabel(start), startDate: start, endDate: end }
  })
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
  // Kick off sheet fetches in parallel with DB queries
  const sheetRowsPromise      = fetchAllTimeRows().catch(() => [] as any[][])
  const investmentTotalsPromise = fetchInvestmentTotals().catch(() => ({ rene: 0, mike: 0, total: 0 }))

  const [
    revenueByMonthRes,
    burnByMonthRes,
    totalCashRes,
    totalInvestedRes,
    activeClientCountRes,
  ] = await Promise.all([
    // Revenue by month from bank_transactions
    query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', bt.date), 'FMMonth_YYYY') AS label,
        DATE_TRUNC('month', bt.date)                          AS start_date,
        COALESCE(SUM(
          CASE WHEN bt.amount_usd IS NOT NULL AND bt.amount_usd > 0 THEN bt.amount_usd
               WHEN bt.currency = 'USD' OR bt.currency IS NULL     THEN bt.amount
               ELSE 0 END
        ), 0) AS revenue
      FROM bank_transactions bt
      WHERE bt.type = 'revenue'
        AND bt.date >= NOW() - INTERVAL '18 months'
      GROUP BY DATE_TRUNC('month', bt.date)
      ORDER BY DATE_TRUNC('month', bt.date)
    `),

    // Monthly burn from bank_transactions
    query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', bt.date), 'FMMonth_YYYY') AS label,
        DATE_TRUNC('month', bt.date)                          AS start_date,
        COALESCE(SUM(
          CASE WHEN bt.amount_usd IS NOT NULL AND bt.amount_usd > 0 THEN bt.amount_usd
               WHEN bt.currency = 'USD' OR bt.currency IS NULL     THEN bt.amount
               ELSE 0 END
        ), 0) AS expenses
      FROM bank_transactions bt
      WHERE bt.type = 'expense'   -- capex intentionally excluded: not operating burn
        AND bt.date >= NOW() - INTERVAL '18 months'
      GROUP BY DATE_TRUNC('month', bt.date)
      ORDER BY DATE_TRUNC('month', bt.date)
    `),

    // Cash position: true opening balance (Jan 2025 Wise snapshot) + 2025+ revenue/investment - 2025+ costs.
    // The 2024 pre-Wise activity is already baked into the opening balance — adding investmentByYear[2024]
    // would double-count it. The opening query sums ALL 'opening' type rows (they live in January_2025
    // only, not in every imported month).
    query(`
      SELECT
        (SELECT COALESCE(SUM(amount_usd), 0) FROM bank_transactions WHERE type = 'opening') +
        COALESCE(SUM(CASE WHEN bt.type = 'revenue'
                          AND SPLIT_PART(p.label,'_',2)::int >= 2025            THEN bt.amount_usd ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN bt.type = 'investment'
                          AND SPLIT_PART(p.label,'_',2)::int >= 2025            THEN bt.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN bt.type IN ('expense','capex')
                          AND SPLIT_PART(p.label,'_',2)::int >= 2025            THEN bt.amount_usd ELSE 0 END), 0)
        AS cash_position
      FROM bank_transactions bt
      JOIN periods p ON p.id = bt.period_id
      WHERE bt.type != 'opening'
    `),

    // Total invested by founders
    query(`
      SELECT COALESCE(SUM(amount_usd), 0) AS total
      FROM bank_transactions WHERE type = 'investment'
    `),

    // Active client count from clients table
    query(`SELECT COUNT(*) AS count FROM clients WHERE active = TRUE`),
  ])

  // SGD rate
  let sgdRate = 0.74
  try {
    const sgdRes = await query(`SELECT rate FROM fx_rates WHERE currency = 'SGD' ORDER BY date DESC LIMIT 1`)
    if (sgdRes.rows[0]?.rate) sgdRate = parseFloat(sgdRes.rows[0].rate)
  } catch { /* use default */ }

  // Wait for sheet data (may already be cached)
  const sheetRows        = await sheetRowsPromise
  const investmentTotals = await investmentTotalsPromise

  // Compute accrual MRR from sheet for each of the last 18 months
  const periods18 = lastNMonths(18)
  const monthMap: Record<string, { label: string; startDate: Date; mrr: number; cashRevenue?: number; burn?: number }> = {}
  for (const { label, startDate, endDate } of periods18) {
    monthMap[label] = { label, startDate, mrr: calcMrrForMonth(sheetRows, startDate, endDate) }
  }

  // Merge cash revenue and burn from DB
  for (const r of revenueByMonthRes.rows) {
    if (!monthMap[r.label]) monthMap[r.label] = { label: r.label, startDate: new Date(r.start_date), mrr: 0 }
    monthMap[r.label].cashRevenue = parseFloat(r.revenue)
  }
  for (const r of burnByMonthRes.rows) {
    if (!monthMap[r.label]) monthMap[r.label] = { label: r.label, startDate: new Date(r.start_date), mrr: 0 }
    monthMap[r.label].burn = parseFloat(r.expenses)
  }

  const months = Object.values(monthMap)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    .map(m => ({
      label:       m.label,
      mrr:         m.mrr         || 0,
      cashRevenue: m.cashRevenue || 0,
      burn:        m.burn        || 0,
      net:         (m.cashRevenue || 0) - (m.burn || 0),
    }))

  // Active client breakdown from sheet — current month
  const currentPeriod = periods18[periods18.length - 1]
  const clientMrrs: Record<string, number> = {}
  const seenKeys    = new Set<string>()

  for (const r of sheetRows) {
    const invoiceId    = (r[0] || '').trim()
    const clientName   = (r[1] || '').trim()
    const amount       = parseNum((r[5] || '').toString())
    const status       = (r[6] || '').toLowerCase().trim()
    const billingType  = (r[7] || 'annual').toLowerCase().trim()
    const issueDateStr = (r[4] || '').trim()
    if (!clientName || !amount || !isActiveStatus(status)) continue

    const isOneOff = billingType === 'one-off' || billingType === 'one off' || billingType === 'oneoff'
    const d        = parseInvDate(issueDateStr)
    const key      = invoiceId || `${clientName.toLowerCase()}|${issueDateStr}|${amount}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    const mStart = currentPeriod.startDate
    const mEnd   = currentPeriod.endDate

    let contribution = 0
    if (isOneOff) {
      if (!d || d < mStart || d > mEnd) continue
      contribution = amount
    } else {
      if (!d || d > mEnd) continue
      if (contractEnd(d, billingType) <= mStart) continue
      contribution = calcMonthlyMrr(amount, billingType)
    }

    clientMrrs[clientName] = (clientMrrs[clientName] || 0) + contribution
  }

  const clients = Object.entries(clientMrrs)
    .map(([name, mrr]) => ({ name, mrr: Math.round(mrr) }))
    .sort((a, b) => b.mrr - a.mrr)
  const totalClientMrr = clients.reduce((s, c) => s + c.mrr, 0)
  const clientsWithPct = clients.map(c => ({
    ...c,
    pct: totalClientMrr > 0 ? Math.round((c.mrr / totalClientMrr) * 100) : 0,
  }))

  // Current MRR (current month from sheet)
  const currentMrr = monthMap[currentPeriod.label]?.mrr || 0

  // Avg monthly cash revenue (last 3 months with revenue)
  const recentRevenueMonths = revenueByMonthRes.rows
    .filter((r: any) => parseFloat(r.revenue) > 0)
    .slice(-3)
  const avgRevenue = recentRevenueMonths.length > 0
    ? recentRevenueMonths.reduce((s: number, r: any) => s + parseFloat(r.revenue), 0) / recentRevenueMonths.length
    : 0

  // Avg monthly burn (last 3 months with expenses)
  const recentBurnMonths = burnByMonthRes.rows
    .filter((r: any) => parseFloat(r.expenses) > 0)
    .slice(-3)
  const avgBurn = recentBurnMonths.length > 0
    ? recentBurnMonths.reduce((s: number, r: any) => s + parseFloat(r.expenses), 0) / recentBurnMonths.length
    : 0

  const cashPosition = parseFloat(totalCashRes.rows[0]?.cash_position || 0)
  const runway       = avgBurn > 0 ? Math.floor(cashPosition / avgBurn) : null
  const totalInvested = parseFloat(totalInvestedRes.rows[0]?.total || 0)
  const dbActiveClients = parseInt(activeClientCountRes.rows[0]?.count || 0)

  // Total revenue all time
  const totalRevenueRes = await query(`
    SELECT COALESCE(SUM(
      CASE WHEN amount_usd IS NOT NULL AND amount_usd > 0 THEN amount_usd
           WHEN currency = 'USD' OR currency IS NULL     THEN amount
           ELSE 0 END
    ), 0) AS total
    FROM bank_transactions WHERE type = 'revenue'
  `)
  const totalRevenue = parseFloat(totalRevenueRes.rows[0]?.total || 0)

  // Bank data coverage
  const coverageRes = await query(`
    SELECT
      MIN(DATE_TRUNC('month', bt.date)) AS earliest,
      MAX(DATE_TRUNC('month', bt.date)) AS latest
    FROM bank_transactions bt
    WHERE bt.type IN ('expense', 'revenue')
  `)
  const earliestBank = coverageRes.rows[0]?.earliest || null
  const latestBank   = coverageRes.rows[0]?.latest   || null

  // Which of the last 3 months have no bank data?
  const missingMonths: string[] = []
  for (let i = 1; i <= 3; i++) {
    const d     = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const label = makeMonthLabel(d)
    const hasBankData =
      burnByMonthRes.rows.some((r: any) => r.label === label && parseFloat(r.expenses) > 0) ||
      revenueByMonthRes.rows.some((r: any) => r.label === label && parseFloat(r.revenue) > 0)
    if (!hasBankData) missingMonths.push(`${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`)
  }

  return NextResponse.json({
    avgRevenue,
    arr:           avgRevenue * 12,
    avgBurn,
    cashPosition,
    runway,
    totalRevenue,
    totalInvested,
    activeClients: dbActiveClients,
    clients:       clientsWithPct,
    months,
    earliestBank,
    latestBank,
    missingMonths,
    mrrMonth:      currentPeriod.label,
    currentMrr,
    revenueMonths: recentRevenueMonths.map((r: any) => r.label),
    burnMonths:    recentBurnMonths.map((r: any) => r.label),
    sgdRate,
    investmentTotals,
  })
  } catch (err: any) {
    console.error('investor-summary error:', err?.message || err)
    return NextResponse.json({ error: 'Failed to load summary', detail: err?.message }, { status: 500 })
  }
}
