import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { writeAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { label, startDate, endDate } = await req.json()

  // Upsert — return existing if already there
  const existing = await query('SELECT id, locked FROM periods WHERE label = $1', [label])
  if (existing.rows[0]) return NextResponse.json({ id: existing.rows[0].id, locked: existing.rows[0].locked })

  const res = await query(
    'INSERT INTO periods (label, start_date, end_date) VALUES ($1,$2,$3) RETURNING id, locked',
    [label, startDate, endDate]
  )
  return NextResponse.json({ id: res.rows[0].id, locked: false })
}

export async function GET() {
  const res = await query('SELECT * FROM periods ORDER BY start_date DESC')
  return NextResponse.json({ periods: res.rows })
}

// PATCH /api/periods  { periodId, action: 'lock' | 'unlock' }
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, action } = await req.json()
  if (!periodId || !action) {
    return NextResponse.json({ error: 'periodId and action required' }, { status: 400 })
  }

  const period = await query('SELECT * FROM periods WHERE id = $1', [periodId])
  if (!period.rows[0]) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const userEmail = (session as any).email || 'unknown'

  if (action === 'lock') {
    if (period.rows[0].locked) {
      return NextResponse.json({ error: 'Period is already locked' }, { status: 400 })
    }
    await query(
      `UPDATE periods SET locked = TRUE, locked_at = NOW(), locked_by = $1, status = 'closed'
       WHERE id = $2`,
      [userEmail, periodId]
    )
    await writeAudit('periods', periodId, 'lock', { locked: false }, { locked: true, locked_by: userEmail }, userEmail)
    return NextResponse.json({ ok: true, locked: true })
  }

  if (action === 'unlock') {
    if (!period.rows[0].locked) {
      return NextResponse.json({ error: 'Period is not locked' }, { status: 400 })
    }
    await query(
      `UPDATE periods SET locked = FALSE, locked_at = NULL, locked_by = NULL, status = 'open'
       WHERE id = $1`,
      [periodId]
    )
    await writeAudit('periods', periodId, 'unlock', { locked: true }, { locked: false }, userEmail)
    return NextResponse.json({ ok: true, locked: false })
  }

  return NextResponse.json({ error: 'Unknown action — use lock or unlock' }, { status: 400 })
}

// DELETE /api/periods?periodId=X — wipe all transactional data for a period (keeps the period row)
export async function DELETE(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const periodId = searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

  const period = await query('SELECT locked, label FROM periods WHERE id = $1', [periodId])
  if (!period.rows[0]) return NextResponse.json({ error: 'Period not found' }, { status: 404 })
  if (period.rows[0].locked) {
    return NextResponse.json({ error: 'Period is locked — unlock before clearing' }, { status: 403 })
  }

  await query('DELETE FROM bank_transactions      WHERE period_id = $1', [periodId])
  await query('DELETE FROM invoices               WHERE period_id = $1', [periodId])
  await query('DELETE FROM mrr_entries            WHERE period_id = $1', [periodId])
  await query('DELETE FROM reconciliation_sessions WHERE period_id = $1', [periodId])
  await query('DELETE FROM manual_entries         WHERE period_id = $1', [periodId])
  await query('DELETE FROM ai_insights            WHERE period_id = $1', [periodId])

  const userEmail = (session as any).email || 'unknown'
  await writeAudit('periods', periodId, 'clear',
    { label: period.rows[0].label },
    { action: 'All period data cleared by user' },
    userEmail
  )

  return NextResponse.json({ ok: true })
}
