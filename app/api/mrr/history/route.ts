import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { google } from 'googleapis'

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
  { month: 'Jan 2026', col: 'Y',  year: 2026 },
  { month: 'Feb 2026', col: 'Z',  year: 2026 },
  { month: 'Mar 2026', col: 'AA', year: 2026 },
  { month: 'Apr 2026', col: 'AB', year: 2026 },
  { month: 'May 2026', col: 'AC', year: 2026 },
  { month: 'Jun 2026', col: 'AD', year: 2026 },
  { month: 'Jul 2026', col: 'AE', year: 2026 },
  { month: 'Aug 2026', col: 'AF', year: 2026 },
  { month: 'Sep 2026', col: 'AG', year: 2026 },
  { month: 'Oct 2026', col: 'AH', year: 2026 },
  { month: 'Nov 2026', col: 'AI', year: 2026 },
  { month: 'Dec 2026', col: 'AJ', year: 2026 },
]

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
  return amount / 12 // annual (default)
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

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthParam = new URL(req.url).searchParams.get('month')

  try {
    const sheets = getSheetClient()

    // Read entire sheet up to row 40, all relevant columns
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: MRR_SHEET_ID,
      range: `'${MRR_TAB}'!A1:AJ40`,
    })

    const allRows = res.data.values || []

    const getCell = (row: number, col: string): any => {
      return (allRows[row - 1] || [])[colToIndex(col)]
    }

    // Build monthly history from sheet totals
    const history = MONTH_COLS.map(({ month, col, year }) => {
      const confirmed = parseNum(getCell(3, col))   // row 3 = total MRR SUM
      // For 2025: costs from Sheet. For 2026+: costs come from bank (Sheet may be 0 until pushed)
      const payroll = parseNum(getCell(29, col))
      const subs    = parseNum(getCell(30, col))
      const sleek   = parseNum(getCell(31, col))
      const costs   = payroll + subs + sleek
      const net     = parseNum(getCell(37, col)) || (confirmed - costs)
      return { month, year, confirmed, pending: 0, costs: costs || 0, net: net || 0 }
    }).filter(d => d.confirmed > 0 || d.costs > 0)

    // Always include Jan 2025 even if MRR=0 (costs only month)
    if (!history.some(h => h.month === 'Jan 2025')) {
      history.unshift({ month: 'Jan 2025', year: 2025, confirmed: 0, pending: 0, costs: 1173, net: -1173 })
    }

    // ── Cumulative cash position ──────────────────────────────────────────────
    // S37 = closing cash balance end of 2025 (column S = summary column)
    // We read row 37 col S to get the 2025 closing balance
    const closing2025 = parseNum(getCell(37, 'S'))

    // Sum all 2026 net revenue months to date
    const net2026ToDate = history
      .filter(h => h.year === 2026)
      .reduce((s, h) => s + h.net, 0)

    const cumulativeCash = closing2025 + net2026ToDate

    // Per-client breakdown from outgoing invoice sheet (billing-type-aware)
    // Outgoing invoice columns: [0]=InvoiceID [1]=ClientName [4]=IssueDate [5]=Amount [6]=Status [7]=BillingType [8]=Notes
    let clientBreakdown: { name: string; annualAmount: number; billingType: string; isNew: boolean; isPending: boolean; isOneOff: boolean }[] = []

    if (monthParam) {
      const [, year] = monthParam.split('_')
      const yearNum  = parseInt(year) || new Date().getFullYear()

      try {
        const invRes = await sheets.spreadsheets.values.get({
          spreadsheetId: INVOICE_SHEET_ID,
          range: `${yearNum}!A2:I200`,
        })
        const invRows = invRes.data.values || []

        // Accumulate per-client MRR from invoices
        // Paid invoices → confirmed; Sent → pending; One-off → excluded
        // clientMap key = clientName:billingType to keep one-off separate from recurring
        const clientMap: Record<string, { name: string; monthlyMrr: number; billingType: string; isPending: boolean; isOneOff: boolean }> = {}

        for (const r of invRows) {
          const clientName  = (r[1] || '').trim()
          const rawAmount   = (r[5] || '').toString().replace(/[$,\s]/g, '')
          const amount      = parseFloat(rawAmount) || 0
          const status      = (r[6] || '').toLowerCase().trim()
          const billingType = (r[7] || 'Annual').toLowerCase().trim()

          if (!clientName || !amount || !r[0]) continue

          // Only paid (confirmed) and sent (pending) invoices
          if (status !== 'paid' && status !== 'sent') continue

          const isOneOff = billingType === 'one-off' || billingType === 'one off' || billingType === 'oneoff'
          // One-off: full invoice amount as revenue for this month (not divided)
          const monthlyMrr = isOneOff ? amount : calcMonthlyMrr(amount, billingType)
          // Use unique key per invoice for one-off (each invoice stands alone); group by client for recurring
          const key = isOneOff ? `${clientName.toLowerCase()}:${r[0]}` : clientName.toLowerCase()

          if (clientMap[key]) {
            clientMap[key].monthlyMrr += monthlyMrr
            if (status === 'paid') clientMap[key].isPending = false
          } else {
            clientMap[key] = {
              name:      clientName,
              monthlyMrr,
              billingType: isOneOff ? 'one-off' : billingType,
              isPending: status === 'sent',
              isOneOff,
            }
          }
        }

        clientBreakdown = Object.values(clientMap)
          .filter(c => c.monthlyMrr > 0)
          .map(c => ({
            name:         c.name,
            // For one-off: annualAmount = invoice amount (displayed as-is, NOT ÷12 in UI)
            // For recurring: annualAmount = monthlyMrr * 12 (normalised ARR)
            annualAmount: c.isOneOff ? Math.round(c.monthlyMrr) : Math.round(c.monthlyMrr * 12),
            billingType:  c.billingType,
            isNew:        false,
            isPending:    c.isPending,
            isOneOff:     c.isOneOff,
          }))

        // Mark isNew: client has MRR this month but not in the previous month on the MRR sheet
        const [monthName] = monthParam.split('_')
        const label    = `${monthName.slice(0, 3)} ${year}`
        const monthCol = MONTH_COLS.find(m => m.month === label)
        if (monthCol) {
          const monthIdx = MONTH_COLS.findIndex(m => m.month === label)
          const prevCol  = monthIdx > 0 ? MONTH_COLS[monthIdx - 1].col : null
          if (prevCol) {
            const clientRows = allRows.slice(3, 24) // MRR sheet rows 4–24
            const prevNames  = new Set(
              clientRows
                .filter((row, i) => parseNum(getCell(4 + i, prevCol)) > 0 && row?.[0])
                .map(row => (row[0] || '').toLowerCase().trim())
            )
            clientBreakdown = clientBreakdown.map(c => ({
              ...c,
              isNew: !prevNames.has(c.name.toLowerCase()),
            }))
          }
        }
      } catch (e) {
        console.error('Could not load invoice sheet for MRR breakdown:', e)
      }
    }

    // Full year totals for toggle view
    const yearTotals: Record<number, { mrr: number; costs: number; net: number }> = {}
    for (const pt of history) {
      const yr = parseInt(pt.month.split(' ')[1])
      if (!yearTotals[yr]) yearTotals[yr] = { mrr: 0, costs: 0, net: 0 }
      yearTotals[yr].mrr   += pt.confirmed
      yearTotals[yr].costs += pt.costs
      yearTotals[yr].net   += pt.net
    }

    return NextResponse.json({ history, clientBreakdown, yearTotals, cumulativeCash, closing2025 })
  } catch (err: any) {
    console.error('MRR history error:', err.message)
    return NextResponse.json({ history: [], clientBreakdown: [], yearTotals: {} })
  }
}
