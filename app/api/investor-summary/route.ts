import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [
    periodsRes,
    mrrHistoryRes,
    revenueByMonthRes,
    burnByMonthRes,
    clientsRes,
    totalCashRes,
    totalInvestedRes,
    sgdRateRes,
  ] = await Promise.all([
    // All periods, most recent first
    query(`SELECT * FROM periods ORDER BY start_date DESC LIMIT 24`),

    // MRR history from mrr_entries — monthly totals
    query(`
      SELECT
        p.label,
        p.start_date,
        COALESCE(SUM(m.amount_usd), 0) AS mrr
      FROM periods p
      LEFT JOIN mrr_entries m ON m.period_id = p.id
      WHERE p.start_date >= NOW() - INTERVAL '18 months'
      GROUP BY p.id, p.label, p.start_date
      ORDER BY p.start_date
    `),

    // Revenue by month from bank transactions (last 18 months)
    query(`
      SELECT
        p.label,
        p.start_date,
        COALESCE(SUM(bt.amount_usd), 0) AS revenue
      FROM periods p
      LEFT JOIN bank_transactions bt ON bt.period_id = p.id AND bt.type = 'revenue'
      WHERE p.start_date >= NOW() - INTERVAL '18 months'
      GROUP BY p.id, p.label, p.start_date
      ORDER BY p.start_date
    `),

    // Monthly burn from bank expense transactions
    query(`
      SELECT
        p.label,
        p.start_date,
        COALESCE(SUM(bt.amount_usd), 0) AS expenses
      FROM periods p
      LEFT JOIN bank_transactions bt ON bt.period_id = p.id AND bt.type = 'expense'
      WHERE p.start_date >= NOW() - INTERVAL '18 months'
      GROUP BY p.id, p.label, p.start_date
      ORDER BY p.start_date
    `),

    // Active clients (from mrr_entries in latest period with data)
    query(`
      SELECT DISTINCT m.client_name, SUM(m.amount_usd) AS mrr
      FROM mrr_entries m
      JOIN periods p ON p.id = m.period_id
      WHERE p.start_date = (
        SELECT MAX(p2.start_date) FROM periods p2
        JOIN mrr_entries m2 ON m2.period_id = p2.id
      )
      GROUP BY m.client_name
      ORDER BY mrr DESC
    `),

    // Cash position: opening + revenue + investment - expenses
    query(`
      SELECT
        COALESCE(SUM(CASE WHEN bt.type = 'opening'    THEN bt.amount_usd ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN bt.type = 'revenue'    THEN bt.amount_usd ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN bt.type = 'investment' THEN bt.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN bt.type = 'expense'    THEN bt.amount_usd ELSE 0 END), 0) AS cash_position
      FROM bank_transactions bt
    `),

    // Total invested by founders
    query(`
      SELECT COALESCE(SUM(amount_usd), 0) AS total
      FROM bank_transactions WHERE type = 'investment'
    `),

    // Latest SGD→USD exchange rate
    query(`
      SELECT rate FROM fx_rates
      WHERE currency = 'SGD'
      ORDER BY date DESC LIMIT 1
    `),
  ])

  // Build monthly chart data (merge MRR + revenue + burn by label)
  const monthMap: Record<string, any> = {}
  for (const r of mrrHistoryRes.rows) {
    monthMap[r.label] = { label: r.label, startDate: r.start_date, mrr: parseFloat(r.mrr) }
  }
  for (const r of revenueByMonthRes.rows) {
    if (!monthMap[r.label]) monthMap[r.label] = { label: r.label, startDate: r.start_date, mrr: 0 }
    monthMap[r.label].cashRevenue = parseFloat(r.revenue)
  }
  for (const r of burnByMonthRes.rows) {
    if (!monthMap[r.label]) monthMap[r.label] = { label: r.label, startDate: r.start_date, mrr: 0 }
    monthMap[r.label].burn = parseFloat(r.expenses)
  }

  const months = Object.values(monthMap)
    .sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .map((m: any) => ({
      label:       m.label,
      mrr:         m.mrr         || 0,
      cashRevenue: m.cashRevenue || 0,
      burn:        m.burn        || 0,
      net:         (m.cashRevenue || 0) - (m.burn || 0),
    }))

  // Current MRR (latest month with MRR data) — kept for client breakdown label
  const latestMrr = [...mrrHistoryRes.rows]
    .sort((a: any, b: any) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
    .find((r: any) => parseFloat(r.mrr) > 0)

  // Avg monthly revenue from bank deposits (last 3 months with revenue)
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

  // Cash position
  const cashPosition = parseFloat(totalCashRes.rows[0]?.cash_position || 0)

  // Runway in months
  const runway = avgBurn > 0 ? Math.floor(cashPosition / avgBurn) : null

  // Total invested by founders (through bank)
  const totalInvested = parseFloat(totalInvestedRes.rows[0]?.total || 0)

  // Total revenue all time (client revenue only, excludes investments)
  const totalRevenueRes = await query(`
    SELECT COALESCE(SUM(amount_usd), 0) AS total
    FROM bank_transactions WHERE type = 'revenue'
  `)
  const totalRevenue = parseFloat(totalRevenueRes.rows[0]?.total || 0)

  // Bank data coverage — earliest and latest month with any bank transactions
  const coverageRes = await query(`
    SELECT
      MIN(p.start_date) AS earliest,
      MAX(p.start_date) AS latest
    FROM bank_transactions bt
    JOIN periods p ON p.id = bt.period_id
    WHERE bt.type IN ('expense', 'revenue')
  `)
  const earliestBank = coverageRes.rows[0]?.earliest || null
  const latestBank   = coverageRes.rows[0]?.latest   || null

  // Which of the last 3 calendar months have no bank data?
  const missingMonths: string[] = []
  for (let i = 1; i <= 3; i++) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const y = d.getFullYear()
    const m = d.getMonth() // 0-indexed
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const label = `${monthNames[m]}_${y}`
    const hasBankData = burnByMonthRes.rows.some(
      (r: any) => r.label === label && parseFloat(r.expenses) > 0
    ) || revenueByMonthRes.rows.some(
      (r: any) => r.label === label && parseFloat(r.revenue) > 0
    )
    if (!hasBankData) missingMonths.push(`${monthNames[m]} ${y}`)
  }

  // Clients
  const clients = clientsRes.rows.map((r: any) => ({
    name: r.client_name,
    mrr:  parseFloat(r.mrr),
  }))
  const totalClientMrr = clients.reduce((s: number, c: any) => s + c.mrr, 0)
  const clientsWithPct = clients.map((c: any) => ({
    ...c,
    pct: totalClientMrr > 0 ? Math.round((c.mrr / totalClientMrr) * 100) : 0,
  }))

  const sgdRate = parseFloat(sgdRateRes.rows[0]?.rate || '0.74')

  return NextResponse.json({
    avgRevenue,
    arr:            avgRevenue * 12,
    avgBurn,
    cashPosition,
    runway,
    totalRevenue,
    totalInvested,
    activeClients:  clients.length,
    clients:        clientsWithPct,
    months,
    earliestBank,
    latestBank,
    missingMonths,
    mrrMonth:       latestMrr?.label || null,
    revenueMonths:  recentRevenueMonths.map((r: any) => r.label),
    burnMonths:     recentBurnMonths.map((r: any) => r.label),
    sgdRate,
  })
}
