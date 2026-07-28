import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { google } from 'googleapis'
import { cachedSheet, clearSheetCache } from '@/lib/sheets-cache'

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

  if (searchParams.get('bust') === '1') clearSheetCache('invoice-sheet')

  const periodRes = await query('SELECT * FROM periods WHERE id = $1', [periodId])
  if (!periodRes.rows[0]) return NextResponse.json({ error: 'Period not found' }, { status: 404 })
  const p = periodRes.rows[0]

  // ── Raw data for this period — all queries in parallel ───────────────────────
  const [invoicesRes, bankTxsRes, mrrRes, fxRes, arSheetRes, retainedRes, prepayRes, manualRes2, cumulativeCashRes] = await Promise.all([
    query('SELECT * FROM invoices WHERE period_id = $1 ORDER BY account_name, date', [periodId]),
    query('SELECT * FROM bank_transactions WHERE period_id = $1 ORDER BY date', [periodId]),
    query('SELECT * FROM mrr_entries WHERE period_id = $1 ORDER BY amount_usd DESC', [periodId]),
    query(`SELECT DISTINCT ON (currency) currency, rate, date FROM fx_rates
           WHERE date BETWEEN $1 AND $2 AND currency != 'USD'
           ORDER BY currency, date DESC`, [p.start_date, p.end_date]).catch(() => ({ rows: [] })),
    // Google Sheets call for AR — shared cache with /api/mrr/history
    cachedSheet('invoice-sheet', async () => {
      const sheets = getSheetsClient()
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: INVOICE_SHEET_ID,
        range: `All time!A2:I500`,
      })
      return res.data.values || []
    }).catch(() => []),
    // Retained earnings — use bank transactions for both sides (consistent with current period P&L)
    query(
      `SELECT
         (SELECT COALESCE(SUM(bt.amount_usd), 0)
          FROM bank_transactions bt
          JOIN periods pp ON pp.id = bt.period_id
          WHERE pp.start_date < $1 AND bt.type = 'revenue') -
         (SELECT COALESCE(SUM(bt.amount_usd), 0)
          FROM bank_transactions bt
          JOIN periods pp ON pp.id = bt.period_id
          WHERE pp.start_date < $1 AND bt.type = 'expense') AS retained`,
      [p.start_date]
    ).catch(() => ({ rows: [{ retained: 0 }] })),
    // Prepayment schedules
    query('SELECT * FROM prepayment_schedules ORDER BY start_date').catch(() => ({ rows: [] })),
    // Manual entries
    query('SELECT account_code, value FROM manual_entries WHERE period_id = $1', [periodId]).catch(() => ({ rows: [] })),
    // Cumulative bank transactions for balance sheet cash (all periods up to and including current)
    query(
      `SELECT bt.account, bt.type, bt.amount, bt.currency, bt.amount_usd
       FROM bank_transactions bt
       JOIN periods pp ON pp.id = bt.period_id
       WHERE pp.end_date <= $1 AND bt.type IN ('opening','revenue','expense')
       ORDER BY pp.start_date ASC, bt.date ASC`,
      [p.end_date]
    ).catch(() => ({ rows: [] })),
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
  // Bank transactions are the source of truth — use expense txs for costs, revenue txs for income
  const revenueRows   = bankTxs.filter((r: any) => r.type === 'revenue')
  const expenseRows   = bankTxs.filter((r: any) => r.type === 'expense')
  const totalExpenses = expenseRows.reduce((s: number, r: any) => s + safeUsd(r), 0)

  const mrrRevenue  = mrrRows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const bankRevenue = revenueRows.reduce((s: number, r: any) => s + safeUsd(r), 0)

  // Bank transactions are the source of truth for revenue
  const totalRevenue  = bankRevenue
  const revenueSource = 'bank'

  const netProfit = totalRevenue - totalExpenses

  const expenseByAccount: Record<string, any[]> = {}
  for (const tx of expenseRows) {
    const acct = tx.account || tx.account_name || 'Uncategorized'
    if (!expenseByAccount[acct]) expenseByAccount[acct] = []
    expenseByAccount[acct].push(tx)
  }

  const plData = {
    period: p,
    revenueRows,
    expenseByAccount,
    totalRevenue,
    totalExpenses,
    netProfit,
    mrrRevenue,
    bankRevenue,
    revenueSource,
    mrrSynced: mrrRevenue > 0,
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

  // 1. Cash per bank account — cumulative across all periods up to current
  //    Only the FIRST opening balance per account is used (avoids double-counting when
  //    each period's opening = prior period's closing).
  const cashByAccount: Record<string, { amount: number; label: string }> = {}
  const seenOpening = new Set<string>()
  for (const tx of (cumulativeCashRes as any).rows) {
    const acct = tx.account || 'Main'
    if (!cashByAccount[acct]) cashByAccount[acct] = { amount: 0, label: acct }
    if (tx.type === 'opening') {
      if (!seenOpening.has(acct)) { seenOpening.add(acct); cashByAccount[acct].amount += safeUsd(tx) }
    } else if (tx.type === 'revenue') {
      cashByAccount[acct].amount += safeUsd(tx)
    } else if (tx.type === 'expense') {
      cashByAccount[acct].amount -= safeUsd(tx)
    }
  }
  const totalCash = Object.values(cashByAccount).reduce((s, v) => s + v.amount, 0)

  // 2. Accounts Receivable (600) + Deferred Revenue — from parallel arSheetRes
  let arTotal         = 0
  let deferredRevenue = 0
  const arItems: any[] = []
  const periodEnd = new Date(p.end_date)
  for (const r of (arSheetRes as any[])) {
    if (!r[0] || !r[5]) continue
    const amount       = parseFloat((r[5] || '0').replace(/[$,\s]/g, '')) || 0
    const status       = (r[6] || '').toLowerCase().trim()
    const billingType  = (r[7] || 'annual').toLowerCase().trim()
    const issueDateStr = r[4] || ''
    const issueDate    = issueDateStr ? new Date(issueDateStr) : null
    // Only include invoices issued on or before the period end date
    if (!['paid', 'cancelled', 'void'].includes(status) && (!issueDate || issueDate <= periodEnd)) {
      arTotal += amount
      arItems.push({ invoiceId: r[0], clientName: r[8] || r[1], amount, status, billingType, issueDate: issueDateStr })
    }
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
    }
  }

  // 3. Accounts Payable (800): invoices received but not yet paid (bills owed to suppliers)
  const apTotal = invoices
    .filter((r: any) => r.status === 'unmatched')
    .reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)

  // 4. Manual entries — from parallel manualRes2
  const manual: Record<string, number> = {}
  for (const row of (manualRes2 as any).rows) manual[row.account_code] = parseFloat(row.value || 0)
  const m = (code: string, def = 0) => manual[code] ?? def

  // 5. Retained earnings — from parallel retainedRes
  const retainedEarnings = parseFloat((retainedRes as any).rows[0]?.retained || 0)

  // 6. Balance Sheet totals — prepayments from parallel prepayRes
  let prepayments = m('610', 0)
  const scheduleRows = (prepayRes as any).rows
  if (scheduleRows.length > 0) {
    prepayments = 0
    for (const s of scheduleRows) {
      const startDate      = new Date(s.start_date)
      const monthsConsumed = monthsBetween(startDate, periodEnd) + 1
      const remaining      = Math.max(0, parseInt(s.months) - monthsConsumed)
      if (remaining > 0) {
        prepayments += parseFloat(s.total_amount) * (remaining / parseInt(s.months))
      }
    }
    prepayments = Math.round(prepayments * 100) / 100
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

  // AR is shown informally but excluded from the balance sheet equation because
  // P&L is cash-basis — revenue is only recognised when cash is received (bank tx).
  // Including accrual AR in assets without a matching credit in equity would break
  // the accounting equation. AR is passed through as a memo item for display only.
  const totalCurrentAssets     = totalCash + prepayments
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
