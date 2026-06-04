import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { google } from 'googleapis'
import { query } from '@/lib/db'
import { cachedSheet } from '@/lib/sheets-cache'

const MRR_SHEET_ID     = '1057EJCsrTPT7LFHBYqsqYVVERuwgZ7kScmHy8j1Or8s'
const MRR_TAB          = '🟩 MRR'
const INVOICE_SHEET_ID = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'

const MONTH_COLS: { month: string; col: string; year: number }[] = [
  { month: 'Jan 2025', col: 'E',  year: 2025 },
  { month: 'Feb 2025', col: 'F',  year: 2025 },
  { month: 'Mar 2025', col: 'G',  year: 2025 },
  { month: 'Apr 2025', col: 'H',  year: 2025 },
  { month: 'May 2025', col: 'I',  year: 2025 },
  { month: 'Jun 2025', col: 'J',  year: 2025 },
  { month: 'Jul 2025', col: 'K',  year: 2025 },
  { month: 'Aug 2025', col: 'L',  year: 2025 },
  { month: 'Sep 2025', col: 'M',  year: 2025 },
  { month: 'Oct 2025', col: 'N',  year: 2025 },
  { month: 'Nov 2025', col: 'O',  year: 2025 },
  { month: 'Dec 2025', col: 'P',  year: 2025 },
]

const MONTH_NAMES_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getSheetClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

function calcMonthlyMrr(amount: number, billingType: string): number {
  const t = (billingType || 'annual').toLowerCase().trim()
  if (t === 'monthly')   return amount
  if (t === 'quarterly') return amount / 3
  return amount / 12
}

function colToIndex(col: string): number {
  let result = 0
  for (const ch of col.toUpperCase()) result = result * 26 + ch.charCodeAt(0) - 64
  return result - 1
}

function parseNum(val: any): number {
  if (!val) return 0
  return parseFloat(val.toString().replace(/[$,\s]/g, '')) || 0
}

function parseDate(str: string): Date | null {
  if (!str || typeof str !== 'string') return null
  const s = str.trim()
  if (!s) return null
  // ISO or standard JS-parseable
  const d1 = new Date(s)
  if (!isNaN(d1.getTime())) return d1
  // DD/MM/YYYY or DD-MM-YYYY
  const parts = s.split(/[\/\-]/)
  if (parts.length === 3) {
    const attempt = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`)
    if (!isNaN(attempt.getTime())) return attempt
  }
  return null
}

function contractEnd(issueDate: Date, billingType: string): Date {
  const end = new Date(issueDate)
  const t = (billingType || 'annual').toLowerCase().trim()
  if (t === 'quarterly')    end.setMonth(end.getMonth() + 3)
  else if (t === 'monthly') end.setMonth(end.getMonth() + 1)
  else                      end.setMonth(end.getMonth() + 12) // annual default
  end.setDate(1) // normalize to month boundary (Sep 2025 annual → Sep 1 2026, active through Aug 2026)
  return end
}

function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase().trim()
  return (
    s.includes('paid') ||
    s === 'sent' ||
    s === 'invoiced' ||
    s === 'outstanding' ||
    s === 'due'
  )
}

function isPendingStatus(status: string): boolean {
  const s = status.toLowerCase().trim()
  return !s.includes('paid')
}

function calcMrrForMonth(invRows: any[][], monthStart: Date, monthEnd: Date): number {
  // Dedup by invoice ID only — a client can have multiple active invoices
  const seenKeys = new Set<string>()
  let total = 0
  for (const r of invRows) {
    const invoiceId    = (r[0] || '').trim()
    const clientName   = (r[1] || '').trim()
    const amount       = parseNum((r[5] || '').toString())
    const status       = (r[6] || '').toLowerCase().trim()
    const billingType  = (r[7] || 'annual').toLowerCase().trim()
    const issueDateStr = (r[4] || '').trim()
    if (!clientName || !amount) continue
    if (!isActiveStatus(status)) continue

    const isOneOff = billingType === 'one-off' || billingType === 'one off' || billingType === 'oneoff'
    const d = parseDate(issueDateStr)
    const key = invoiceId || `${clientName.toLowerCase()}|${issueDateStr}|${amount}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    if (isOneOff) {
      if (!d || d < monthStart || d > monthEnd) continue
      total += amount
    } else {
      if (!d || d > monthEnd) continue
      if (contractEnd(d, billingType) <= monthStart) continue
      total += calcMonthlyMrr(amount, billingType)
    }
  }
  return Math.round(total)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthParam = new URL(req.url).searchParams.get('month')

  try {
    const sheets = getSheetClient()

    // ── 1 & 2. Fetch both sheets in parallel, with caching ───────────────────
    const [mrrRows, invRows] = await Promise.all([
      cachedSheet('mrr-sheet', async () => {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: MRR_SHEET_ID,
          range: `'${MRR_TAB}'!A1:S40`,
        })
        return res.data.values || []
      }),
      cachedSheet('invoice-sheet', async () => {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: INVOICE_SHEET_ID,
          range: `All time!A2:I500`,
        })
        return res.data.values || []
      }),
    ])

    const getCell = (row: number, col: string): any => (mrrRows[row - 1] || [])[colToIndex(col)]

    // Build 2025 history — confirmed MRR from invoice tracker, costs from MRR sheet
    const history: { month: string; year: number; confirmed: number; pending: number; costs: number; net: number }[] =
      MONTH_COLS.map(({ month, col, year }) => {
        const payroll = parseNum(getCell(29, col))
        const subs    = parseNum(getCell(30, col))
        const sleek   = parseNum(getCell(31, col))
        const costs   = payroll + subs + sleek
        return { month, year, confirmed: 0, pending: 0, costs: costs || 0, net: 0 }
      })

    const closing2025    = parseNum(getCell(37, 'S'))
    const cumulativeCash = closing2025

    // ── 3. Fill confirmed MRR for all months from invoice tracker ────────────
    // 2025: fills the confirmed field (costs already set from MRR sheet above)
    // 2026+: adds new month entries with confirmed from invoice tracker
    if (invRows.length > 0) {
      // Fill 2025 confirmed from invoice tracker
      for (const pt of history) {
        const mIdx   = MONTH_NAMES_SHORT.indexOf(pt.month.split(' ')[0])
        const mStart = new Date(pt.year, mIdx, 1)
        const mEnd   = new Date(pt.year, mIdx + 1, 0)
        pt.confirmed = calcMrrForMonth(invRows, mStart, mEnd)
        pt.net       = pt.confirmed - pt.costs
      }

      // Add 2026+ months — costs from DB invoices (incoming expense invoices per period)
      const today       = new Date()
      const currentYear = today.getFullYear()
      const maxYear     = Math.max(currentYear, 2026)

      // Load all periods with their total expense costs from DB
      const costsRes = await query(
        `SELECT p.start_date, COALESCE(SUM(i.amount_usd), 0) AS total_costs
         FROM periods p
         LEFT JOIN invoices i ON i.period_id = p.id
         WHERE EXTRACT(year FROM p.start_date) >= 2026
         GROUP BY p.start_date`
      ).catch(() => ({ rows: [] }))
      // Key: "YYYY-MM" → total costs in USD
      const costsByMonth: Record<string, number> = {}
      for (const row of (costsRes as any).rows) {
        const d = new Date(row.start_date)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        costsByMonth[key] = parseFloat(row.total_costs || 0)
      }

      for (let yr = 2026; yr <= maxYear; yr++) {
        const lastMonth = yr < currentYear ? 11 : today.getMonth()
        for (let m = 0; m <= lastMonth; m++) {
          const label = `${MONTH_NAMES_SHORT[m]} ${yr}`
          if (history.some(h => h.month === label)) continue
          const mStart    = new Date(yr, m, 1)
          const mEnd      = new Date(yr, m + 1, 0)
          const confirmed = calcMrrForMonth(invRows, mStart, mEnd)
          const key       = `${yr}-${String(m + 1).padStart(2, '0')}`
          const costs     = costsByMonth[key] || 0
          history.push({ month: label, year: yr, confirmed, pending: 0, costs, net: confirmed - costs })
        }
      }
    }

    // Sort chronologically
    history.sort((a, b) => {
      const [am, ay] = a.month.split(' ')
      const [bm, by] = b.month.split(' ')
      return parseInt(ay) !== parseInt(by)
        ? parseInt(ay) - parseInt(by)
        : MONTH_NAMES_SHORT.indexOf(am) - MONTH_NAMES_SHORT.indexOf(bm)
    })

    // ── 5. Client breakdown for selected month or full year ───────────────────
    const yearViewParam = new URL(req.url).searchParams.get('yearView') === 'true'

    let clientBreakdown: {
      invoiceId: string; name: string; annualAmount: number; billingType: string; issueDate: string
      isNew: boolean; isPending: boolean; isOneOff: boolean; isCarryover: boolean; countedInMrr: boolean
    }[] = []

    if (monthParam && invRows.length > 0) {
      const [monthName, year] = monthParam.split('_')
      const yearNum            = parseInt(year) || new Date().getFullYear()
      const selectedMonthIdx   = MONTH_NAMES_LONG.findIndex(m => m === monthName)

      // Full year view: Jan 1 → Dec 31 of the selected year
      // Month view: first → last day of the selected month
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
        const clientName   = (r[1] || '').trim()
        const amount       = parseNum((r[5] || '').toString())
        const status       = (r[6] || '').toLowerCase().trim()
        const billingType  = (r[7] || 'annual').toLowerCase().trim()
        const issueDateStr = (r[4] || '').trim()

        if (!clientName || !amount) continue
        if (!isActiveStatus(status)) continue

        const isOneOff = billingType === 'one-off' || billingType === 'one off' || billingType === 'oneoff'
        const isPending = isPendingStatus(status)

        if (isOneOff) {
          const d = parseDate(issueDateStr)
          if (!d || d < selectedMonthStart || d > selectedMonthEnd) continue
          entries.push({ invoiceId, name: clientName, monthlyMrr: amount, billingType: 'one-off', isPending, isOneOff: true, isCarryover: false, issueDate: issueDateStr })
        } else {
          const d = parseDate(issueDateStr)
          if (!d) continue
          if (d > selectedMonthEnd) continue
          if (contractEnd(d, billingType) <= selectedMonthStart) continue
          const isCarryover = d.getFullYear() < yearNum
          entries.push({ invoiceId, name: clientName, monthlyMrr: calcMonthlyMrr(amount, billingType), billingType, isPending, isOneOff: false, isCarryover, issueDate: issueDateStr })
        }
      }

      console.log(`[mrr/history] ${monthParam}: ${entries.length} active invoice rows`)

      // Dedup by invoice ID only — a client can have multiple active invoices (different products).
      // Only skip exact duplicate rows (same invoice ID appearing more than once in the sheet).
      const seenInvoiceKeys = new Set<string>()
      const countedIds      = new Set<string>()
      for (const c of entries) {
        const key = c.invoiceId || `${c.name.toLowerCase()}|${c.issueDate}|${c.monthlyMrr}`
        if (!seenInvoiceKeys.has(key)) {
          seenInvoiceKeys.add(key)
          countedIds.add(c.invoiceId || c.issueDate)
        }
      }

      // Final list sorted oldest → newest for display
      clientBreakdown = entries
        .filter(c => c.monthlyMrr > 0)
        .sort((a, b) => (parseDate(a.issueDate)?.getTime() || 0) - (parseDate(b.issueDate)?.getTime() || 0))
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

    // ── 6. Total cash received per year from bank statements ─────────────────
    const bankReceivedByYear: Record<number, number> = {}
    try {
      const bankRes = await query(
        `SELECT EXTRACT(year FROM p.start_date)::int AS yr,
                COALESCE(SUM(bt.amount_usd), 0) AS total
         FROM bank_transactions bt
         JOIN periods p ON p.id = bt.period_id
         WHERE bt.type = 'revenue'
         GROUP BY yr`
      )
      for (const row of bankRes.rows) {
        bankReceivedByYear[row.yr] = parseFloat(row.total || 0)
      }
    } catch (e) {
      console.error('[mrr/history] bank received query failed:', e)
    }

    // ── 7. Total invoiced per year (cash basis — full invoice amounts issued that year) ──
    const totalInvoicedByYear: Record<number, number> = {}
    if (invRows.length > 0) {
      const seenKeys = new Set<string>()
      for (const r of invRows) {
        const invoiceId    = (r[0] || '').trim()
        const clientName   = (r[1] || '').trim()
        const amount       = parseNum((r[5] || '').toString())
        const status       = (r[6] || '').toLowerCase().trim()
        const issueDateStr = (r[4] || '').trim()
        if (!clientName || !amount) continue
        if (!isActiveStatus(status)) continue
        const d = parseDate(issueDateStr)
        if (!d) continue
        const key = invoiceId || `${clientName.toLowerCase()}|${issueDateStr}|${amount}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        const yr = d.getFullYear()
        totalInvoicedByYear[yr] = (totalInvoicedByYear[yr] || 0) + amount
      }
    }

    // ── 7. Year totals ────────────────────────────────────────────────────────
    const yearTotals: Record<number, { mrr: number; costs: number; net: number }> = {}
    for (const pt of history) {
      if (pt.confirmed === 0 && pt.costs === 0) continue // skip empty months for totals
      const yr = parseInt(pt.month.split(' ')[1])
      if (!yearTotals[yr]) yearTotals[yr] = { mrr: 0, costs: 0, net: 0 }
      yearTotals[yr].mrr   += pt.confirmed
      yearTotals[yr].costs += pt.costs
      yearTotals[yr].net   += pt.net
    }

    return NextResponse.json({ history, clientBreakdown, yearTotals, totalInvoicedByYear, bankReceivedByYear, cumulativeCash, closing2025 })
  } catch (err: any) {
    console.error('MRR history error:', err.message)
    return NextResponse.json({ history: [], clientBreakdown: [], yearTotals: {} })
  }
}
