import { google } from 'googleapis'

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
  return end
}

export function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase().trim()
  return (
    s.includes('paid') ||
    s === 'sent' ||
    s === 'invoiced' ||
    s === 'outstanding' ||
    s === 'due'
  )
}

export function isPendingStatus(status: string): boolean {
  const s = status.toLowerCase().trim()
  return s === 'sent' || s === 'invoiced' || s === 'outstanding' || s === 'due'
}

export function calcMrrForMonth(invRows: any[][], monthStart: Date, monthEnd: Date): number {
  // First pass: collect all active entries for this month
  type Entry = { key: string; amount: number; billingType: string; issueDate: Date; isPending: boolean; isOneOff: boolean }
  const active: Entry[] = []

  for (const r of invRows) {
    const clientName   = (r[1] || '').trim()
    const amount       = parseNum((r[5] || '').toString())
    const status       = (r[6] || '').toLowerCase().trim()
    const billingType  = (r[7] || 'annual').toLowerCase().trim()
    const issueDateStr = (r[4] || '').trim()
    if (!clientName || !amount) continue
    if (!isActiveStatus(status)) continue

    const isOneOff = billingType === 'one-off' || billingType === 'one off' || billingType === 'oneoff'
    const d = parseInvDate(issueDateStr)

    if (isOneOff) {
      if (!d || d < monthStart || d > monthEnd) continue
      active.push({ key: clientName.toLowerCase(), amount, billingType, issueDate: d, isPending: isPendingStatus(status), isOneOff: true })
    } else {
      if (!d || d > monthEnd) continue
      if (contractEnd(d, billingType) <= monthStart) continue
      active.push({ key: clientName.toLowerCase(), amount, billingType, issueDate: d, isPending: isPendingStatus(status), isOneOff: false })
    }
  }

  // Second pass: sort newest-first, prefer paid contracts in dedup
  active.sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())

  const seenPaid = new Set<string>()
  const seenAll  = new Set<string>()
  let total = 0

  for (const e of active) {
    if (e.isOneOff) {
      total += e.amount
      continue
    }
    if (!e.isPending) {
      if (!seenPaid.has(e.key)) {
        seenPaid.add(e.key)
        seenAll.add(e.key)
        total += calcMonthlyMrr(e.amount, e.billingType)
      }
    } else {
      if (!seenAll.has(e.key) && !seenPaid.has(e.key)) {
        seenAll.add(e.key)
        total += calcMonthlyMrr(e.amount, e.billingType)
      }
    }
  }

  return Math.round(total)
}

/** Fetch all invoice rows from the "All time" tab */
export async function fetchAllTimeRows(): Promise<any[][]> {
  const sheets = getSheetClient()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: INVOICE_SHEET_ID,
    range: 'All time!A2:I500',
  })
  return res.data.values || []
}

/** Calculate MRR for a period directly from the invoice sheet (no DB sync required) */
export async function calcMrrForPeriod(startDate: string, endDate: string): Promise<number> {
  const rows = await fetchAllTimeRows()
  const monthStart = new Date(startDate)
  const monthEnd   = new Date(endDate)
  return calcMrrForMonth(rows, monthStart, monthEnd)
}
