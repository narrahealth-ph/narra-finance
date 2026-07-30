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
    const end    = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    return { label: makeMonthLabel(start), startDate: start, endDate: end }
  })
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Kick off sheet fetches in parallel with DB queries
    const sheetRowsPromise        = fetchAllTimeRows().catch(() => [] as any[][])
    const investmentTotalsPromise = fetchInvestmentTotals().catch(() => ({ rene: 0, mike: 0, total: 0 }))

    const [
      revenueByMonthRes,
      burnByMonthRes,
      totalCashRes,
      activeClientCountRes,
      cashFlowRes,
      expensesByCategoryRes,
    ] = await Promise.all([
      // Revenue by month (last 24 months)
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
          AND bt.date >= NOW() - INTERVAL '24 months'
        GROUP BY DATE_TRUNC('month', bt.date)
        ORDER BY DATE_TRUNC('month', bt.date)
      `),

      // Burn by month (last 24 months, operating expenses only)
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
        WHERE bt.type = 'expense'
          AND bt.date >= NOW() - INTERVAL '24 months'
        GROUP BY DATE_TRUNC('month', bt.date)
        ORDER BY DATE_TRUNC('month', bt.date)
      `),

      // Cash position
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

      // Active client count
      query(`SELECT COUNT(*) AS count FROM clients WHERE active = TRUE`),

      // Cash flow by period (2025+) — revenue, expenses, capex, investment grouped by period label
      query(`
        SELECT
          p.label,
          SPLIT_PART(p.label, '_', 2) AS year,
          SPLIT_PART(p.label, '_', 1) AS month,
          p.start_date,
          COALESCE(SUM(CASE WHEN bt.type = 'revenue'    THEN bt.amount_usd ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN bt.type = 'expense'    THEN bt.amount_usd ELSE 0 END), 0) AS expenses,
          COALESCE(SUM(CASE WHEN bt.type = 'capex'      THEN bt.amount_usd ELSE 0 END), 0) AS capex,
          COALESCE(SUM(CASE WHEN bt.type = 'investment' THEN bt.amount_usd ELSE 0 END), 0) AS investment
        FROM periods p
        LEFT JOIN bank_transactions bt ON bt.period_id = p.id
          AND bt.type IN ('revenue','expense','capex','investment')
        WHERE SPLIT_PART(p.label,'_',2)::int >= 2025
        GROUP BY p.id, p.label, p.start_date
        ORDER BY p.start_date
      `),

      // Expenses by category (all time)
      query(`
        SELECT
          bt.description,
          bt.account,
          COUNT(*)               AS tx_count,
          SUM(bt.amount_usd)     AS total
        FROM bank_transactions bt
        WHERE bt.type IN ('expense','capex')
        GROUP BY bt.description, bt.account
        ORDER BY total DESC
      `),
    ])

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

    // Wait for sheet data
    const sheetRows        = await sheetRowsPromise
    const investmentTotals = await investmentTotalsPromise

    // ── MRR History: last 24 months ─────────────────────────────────────────
    const periods24 = lastNMonths(24)
    const monthMap: Record<string, {
      label: string; startDate: Date; mrr: number; cashRevenue?: number; burn?: number
    }> = {}

    for (const { label, startDate, endDate } of periods24) {
      monthMap[label] = { label, startDate, mrr: calcMrrForMonth(sheetRows, startDate, endDate) }
    }

    for (const r of revenueByMonthRes.rows) {
      if (!monthMap[r.label]) monthMap[r.label] = { label: r.label, startDate: new Date(r.start_date), mrr: 0 }
      monthMap[r.label].cashRevenue = parseFloat(r.revenue)
    }
    for (const r of burnByMonthRes.rows) {
      if (!monthMap[r.label]) monthMap[r.label] = { label: r.label, startDate: new Date(r.start_date), mrr: 0 }
      monthMap[r.label].burn = parseFloat(r.expenses)
    }

    const mrrHistory = Object.values(monthMap)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .map(m => {
        const [monthPart, yearPart] = m.label.split('_')
        return {
          month:       `${monthPart} ${yearPart}`,
          mrr:         m.mrr         || 0,
          cashRevenue: m.cashRevenue || 0,
          burn:        m.burn        || 0,
          net:         (m.cashRevenue || 0) - (m.burn || 0),
        }
      })

    // ── Summary KPIs ────────────────────────────────────────────────────────
    const currentPeriod = periods24[periods24.length - 1]
    const currentMrr    = monthMap[currentPeriod.label]?.mrr || 0

    const last3Mrr = periods24.slice(-3).map(p => monthMap[p.label]?.mrr || 0)
    const avgRevenue = last3Mrr.length > 0
      ? Math.round(last3Mrr.reduce((s, v) => s + v, 0) / last3Mrr.length)
      : 0

    const recentBurnMonths = burnByMonthRes.rows
      .filter((r: any) => parseFloat(r.expenses) > 0)
      .slice(-3)
    const avgBurn = recentBurnMonths.length > 0
      ? Math.round(recentBurnMonths.reduce((s: number, r: any) => s + parseFloat(r.expenses), 0) / recentBurnMonths.length)
      : 0

    const cashPosition  = parseFloat(totalCashRes.rows[0]?.cash_position || 0)
    const runway        = avgBurn > 0 ? Math.floor(cashPosition / avgBurn) : null
    const dbActiveClients = parseInt(activeClientCountRes.rows[0]?.count || 0)

    const summary = {
      currentMrr,
      avgRevenue,
      avgBurn,
      cashPosition,
      runway,
      totalRevenue,
      totalRaised:     investmentTotals.total,
      activeClients:   dbActiveClients,
      investmentTotals,
    }

    // ── Client Breakdown (current month, active only) ────────────────────────
    const clientMrrs: Record<string, number> = {}
    const seenKeys = new Set<string>()

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

    const totalClientMrr = Object.values(clientMrrs).reduce((s, v) => s + v, 0)
    const clientBreakdown = Object.entries(clientMrrs)
      .map(([name, mrr]) => ({
        name,
        mrr:  Math.round(mrr),
        pct:  totalClientMrr > 0 ? Math.round((mrr / totalClientMrr) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.mrr - a.mrr)

    // ── Cash Flow (2025+, with opening carry-forward) ────────────────────────
    const openingSnapRes = await query(`
      SELECT COALESCE(SUM(amount_usd), 0) AS opening_snapshot
      FROM bank_transactions WHERE type = 'opening'
    `)
    const openingSnapshot = parseFloat(openingSnapRes.rows[0]?.opening_snapshot || 0)

    let runningCash = openingSnapshot
    const cashFlow = cashFlowRes.rows
      .filter((r: any) =>
        parseFloat(r.revenue) > 0 || parseFloat(r.expenses) > 0 ||
        parseFloat(r.capex) > 0   || parseFloat(r.investment) > 0
      )
      .map((r: any) => {
        const revenue    = parseFloat(r.revenue)
        const expenses   = parseFloat(r.expenses)
        const capex      = parseFloat(r.capex)
        const investment = parseFloat(r.investment)
        // Net operating = revenue - expenses (capex excluded from operating margin)
        const netOperating = revenue - expenses
        // Closing cash includes investment deposits and capex spend
        const opening  = runningCash
        const closing  = opening + revenue + investment - expenses - capex
        runningCash    = closing
        return {
          year:         r.year,
          month:        r.month,
          revenue:      Math.round(revenue),
          expenses:     Math.round(expenses),
          capex:        Math.round(capex),
          investment:   Math.round(investment),
          netOperating: Math.round(netOperating),
          openingCash:  Math.round(opening),
          closingCash:  Math.round(closing),
        }
      })

    // ── Expenses by Category ─────────────────────────────────────────────────
    const expensesByCategory = expensesByCategoryRes.rows.map((r: any) => ({
      description: r.description || '',
      account:     r.account     || '',
      total:       Math.round(parseFloat(r.total || 0)),
      txCount:     parseInt(r.tx_count || 0),
    }))

    // ── Pipeline (status = pipeline / proposal / prospect) ──────────────────
    const pipelineStatuses = new Set(['pipeline', 'proposal', 'prospect'])
    const pipeline: Array<{
      client: string; amount: number; billingType: string
      notes: string; potentialArr: number; potentialMrr: number
    }> = []
    const pipelineSeen = new Set<string>()

    for (const r of sheetRows) {
      const invoiceId    = (r[0] || '').trim()
      const clientName   = (r[1] || '').trim()
      const notes        = (r[2] || '').trim()
      const amount       = parseNum((r[5] || '').toString())
      const status       = (r[6] || '').toLowerCase().trim()
      const billingType  = (r[7] || 'annual').toLowerCase().trim()
      if (!clientName) continue
      if (!pipelineStatuses.has(status)) continue

      const key = invoiceId || `${clientName.toLowerCase()}|${amount}|${billingType}`
      if (pipelineSeen.has(key)) continue
      pipelineSeen.add(key)

      const monthlyMrr = calcMonthlyMrr(amount, billingType)
      pipeline.push({
        client:       clientName,
        amount:       Math.round(amount),
        billingType,
        notes,
        potentialMrr: Math.round(monthlyMrr),
        potentialArr: Math.round(monthlyMrr * 12),
      })
    }

    return NextResponse.json({
      summary,
      mrrHistory,
      clientBreakdown,
      cashFlow,
      expensesByCategory,
      pipeline,
    })
  } catch (err: any) {
    console.error('investor-export error:', err?.message || err)
    return NextResponse.json({ error: 'Failed to generate export', detail: err?.message }, { status: 500 })
  }
}
