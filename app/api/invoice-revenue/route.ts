import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodId = new URL(req.url).searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ invoices: [] })

  const res = await query(
    `SELECT id, drive_file_id, drive_file_name, vendor, date, amount, currency,
            amount_usd, account_name, status, ai_extracted, notes,
            matched_bank_id, created_at
     FROM invoices
     WHERE period_id = $1
     ORDER BY date DESC`,
    [periodId]
  )

  return NextResponse.json({ invoices: res.rows })
}

// POST /api/invoice-revenue  { periodId, clients: [{ name, amount }] }
// Saves monthly MRR entries for a period (replaces existing entries)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, clients } = await req.json()
  if (!periodId || !Array.isArray(clients) || clients.length === 0) {
    return NextResponse.json({ error: 'periodId and clients required' }, { status: 400 })
  }

  // Replace all mrr_entries for this period
  await query('DELETE FROM mrr_entries WHERE period_id = $1', [periodId])

  for (const c of clients) {
    await query(
      'INSERT INTO mrr_entries (period_id, client_name, amount_usd) VALUES ($1, $2, $3)',
      [periodId, c.name, c.amount]
    )
  }

  const totalMrr = clients.reduce((s: number, c: any) => s + (c.amount || 0), 0)
  return NextResponse.json({ saved: clients.length, totalMrr })
}
