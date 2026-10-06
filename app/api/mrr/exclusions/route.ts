import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS mrr_carryover_exclusions (
      client_key  TEXT PRIMARY KEY,
      excluded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

// GET — returns all excluded client keys as string[]
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const res = await query('SELECT client_key FROM mrr_carryover_exclusions ORDER BY excluded_at')
  return NextResponse.json({ exclusions: res.rows.map((r: any) => r.client_key) })
}

// POST { clientKey } — add exclusion
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const { clientKey } = await req.json()
  if (!clientKey?.trim()) return NextResponse.json({ error: 'clientKey required' }, { status: 400 })
  await query(
    `INSERT INTO mrr_carryover_exclusions (client_key, excluded_at)
     VALUES ($1, NOW())
     ON CONFLICT (client_key) DO NOTHING`,
    [clientKey.toLowerCase().trim()]
  )
  return NextResponse.json({ ok: true })
}

// DELETE ?clientKey=xxx — restore
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const clientKey = new URL(req.url).searchParams.get('clientKey')
  if (!clientKey) return NextResponse.json({ error: 'clientKey required' }, { status: 400 })
  await query('DELETE FROM mrr_carryover_exclusions WHERE client_key = $1', [clientKey.toLowerCase().trim()])
  return NextResponse.json({ ok: true })
}
