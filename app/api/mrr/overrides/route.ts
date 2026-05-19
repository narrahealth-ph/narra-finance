import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS mrr_invoice_overrides (
      invoice_id   TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

// GET /api/mrr/overrides — returns all overrides as { invoiceId: displayName }
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const res = await query('SELECT invoice_id, display_name FROM mrr_invoice_overrides')
  const map: Record<string, string> = {}
  for (const row of res.rows) map[row.invoice_id] = row.display_name
  return NextResponse.json({ overrides: map })
}

// POST /api/mrr/overrides  { invoiceId, displayName }
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const { invoiceId, displayName } = await req.json()
  if (!invoiceId || !displayName?.trim()) return NextResponse.json({ error: 'invoiceId and displayName required' }, { status: 400 })
  await query(
    `INSERT INTO mrr_invoice_overrides (invoice_id, display_name, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (invoice_id) DO UPDATE SET display_name = $2, updated_at = NOW()`,
    [invoiceId, displayName.trim()]
  )
  return NextResponse.json({ ok: true })
}

// DELETE /api/mrr/overrides?invoiceId=xxx — revert to original name
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const invoiceId = new URL(req.url).searchParams.get('invoiceId')
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })
  await query('DELETE FROM mrr_invoice_overrides WHERE invoice_id = $1', [invoiceId])
  return NextResponse.json({ ok: true })
}
