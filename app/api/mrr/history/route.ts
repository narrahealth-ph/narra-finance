import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import {
  fetchAllTimeRows,
  isActiveStatus,
  parseNum,
  parseInvDate,
  contractEnd,
  calcMonthlyMrr,
  calcMrrForMonth,
} from '@/lib/mrr-calc'

const MONTH_NAMES_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function isPendingStatus(status: string): boolean {
  return !status.toLowerCase().trim().includes('paid')
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const monthParam    = searchParams.get('month')
  const yearViewParam = searchParams.get('yearView') === 'true'

  try {
    // Fetch all sources in parallel
    const [invRows, holdingRes, costsRes, bankRes, revenueByMonthRes, invoiceCostsRes, investmentRes, openingRes] = await Promise.all([
      fetchAllTimeRows(),

      query(`
        SELECT hc.name AS hc_name, c.name AS client_name
        FROM holding_companies hc
        JOIN clients c ON c.holding_company_id = hc.id
        WHERE c.active = TRUE
      `).catch(() => ({ rows: [] })),

      // Bank costs per month (expense + capex) for ALL years — keyed by period label
      query(`
        SELECT
          p.label,
          COALESCE(SUM(bt.amount_usd), 0) AS total_costs
        FROM periods p
        LEFT JOIN bank_transactions bt ON bt.period_id = p.id
          AND bt.type IN ('expense', 'capex')
        GROUP BY p.label
      `).catch(() => ({ rows: [] })),

      // Cash received per year from bank — group by label to avoid UTC boundary issues
      query(`
        SELECT p.label, COALESCE(SUM(bt.amount_usd), 0) AS total
        FROM bank_transactions bt
        JOIN periods p ON p.id = bt.period_id
        WHERE bt.type = 'revenue'
        GROUP BY p.label
      `).catch(() => ({ rows: [] })),

      // Bank revenue per month — keyed by period label to avoid UTC boundary issues
      query(`
        SELECT
          p.label,
          COALESCE(SUM(bt.amount_usd), 0) AS total_revenue
        FROM periods p
        LEFT JOIN bank_transactions bt ON bt.period_id = p.id
          AND bt.type = 'revenue'
        GROUP BY p.label
      `).catch(() => ({ rows: [] })),

      // Expense invoices (vendor bills) summed per year — "costs based on invoices"
      query(`
        SELECT EXTRACT(year FROM p.start_date)::int AS yr,
               COALESCE(SUM(i.amount_usd), 0)       AS total
        FROM invoices i
        JOIN periods p ON p.id = i.period_id
        GROUP BY yr
      `).catch(() => ({ rows: [] })),

      // Investment deposits by year — group by label
      query(`
        SELECT p.label, COALESCE(SUM(bt.amount_usd), 0) AS total
        FROM bank_transactions bt
        JOIN periods p ON p.id = bt.period_id
        WHERE bt.type = 'investment'
        GROUP BY p.label
      `).catch(() => ({ rows: [] })),

      // Opening cash — sum all 'opening' type entries (they live in January_2025, not the
      // earliest period by start_date which is August_2024 and has no opening row)
      query(`
        SELECT COALESCE(SUM(bt.amount_usd), 0) AS opening_cash
        FROM bank_transactions bt
        WHERE bt.type = 'opening'
      `).catch(() => ({ rows: [{ opening_cash: 0 }] })),
    ])

    // holding company name → active subsidiary names
    const holdingMap: Record<string, string[]> = {}
    for (const row of (holdingRes as any).rows) {
      const key = (row.hc_name || '').toLowerCase().trim()
      if (!holdingMap[key]) holdingMap[key] = []
      holdingMap[key].push(row.client_name)
    }

    // Parse "MonthName_YYYY" label → "YYYY-MM" key (avoids UTC date boundary issues)
    const labelToKey = (label: string): string | null => {
      const [monthName, yearStr] = label.split('_')
      const monthIdx = MONTH_NAMES_LONG.findIndex(m => m === monthName)
      if (monthIdx === -1 || !yearStr) return null
      return `${yearStr}-${String(monthIdx + 1).padStart(2, '0')}`
    }

    // "YYYY-MM" → total bank costs (expense + capex)
    const costsByMonth: Record<string, number> = {}
    for (const row of (costsRes as any).rows) {
      const key = labelToKey(row.label)
      if (key) costsByMonth[key] = parseFloat(row.total_costs || 0)
    }

    // "YYYY-MM" → bank revenue
    const revenueByMonth: Record<string, number> = {}
    for (const row of (revenueByMonthRes as any).rows) {
      const key = labelToKey(row.label)
      if (key) revenueByMonth[key] = parseFloat(row.total_revenue || 0)
    }

    // year → total cash received (aggregate by year from label)
    const bankReceivedByYear: Record<number, number> = {}
    for (const row of (bankRes as any).rows) {
      const key = labelToKey(row.label)
      if (!key) continue
      const yr = parseInt(key.split('-')[0])
      bankReceivedByYear[yr] = (bankReceivedByYear[yr] || 0) + parseFloat(row.total || 0)
    }

    // year → total expense invoices (vendor bills entered in the system)
    const invoicedCostsByYear: Record<number, number> = {}
    for (const row of (invoiceCostsRes as any).rows) {
      invoicedCostsByYear[row.yr] = parseFloat(row.total || 0)
    }

    // year → investor deposits
    const investmentByYear: Record<number, number> = {}
    for (const row of (investmentRes as any).rows) {
      const key = labelToKey(row.label)
      if (!key) continue
      const yr = parseInt(key.split('-')[0])
      investmentByYear[yr] = (investmentByYear[yr] || 0) + parseFloat(row.total || 0)
    }

    const openingCash = parseFloat((openingRes as any).rows[0]?.opening_cash || 0)

    // Build history: earliest year with bank data (floor 2025) → today
    const today        = new Date()
    const currentYear  = today.getFullYear()
    const earliestYear = Math.min(
      2025,
      ...(costsRes as any).rows.map((r: any) => new Date(r.start_date).getFullYear()).filter(Boolean),
    )

    const history: { month: string; year: number; confirmed: number; pending: number; costs: number; net: number; bankCashIn: number }[] = []

    for (let yr = earliestYear; yr <= currentYear; yr++) {
      const lastMonth = yr < currentYear ? 11 : today.getMonth()
      for (let m = 0; m <= lastMonth; m++) {
        const label     = `${MONTH_NAMES_SHORT[m]} ${yr}`
        const key       = `${yr}-${String(m + 1).padStart(2, '0')}`
        const mStart      = new Date(yr, m, 1)
        const mEnd        = new Date(yr, m + 1, 0)
        const confirmed   = invRows.length > 0 ? calcMrrForMonth(invRows, mStart, mEnd) : (revenueByMonth[key] || 0)
        const costs       = costsByMonth[key] || 0
        const bankCashIn  = revenueByMonth[key] || 0
        history.push({ month: label, year: yr, confirmed, pending: 0, costs, net: confirmed - costs, bankCashIn })
      }
    }

    // ── Client breakdown for selected month or full year ──────────────────────
    let clientBreakdown: {
      invoiceId: string; name: string; annualAmount: number; billingType: string; issueDate: string
      isNew: boolean; isPending: boolean; isOneOff: boolean; isCarryover: boolean; countedInMrr: boolean
    }[] = []

    if (monthParam && invRows.length > 0) {
      const [monthName, yearStr] = monthParam.split('_')
      const yearNum              = parseInt(yearStr) || currentYear
      const selectedMonthIdx     = MONTH_NAMES_LONG.findIndex(m => m === monthName)

      const selectedMonthStart = yearViewParam
        ? new Date(yearNum, 0, 1)
        : new Date(yearNum, selectedMonthIdx, 1)
      const selectedMonthEnd = yearViewParam
        ? new Date(yearNum, 11, 31)
        : new Date(yearNum, selectedMonthIdx + 1, 0)

      const entries: {
        invoiceId: string; name: string; monthlyMrr: number; billingType: string
        isPending: boolean; isOneOff: boolean; isCarryover: boolean; issueDate: string
      }[] = []

      for (const r of invRows) {
        const invoiceId    = (r[0] || '').trim()
        const clientName   = (r[8] || r[1] || '').trim() // col I = display name override, col B = base name
        const amount       = parseNum((r[5] || '').toString())
        const status       = (r[6] || '').toLowerCase().trim()
        const billingType  = (r[7] || 'annual').toLowerCase().trim()
        const issueDateStr = (r[4] || '').trim()

        if (!clientName || !amount) continue
        if (!isActiveStatus(status)) continue

        const isOneOff  = billingType === 'one-off' || billingType === 'one off' || billingType === 'oneoff'
        const pending   = isPendingStatus(status)

        // HC split: if client name matches a holding company, distribute across active subs
        const clientWords = clientName.toLowerCase().replace(/[.,\/#!$%^&*;:{}=_`~()'"]/g, '').split(' ').filter((w: string) => w.length > 1)
        const matchedHcKey = Object.keys(holdingMap).find(key => {
          const hcWords = key.replace(/[.,\/#!$%^&*;:{}=_`~()'"]/g, '').split(' ').filter((w: string) => w.length > 1)
          return hcWords.length > 0 && hcWords.every((w: string) => clientWords.includes(w))
        })
        const subsidiaries = matchedHcKey ? holdingMap[matchedHcKey] : undefined
        const subCount     = subsidiaries?.length || 0

        if (isOneOff) {
          const d = parseInvDate(issueDateStr)
          if (!d || d < selectedMonthStart || d > selectedMonthEnd) continue
          if (subCount > 0) {
            subsidiaries!.forEach((subName, idx) => {
              entries.push({ invoiceId: `${invoiceId}_split_${idx}`, name: subName, monthlyMrr: amount / subCount, billingType: 'one-off', isPending: pending, isOneOff: true, isCarryover: false, issueDate: issueDateStr })
            })
          } else {
            entries.push({ invoiceId, name: clientName, monthlyMrr: amount, billingType: 'one-off', isPending: pending, isOneOff: true, isCarryover: false, issueDate: issueDateStr })
          }
        } else {
          const d = parseInvDate(issueDateStr)
          if (!d || d > selectedMonthEnd) continue
          if (contractEnd(d, billingType) <= selectedMonthStart) continue
          const isCarryover = d.getFullYear() < yearNum
          const monthly     = calcMonthlyMrr(amount, billingType)
          if (subCount > 0) {
            subsidiaries!.forEach((subName, idx) => {
              entries.push({ invoiceId: `${invoiceId}_split_${idx}`, name: subName, monthlyMrr: monthly / subCount, billingType, isPending: pending, isOneOff: false, isCarryover, issueDate: issueDateStr })
            })
          } else {
            entries.push({ invoiceId, name: clientName, monthlyMrr: monthly, billingType, isPending: pending, isOneOff: false, isCarryover, issueDate: issueDateStr })
          }
        }
      }

      const seenInvoiceKeys = new Set<string>()
      const countedIds      = new Set<string>()
      for (const c of entries) {
        const key = c.invoiceId || `${c.name.toLowerCase()}|${c.issueDate}|${c.monthlyMrr}`
        if (!seenInvoiceKeys.has(key)) {
          seenInvoiceKeys.add(key)
          countedIds.add(c.invoiceId || c.issueDate)
        }
      }

      clientBreakdown = entries
        .filter(c => c.monthlyMrr > 0)
        .sort((a, b) => (parseInvDate(a.issueDate)?.getTime() || 0) - (parseInvDate(b.issueDate)?.getTime() || 0))
        .map(c => ({
          invoiceId:    c.invoiceId,
          name:         c.name,
          annualAmount: c.isOneOff ? Math.round(c.monthlyMrr) : Math.round(c.monthlyMrr * 12),
          billingType:  c.billingType,
          issueDate:    c.issueDate,
          isNew:        false,
          isPending:    c.isPending,
          isOneOff:     c.isOneOff,
          isCarryover:  c.isCarryover,
          countedInMrr: countedIds.has(c.invoiceId || c.issueDate),
        }))
    }

    // ── Pending + Pipeline from invoice tracker ───────────────────────────────
    const todayMs = Date.now()
    const pendingFromSheet: { invoiceId: string; clientName: string; amount: number; issueDate: string; daysOutstanding: number; billingType: string }[] = []
    const pipelineFromSheet: { invoiceId: string; clientName: string; amount: number; issueDate: string; billingType: string; notes: string }[] = []

    for (const r of invRows) {
      const invoiceId    = (r[0] || '').trim()
      const clientName   = (r[8] || r[1] || '').trim()
      const amount       = parseNum((r[5] || '').toString())
      const rawStatus    = (r[6] || '').trim()
      const statusNorm   = rawStatus.toLowerCase().replace(/[\s\-]+/g, '')
      const billingType  = (r[7] || 'annual').toLowerCase().trim()
      const issueDateStr = (r[4] || '').trim()
      if (!clientName && !invoiceId) continue

      if (statusNorm === 'sent' && amount > 0) {
        const d = parseInvDate(issueDateStr)
        const daysOutstanding = d ? Math.floor((todayMs - d.getTime()) / 86400000) : 0
        pendingFromSheet.push({ invoiceId, clientName, amount, issueDate: issueDateStr, daysOutstanding, billingType })
      }
      if (statusNorm === 'salessent') {
        pipelineFromSheet.push({ invoiceId, clientName, amount, issueDate: issueDateStr, billingType, notes: '' })
      }
    }

    // ── Total invoiced per year (full invoice amounts from tracker) ───────────
    const totalInvoicedByYear: Record<number, number> = {}
    const seenForInvoiced = new Set<string>()
    for (const r of invRows) {
      const invoiceId    = (r[0] || '').trim()
      const clientName   = (r[8] || r[1] || '').trim()
      const amount       = parseNum((r[5] || '').toString())
      const status       = (r[6] || '').toLowerCase().trim()
      const issueDateStr = (r[4] || '').trim()
      if (!clientName || !amount || !isActiveStatus(status)) continue
      const d = parseInvDate(issueDateStr)
      if (!d) continue
      const key = invoiceId || `${clientName.toLowerCase()}|${issueDateStr}|${amount}`
      if (seenForInvoiced.has(key)) continue
      seenForInvoiced.add(key)
      const yr = d.getFullYear()
      totalInvoicedByYear[yr] = (totalInvoicedByYear[yr] || 0) + amount
    }

    // ── Year totals ───────────────────────────────────────────────────────────
    const yearTotals: Record<number, { mrr: number; costs: number; net: number }> = {}
    for (const pt of history) {
      if (pt.confirmed === 0 && pt.costs === 0) continue
      if (!yearTotals[pt.year]) yearTotals[pt.year] = { mrr: 0, costs: 0, net: 0 }
      yearTotals[pt.year].mrr   += pt.confirmed
      yearTotals[pt.year].costs += pt.costs
      yearTotals[pt.year].net   += pt.net
    }

    return NextResponse.json({
      history,
      clientBreakdown,
      yearTotals,
      totalInvoicedByYear,
      bankReceivedByYear,
      invoicedCostsByYear,
      investmentByYear,
      openingCash,
      pendingFromSheet,
      pipelineFromSheet,
    })
  } catch (err: any) {
    console.error('MRR history error:', err.message)
    return NextResponse.json({ history: [], clientBreakdown: [], yearTotals: {} })
  }
}
