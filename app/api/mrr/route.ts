import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, clients } = await req.json()

  // Delete existing for this period and re-insert
  await query('DELETE FROM mrr_entries WHERE period_id = $1', [periodId])

  for (const c of clients) {
    await query(
      'INSERT INTO mrr_entries (period_id, client_name, amount_usd) VALUES ($1,$2,$3)',
      [periodId, c.name, c.amount]
    )
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodId = new URL(req.url).searchParams.get('periodId')
  const res = await query('SELECT * FROM mrr_entries WHERE period_id = $1 ORDER BY amount_usd DESC', [periodId])
  return NextResponse.json({ clients: res.rows })
}
