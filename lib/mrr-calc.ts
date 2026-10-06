import { google } from 'googleapis'
import { cachedSheet } from '@/lib/sheets-cache'

const INVOICE_SHEET_ID = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'

export function getSheetClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

export function parseNum(val: any): number {
  if (!val) return 0
  return parseFloat(val.toString().replace(/[$,\s]/g, '')) || 0
}

export function parseInvDate(str: string): Date | null {
  if (!str || typeof str !== 'string') return null
  const s = str.trim()
  if (!s) return null
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

export function calcMonthlyMrr(amount: number, billingType: string): number {
  const t = (billingType || 'annual').toLowerCase().trim()
  if (t === 'monthly')   return amount
  if (t === 'quarterly') return amount / 3
  return amount / 12
}

export function contractEnd(issueDate: Date, billingType: string): Date {
  const end = new Date(issueDate)
  const t = (billingType || 'annual').toLowerCase().trim()
  if (t === 'quarterly')    end.setMonth(end.getMonth() + 3)
  else if (t === 'monthly') end.setMonth(end.getMonth() + 1)
  else                      end.setMonth(end.getMonth() + 12)
  end.setDate(1) // normalize to month boundary so Sep 2025 annual expires Sep 1 2026 (active through Aug 2026)
  return end
}

/** Statuses that count as paid/confirmed for MRR purposes */
export function isPaidStatus(status: string): boolean {
  const s = status.toLowerCase().trim()
  return (
    s.includes('paid') ||                          // "Fully Paid", "Paid", "Fully paid - Renewal", etc.
    s.includes('partial payment / pending payment')
  )
}

export function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase().trim()
  return (
    isPaidStatus(s) ||
    s === 'sent' ||
    s === 'invoiced' ||
    s === 'outstanding' ||
    s === 'due' ||
    (s.includes('sales') && s.includes('sent'))
  )
}

export function calcMrrForMonth(invRows: any[][], monthStart: Date, monthEnd: Date, statusFilter?: (status: string) => boolean): number {
  // Dedup by invoice ID only — a client can have multiple active invoices (different products).
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
    if (statusFilter && !statusFilter(status)) continue

    const isOneOff = billingType === 'one-off' || billingType === 'one off' || billingType === 'oneoff'
    const d = parseInvDate(issueDateStr)

    // Dedup key: invoice ID if present, otherwise client+date+amount
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

/** Fetch all invoice rows from the "All time" tab (shared 90s cache) */
export async function fetchAllTimeRows(): Promise<any[][]> {
  return cachedSheet('invoice-sheet-v3', async () => {
    const sheets = getSheetClient()
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: INVOICE_SHEET_ID,
      range: 'All time!A2:I',
    })
    return res.data.values || []
  })
}

const FORECAST_SHEET_ID = '1Tq2nFNW4ibESyjU2t9YkEvktBaLatUnlcmOzEZMcF3A'

const MONTH_ABBREVS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, march: 2, apr: 3, may: 4,
  jun: 5, june: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function parseSheetMonthHeader(header: string, defaultYear: number): string | null {
  const s = header.trim().toLowerCase()
  // "Jul-26", "Jan-27" etc
  const withYear = s.match(/^([a-z]+)-(\d{2})$/)
  if (withYear) {
    const monthIdx = MONTH_ABBREVS[withYear[1]]
    if (monthIdx === undefined) return null
    return `${2000 + parseInt(withYear[2])}-${String(monthIdx + 1).padStart(2, '0')}`
  }
  // Plain month name with no year ("Jan", "Feb", "March" etc) — use defaultYear
  const monthIdx = MONTH_ABBREVS[s]
  if (monthIdx === undefined) return null
  return `${defaultYear}-${String(monthIdx + 1).padStart(2, '0')}`
}

/** Fetch monthly Total Operating Expenses from the Monthly Forecast_P&L tab.
 *  Returns a map of "YYYY-MM" → cost (positive number). */
export async function fetchForecastCosts(): Promise<Record<string, number>> {
  return cachedSheet('forecast-pnl-v2', async () => {
    const sheets = getSheetClient()
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: FORECAST_SHEET_ID,
      range: '🟡 Monthly Forecast_P&L!A1:AI31',
    })
    const rows: any[][] = res.data.values || []
    // Row 5 (index 4) = month headers; find Total Operating Expenses row by label
    const headerRow  = rows[4] || []
    // Row 25 = "Total Operating Expenses"
    const totalsRow  = rows.find(r => (r[0] || '').toString().trim().toLowerCase().includes('total operating expenses')) || []
    const result: Record<string, number> = {}
    for (let c = 1; c < headerRow.length; c++) {
      const key = parseSheetMonthHeader((headerRow[c] || '').toString(), 2026)
      if (!key) continue // skip quarterly (Q1-28) and annual (FY30) rollup columns
      const raw = parseFloat((totalsRow[c] || '0').toString().replace(/[$,\s]/g, ''))
      if (!isNaN(raw) && raw !== 0) result[key] = Math.abs(raw) // costs stored as negatives
    }
    return result
  })
}

const INVESTMENT_SHEET_ID = '1-cffcfsSWRsJQSEIumyTacs4xEjBtOwqgmJ3c-Vd0nE'

/** Fetch founder investment totals from the "Total Investments" tab */
export async function fetchInvestmentTotals(): Promise<{
  rene: number; mike: number; total: number;
  rounds: { round: string; rene: number; mike: number; total: number }[]
}> {
  return cachedSheet('investment-totals-v2', async () => {
    const sheets = getSheetClient()
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: INVESTMENT_SHEET_ID,
      range: 'Total Investments!A1:D10',
    })
    const rows: any[][] = res.data.values || []
    let rene = 0, mike = 0
    const roundData: Record<string, { rene: number; mike: number }> = {}

    for (const row of rows) {
      const label = (row[0] || '').toString().trim().toLowerCase()
      const r1    = parseNum((row[1] || '').toString())
      const r2    = parseNum((row[2] || '').toString())
      const total = parseNum((row[3] || '').toString())

      if (label === 'rene' || label === 'rene ') {
        rene = total
        if (r1 > 0) roundData['Round 1'] = { ...(roundData['Round 1'] ?? { mike: 0 }), rene: r1 }
        if (r2 > 0) roundData['Round 2'] = { ...(roundData['Round 2'] ?? { mike: 0 }), rene: r2 }
      }
      if (label === 'mike') {
        mike = total
        if (r1 > 0) roundData['Round 1'] = { ...(roundData['Round 1'] ?? { rene: 0 }), mike: r1 }
        if (r2 > 0) roundData['Round 2'] = { ...(roundData['Round 2'] ?? { rene: 0 }), mike: r2 }
      }
    }

    const rounds = Object.entries(roundData).map(([round, d]) => ({
      round,
      rene:  d.rene  ?? 0,
      mike:  d.mike  ?? 0,
      total: (d.rene ?? 0) + (d.mike ?? 0),
    }))

    return { rene, mike, total: rene + mike, rounds }
  })
}

/**
 * Calculate projected MRR for a future month from the invoice sheet.
 *
 * Three components:
 * 1. Active paid/partial contracts still within their contract period → 100%
 * 2. Expired paid/partial contracts where no newer invoice exists for that client → auto-renew 100%
 *    (if a renewal invoice IS in the sheet it's already counted in #1 — no double-count)
 * 3. Sales-sent pipeline with issue date ≤ monthEnd → 10% probability
 *
 * Deduplication is by invoice ID (allows multiple products per client).
 * Auto-renew dedup is by client name → only the latest invoice per client is considered.
 */
export interface ProjectedBreakdown {
  total: number
  activeContracts: number  // Component 1: invoice still within its contract period
  carryOver: number        // Component 2 mid-cycle: expired but auto-renewed (explains jump vs confirmed)
  autoRenewed: number      // Component 2 renewal-month: new cycle starts this month
  pipeline: number
  activeClients: string[]
  carryOverClients: string[]
  autoRenewedClients: string[]
  pipelineClients: string[]
  expiredClients: string[]
  newClients: string[]
}

export function calcProjectedMrrForMonth(invRows: any[][], monthStart: Date, monthEnd: Date, excludeCarryOver?: Set<string>): ProjectedBreakdown {
  const isPaid     = isPaidStatus
  const isPipeline = (s: string) => s.includes('sales') && s.includes('sent')
  const isOneOffBt = (bt: string) => bt === 'one-off' || bt === 'one off' || bt === 'oneoff'

  // Pre-pass: for each client, find the earliest and latest paid/partial invoice issue date.
  // earliest → used to detect truly new clients (no prior invoices)
  // latest   → used to decide whether an expired contract should auto-renew
  const clientLatestDate:   Record<string, Date> = {}
  const clientEarliestDate: Record<string, Date> = {}
  for (const r of invRows) {
    const baseName    = (r[1] || '').trim()  // always use col B as dedup key — col I may differ between original and renewal
    const amount      = parseNum((r[5] || '').toString())
    const status      = (r[6] || '').toLowerCase().trim()
    const billingType = (r[7] || 'annual').toLowerCase().trim()
    const issueDateStr = (r[4] || '').trim()
    if (!baseName || !amount || !isPaid(status) || isOneOffBt(billingType)) continue
    const d = parseInvDate(issueDateStr)
    if (!d) continue
    const key = baseName.toLowerCase()
    if (!clientLatestDate[key]   || d > clientLatestDate[key])   clientLatestDate[key]   = d
    if (!clientEarliestDate[key] || d < clientEarliestDate[key]) clientEarliestDate[key] = d
  }

  let activeContracts = 0
  let carryOver       = 0
  let autoRenewed     = 0
  let pipeline        = 0
  const activeClients:      string[] = []
  const carryOverClients:   string[] = []
  const autoRenewedClients: string[] = []
  const pipelineClients:    string[] = []
  const expiredClients:     string[] = []
  const newClients:         string[] = []
  const seenConfirmed = new Set<string>()
  const seenAutoRenew = new Set<string>()
  const seenPipeline  = new Set<string>()
  const seenGap       = new Set<string>()

  for (const r of invRows) {
    const invoiceId    = (r[0] || '').trim()
    const clientName   = (r[8] || r[1] || '').trim()
    const amount       = parseNum((r[5] || '').toString())
    const status       = (r[6] || '').toLowerCase().trim()
    const billingType  = (r[7] || 'annual').toLowerCase().trim()
    const issueDateStr = (r[4] || '').trim()
    if (!clientName || !amount) continue
    const isOneOff = isOneOffBt(billingType)
    if (isOneOff) continue
    const d = parseInvDate(issueDateStr)
    if (!d) continue
    const key = invoiceId || `${clientName.toLowerCase()}|${issueDateStr}|${amount}`

    if (isPaid(status)) {
      if (d > monthEnd) continue
      const end = contractEnd(d, billingType)

      if (end > monthStart) {
        // ── Component 1: still active this month ──────────────────────────
        if (seenConfirmed.has(key)) continue
        seenConfirmed.add(key)
        activeContracts += calcMonthlyMrr(amount, billingType)
        activeClients.push(clientName)
        // "New this month" = invoice starts this month AND this is the client's first ever paid invoice
        const clientKey2  = (r[1] || '').trim().toLowerCase()
        const firstInv    = clientEarliestDate[clientKey2]
        if (d >= monthStart && firstInv && d.getTime() === firstInv.getTime()) newClients.push(clientName)
      } else {
        // ── Component 2: expired — only if this is the latest invoice for the client
        const clientKey = (r[1] || '').trim().toLowerCase() // use col B for dedup, not display name
        const latest    = clientLatestDate[clientKey]
        if (!latest || d.getTime() !== latest.getTime()) {
          // A newer invoice exists for this client — but if it's dated after this month
          // the client is in a gap (old contract expired, renewal not active yet).
          if (latest && latest > monthEnd && !seenGap.has(clientKey)) {
            seenGap.add(clientKey)
            expiredClients.push(clientName)
          }
          continue
        }
        if (seenAutoRenew.has(key)) continue
        seenAutoRenew.add(key)
        const monthly = calcMonthlyMrr(amount, billingType)

        // Find which renewal cycle monthStart falls in, so we can tell whether
        // the renewal is happening THIS month or the contract is simply running
        // under a prior auto-renewal.
        let cycleStart = contractEnd(d, billingType) // first expiry = first renewal date
        while (true) {
          const cycleEnd = new Date(cycleStart)
          if (billingType === 'quarterly') cycleEnd.setMonth(cycleEnd.getMonth() + 3)
          else if (billingType === 'monthly') cycleEnd.setMonth(cycleEnd.getMonth() + 1)
          else cycleEnd.setMonth(cycleEnd.getMonth() + 12)
          cycleEnd.setDate(1)
          if (cycleEnd > monthStart) break // monthStart falls in [cycleStart, cycleEnd)
          cycleStart = cycleEnd
        }

        const renewingThisMonth = cycleStart.getTime() === monthStart.getTime()
        if (renewingThisMonth) {
          const renewLabel = cycleStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
          autoRenewedClients.push(`${clientName} (renews ${renewLabel})`)
          expiredClients.push(clientName)
          autoRenewed += monthly
        } else {
          // Mid-cycle carry-over: expired but no cancellation — not in confirmed MRR, explains jump
          const baseKey = clientName.toLowerCase()  // must match what's shown in the UI
          if (excludeCarryOver?.has(baseKey)) continue
          carryOver += monthly
          carryOverClients.push(clientName)
        }
      }
    } else if (isPipeline(status)) {
      // ── Component 3: pipeline × 10% (with renewal compounding) ───────
      // Pipeline deals are annual — 10% is the close probability per deal.
      // After the initial contract window, we assume the 10% that closed auto-renews
      // each year, compounding forward indefinitely (same logic as paid carry-over).
      if (d > monthEnd) continue
      if (seenPipeline.has(key)) continue

      // Walk renewal cycles until we find the one containing monthStart
      let cycleStart = d
      let cycleEnd   = contractEnd(d, billingType)
      while (cycleEnd <= monthStart) {
        cycleStart = cycleEnd
        const next  = new Date(cycleEnd)
        if      (billingType === 'quarterly') next.setMonth(next.getMonth() + 3)
        else if (billingType === 'monthly')   next.setMonth(next.getMonth() + 1)
        else                                  next.setMonth(next.getMonth() + 12)
        next.setDate(1)
        cycleEnd = next
      }
      // cycleStart ≤ monthStart < cycleEnd — deal is active in current cycle
      seenPipeline.add(key)
      pipeline += calcMonthlyMrr(amount, billingType) * 0.1
      pipelineClients.push(clientName)
    }
  }

  return {
    total:             Math.round(activeContracts + carryOver + autoRenewed + pipeline),
    activeContracts:   Math.round(activeContracts),
    carryOver:         Math.round(carryOver),
    autoRenewed:       Math.round(autoRenewed),
    pipeline:          Math.round(pipeline),
    activeClients,
    carryOverClients,
    autoRenewedClients,
    pipelineClients,
    expiredClients,
    newClients,
  }
}

/** Calculate MRR for a period directly from the invoice sheet (no DB sync required) */
export async function calcMrrForPeriod(startDate: string, endDate: string): Promise<number> {
  const rows = await fetchAllTimeRows()
  const monthStart = new Date(startDate)
  const monthEnd   = new Date(endDate)
  return calcMrrForMonth(rows, monthStart, monthEnd)
}
