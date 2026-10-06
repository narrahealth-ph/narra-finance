import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  fetchAllTimeRows,
  isPaidStatus,
  parseNum,
  parseInvDate,
  contractEnd,
  calcMonthlyMrr,
  calcMrrForMonth,
  calcProjectedMrrForMonth,
} from '@/lib/mrr-calc'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientParam = (searchParams.get('client') || '').toLowerCase().trim()

  const invRows = await fetchAllTimeRows()

  // Find all rows that match the client name (col B or col I)
  const clientRows = invRows
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => {
      const colB = (r[1] || '').toLowerCase().trim()
      const colI = (r[8] || '').toLowerCase().trim()
      return colB.includes(clientParam) || colI.includes(clientParam)
    })
    .map(({ r, idx }) => ({
      row:         idx + 2, // sheet row number (1-indexed + header)
      invoiceId:   r[0] || '',
      colB_name:   r[1] || '',
      colI_name:   r[8] || '',
      issueDate:   r[4] || '',
      amount:      r[5] || '',
      status:      r[6] || '',
      billingType: r[7] || '',
      parsedDate:  parseInvDate((r[4] || '').trim())?.toISOString().split('T')[0] ?? null,
      parsedAmount: parseNum((r[5] || '').toString()),
      isPaid:       isPaidStatus((r[6] || '').toLowerCase().trim()),
      contractEnd:  (() => {
        const d = parseInvDate((r[4] || '').trim())
        return d ? contractEnd(d, (r[7] || 'annual')).toISOString().split('T')[0] : null
      })(),
      monthlyMrr: (() => {
        const d = parseInvDate((r[4] || '').trim())
        const amt = parseNum((r[5] || '').toString())
        return d && amt ? Math.round(calcMonthlyMrr(amt, (r[7] || 'annual'))) : 0
      })(),
    }))

  // For each month Aug–Dec 2026, show confirmed and projected MRR contribution from this client
  const months: any[] = []
  for (let m = 7; m <= 11; m++) { // Aug–Dec 2026
    const mStart = new Date(2026, m, 1)
    const mEnd   = new Date(2026, m + 1, 0)
    const label  = mStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    const confirmed  = calcMrrForMonth(invRows, mStart, mEnd, isPaidStatus)
    const projected  = calcProjectedMrrForMonth(invRows, mStart, mEnd)

    // How much does this client specifically contribute?
    let clientConfirmed = 0
    for (const row of clientRows) {
      if (!row.isPaid || !row.parsedDate) continue
      const d   = new Date(row.parsedDate)
      const end = new Date(row.contractEnd!)
      const bt  = (row.billingType || 'annual').toLowerCase().trim()
      const isOneOff = bt === 'one-off' || bt === 'one off' || bt === 'oneoff'
      if (isOneOff) continue
      if (d > mEnd) continue
      if (end <= mStart) continue
      clientConfirmed += row.monthlyMrr
    }

    months.push({
      month:             label,
      totalConfirmedMrr: confirmed,
      clientConfirmed:   Math.round(clientConfirmed),
      clientInActiveList:  projected.activeClients.filter(c => c.toLowerCase().includes(clientParam)),
      clientInCarryOver:   projected.carryOverClients.filter(c => c.toLowerCase().includes(clientParam)),
      clientInAutoRenewed: projected.autoRenewedClients.filter(c => c.toLowerCase().includes(clientParam)),
      clientInExpired:     projected.expiredClients.filter(c => c.toLowerCase().includes(clientParam)),
    })
  }

  return NextResponse.json({ clientRows, months })
}
