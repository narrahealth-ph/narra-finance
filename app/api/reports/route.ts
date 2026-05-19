import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { google } from 'googleapis'

const INVOICE_SHEET_ID = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

/** Months between two dates (positive = date2 is after date1) */
function monthsBetween(d1: Date, d2: Date): number {
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth())
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const periodId = searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

  const periodRes = await query('SELECT * FROM periods WHERE id = $1', [periodId])
  if (!periodRes.rows[0]) return NextResponse.json({ error: 'Period not found' }, { status: 404 })
  const p = periodRes.rows[0]

  // ── Raw data for this period ──────────────────────────────────────────────────
  const [invoicesRes, bankTxsRes, mrrRes, fxRes] = await Promise.all([
    query('SELECT * FROM invoices WHERE period_id = $1 ORDER BY account_name, date', [periodId]),
    query('SELECT * FROM bank_transactions WHERE period_id = $1 ORDER BY date', [periodId]),
    query('SELECT * FROM mrr_entries WHERE period_id = $1 ORDER BY amount_usd DESC', [periodId]),
    query(`SELECT DISTINCT ON (currency) currency, rate, date FROM fx_rates
           WHERE date BETWEEN $1 AND $2 AND currency != 'USD'
           ORDER BY currency, date DESC`, [p.start_date, p.end_date]).catch(() => ({ rows: [] })),
  ])

  const invoices  = invoicesRes.rows
  const bankTxs   = bankTxsRes.rows
  const mrrRows   = mrrRes.rows
  const fxRates   = (fxRes as any).rows || []

  // Safe USD amount: use amount_usd if set, fall back to amount ONLY for USD transactions
  const safeUsd = (r: any) => {
    const usd = parseFloat(r.amount_usd)
    if (!isNaN(usd) && usd > 0) return usd
    if ((r.currency || 'USD') === 'USD') return parseFloat(r.amount || 0)
    return 0 // never use raw foreign-currency amount as USD
  }

  // ── P&L ──────────────────────────────────────────────────────────────────────
  const totalExpenses = invoices.reduce((s: number, r: any) => s + safeUsd(r), 0)
  const revenueRows   = bankTxs.filter((r: any) => r.type === 'revenue')

  // Use accrual MRR revenue (mrr_entries) when synced, otherwise fall back to cash revenue
  const mrrRevenue  = mrrRows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const bankRevenue = revenueRows.reduce((s: number, r: any) => s + safeUsd(r), 0)
  const totalRevenue = mrrRevenue > 0 ? mrrRevenue : bankRevenue

  const netProfit     = totalRevenue - totalExpenses

  const expenseByAccount: Record<string, any[]> = {}
  for (const inv of invoices) {
    const acct = inv.account_name || 'Uncategorized'
    if (!expenseByAccount[acct]) expenseByAccount[acct] = []
    expenseByAccount[acct].push(inv)
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

  // ── General Ledger ────────────────────────────────────────────────────────────
  const openingRows = bankTxs.filter((r: any) => r.type === 'opening')
  const cashOpening = openingRows.reduce((s: number, r: any) => s + safeUsd(r), 0)
  const cashClosingLegacy = cashOpening + totalRevenue - totalExpenses

  const glData = {
    period: p,
    expenseByAccount,
    revenueRows,
    bankOpeningRows: openingRows,
    totalExpenses,
    totalRevenue,
    netProfit,
    cashOpening,
    cashClosing: cashClosingLegacy,
  }

  // ── Balance Sheet ─────────────────────────────────────────────────────────────

  // 1. Cash per bank account (converted to USD)
  const cashByAccount: Record<string, { amount: number; label: string }> = {}
  for (const tx of bankTxs) {
    const acct = tx.account || 'Main'
    if (!cashByAccount[acct]) cashByAccount[acct] = { amount: 0, label: acct }
    if (tx.type === 'opening')       cashByAccount[acct].amount += safeUsd(tx)
    else if (tx.type === 'revenue')  cashByAccount[acct].amount += safeUsd(tx)
    else if (tx.type === 'expense')  cashByAccount[acct].amount -= safeUsd(tx)
  }
  const totalCash = Object.values(cashByAccount).reduce((s, v) => s + v.amount, 0)

  // 2. Accounts Receivable (600) + Deferred Revenue
  //    Fetch outgoing invoices from Google Sheet
  let arTotal         = 0
  let deferredRevenue = 0
  const arItems: any[] = []

  try {
    const sheets     = getSheetsClient()
    const periodEnd  = new Date(p.end_date)
    const sheetYear  = periodEnd.getFullYear()
    const tabName    = String(sheetYear)

    const invRes = await sheets.spreadsheets.values.get({
      spreadsheetId: INVOICE_SHEET_ID,
      range:         `All time!A2:I500`,
    })
    const rows = invRes.data.values || []

    for (const r of rows) {
      if (!r[0] || !r[5]) continue // skip rows without invoice ID or amount
      const amount      = parseFloat((r[5] || '0').replace(/[$,\s]/g, '')) || 0
      const status      = (r[6] || '').toLowerCase().trim()
      const billingType = (r[7] || 'annual').toLowerCase().trim()
      const issueDateStr = r[4] || ''

      // AR: invoices that are Sent but not yet Paid
      if (!['paid', 'cancelled', 'void'].includes(status)) {
        arTotal += amount
        arItems.push({ invoiceId: r[0], clientName: r[1], amount, status, billingType })
      }

      // Deferred Revenue: paid invoices where contract period extends beyond this month
      if (status === 'paid' && issueDateStr) {
        const issueDate = new Date(issueDateStr)
        if (isNaN(issueDate.getTime())) continue
        const elapsed = monthsBetween(issueDate, periodEnd)

        if (billingType === 'annual') {
          const remaining = Math.max(0, 12 - elapsed)
          if (remaining > 0) deferredRevenue += amount * (remaining / 12)
        } else if (billingType === 'quarterly') {
          const remaining = Math.max(0, 3 - elapsed)
          if (remaining > 0) deferredRevenue += amount * (remaining / 3)
        }
        // monthly: no deferred revenue
      }
    }
  } catch (err: any) {
    console.error('[reports/bs] Could not fetch outgoing invoices for AR/Deferred:', err.message)
  }

  // 3. Accounts Payable (800): unmatched expense invoices
  const apTotal = invoices
    .filter((r: any) => r.status === 'unmatched')
    .reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)

  // 4. Manual entries (prepayments, intangibles, loans, director amounts, etc.)
  const manualRes = await query(
    'SELECT account_code, value FROM manual_entries WHERE period_id = $1',
    [periodId]
  )
  const manual: Record<string, number> = {}
  for (const row of manualRes.rows) manual[row.account_code] = parseFloat(row.value || 0)
  const m = (code: string, def = 0) => manual[code] ?? def

  // 5. Retained earnings: cumulative net profit from ALL prior periods
  //    (current period P&L shown separately as "Provisional Profit/Loss")
  let retainedEarnings = 0
  try {
    const priorRes = await query(
      `SELECT p.id FROM periods p WHERE p.start_date < $1 ORDER BY p.start_date`,
      [p.start_date]
    )
    for (const pp of priorRes.rows) {
      const ppExp = await query('SELECT COALESCE(SUM(amount_usd),0) as t FROM invoices WHERE period_id = $1', [pp.id])
      const ppRev = await query("SELECT COALESCE(SUM(amount_usd),0) as t FROM bank_transactions WHERE period_id = $1 AND type='revenue'", [pp.id])
      retainedEarnings += parseFloat(ppRev.rows[0].t) - parseFloat(ppExp.rows[0].t)
    }
  } catch (err: any) {
    console.error('[reports/bs] Retained earnings calc error:', err.message)
  }

  // 6. Balance Sheet totals

  // Prepayments (610): auto-calculated from amortization schedules
  // Falls back to manual entry 610 if no schedules have been created yet
  let prepayments = m('610', 0)
  try {
    const scheduleRes = await query('SELECT * FROM prepayment_schedules ORDER BY start_date')
    if (scheduleRes.rows.length > 0) {
      prepayments = 0
      const periodEnd = new Date(p.end_date)
      for (const s of scheduleRes.rows) {
        const startDate    = new Date(s.start_date)
        // monthsElapsed + 1 = months already consumed (including current month)
        const monthsConsumed = monthsBetween(startDate, periodEnd) + 1
        const remaining      = Math.max(0, parseInt(s.months) - monthsConsumed)
        if (remaining > 0) {
          prepayments += parseFloat(s.total_amount) * (remaining / parseInt(s.months))
        }
      }
      prepayments = Math.round(prepayments * 100) / 100
    }
  } catch (err: any) {
    console.error('[reports/bs] Prepayment schedule error:', err.message)
  }
  const fixedAssets       = m('fixed_assets', 0)
  const intangibleAssets  = m('670', 0)
  const shareCapital      = m('900', 2.10)
  const loans             = m('851', 0)
  const director835       = m('835', 0)
  const director840       = m('840', 0)
  const director842       = m('842', 0)
  const investment852     = m('852', 0)
  const investment853     = m('853', 0)
  const incomeTax         = m('860', 0)
  const gstPayable        = m('gst', 0)

  const totalCurrentAssets     = totalCash + arTotal + prepayments
  const totalNonCurrentAssets  = fixedAssets + intangibleAssets
  const totalAssets            = totalCurrentAssets + totalNonCurrentAssets

  const totalCurrentLiabilities    = apTotal + deferredRevenue + director835 + director840 + director842 + incomeTax + gstPayable
  const totalNonCurrentLiabilities = loans + investment852 + investment853
  const totalLiabilities           = totalCurrentLiabilities + totalNonCurrentLiabilities

  // Equity = Share Capital + Retained Earnings + Current Period P&L
  const totalEquity = shareCapital + retainedEarnings + netProfit

  const bsData = {
    period: p,
    // Current Assets
    cashByAccount,
    totalCash,
    arTotal,
    arItems,
    prepayments,
    totalCurrentAssets,
    // Non-current Assets
    fixedAssets,
    intangibleAssets,
    totalNonCurrentAssets,
    totalAssets,
    // Current Liabilities
    accountsPayable:    apTotal,
    deferredRevenue,
    director835,
    director840,
    director842,
    incomeTax,
    gstPayable,
    totalCurrentLiabilities,
    // Non-current Liabilities
    loans,
    investment852,
    investment853,
    totalNonCurrentLiabilities,
    totalLiabilities,
    // Equity
    shareCapital,
    retainedEarnings,
    provisionalPL:  netProfit,
    totalEquity,
    // Check: totalAssets should equal totalLiabilities + totalEquity
    balanceCheck:   Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    // Legacy fields used by ReportsPanel CSV builder
    cashClosing:    totalCash,
    cashUSD:        cashByAccount['USD']?.amount || cashByAccount['SBA - USD']?.amount || 0,
  }

  // ── MRR ───────────────────────────────────────────────────────────────────────
  const totalMrr = mrrRows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const mrrData = { period: p, clients: mrrRows, totalMrr, clientCount: mrrRows.length }

  // ── Reconciliation summary ────────────────────────────────────────────────────
  const unmatchedInvoices = invoices.filter((r: any) => r.status === 'unmatched')
  const unmatchedBank     = bankTxs.filter((r: any) => r.status === 'unmatched' && r.type === 'expense')
  const flaggedMatches    = bankTxs.filter((r: any) => r.status === 'flagged')

  return NextResponse.json({
    gl: glData,
    bs: bsData,
    pl: plData,
    mrr: mrrData,
    fxRates: fxRates.map((r: any) => ({ currency: r.currency, rate: parseFloat(r.rate), date: r.date })),
    reconciliation: {
      unmatchedInvoices,
      unmatchedBank,
      flaggedMatches,
      matchedCount:    invoices.filter((r: any) => r.status === 'matched').length,
      proposedCount:   invoices.filter((r: any) => r.status === 'proposed').length,
      totalInvoices:   invoices.length,
      bankTxCount:     bankTxs.length,
    }
  })
}
