import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { label, startDate, endDate } = await req.json()

  // Upsert — return existing if already there
  const existing = await query('SELECT id FROM periods WHERE label = $1', [label])
  if (existing.rows[0]) return NextResponse.json({ id: existing.rows[0].id })

  const res = await query(
    'INSERT INTO periods (label, start_date, end_date) VALUES ($1,$2,$3) RETURNING id',
    [label, startDate, endDate]
  )
  return NextResponse.json({ id: res.rows[0].id })
}

export async function GET() {
  const res = await query('SELECT * FROM periods ORDER BY start_date DESC')
  return NextResponse.json({ periods: res.rows })
}
