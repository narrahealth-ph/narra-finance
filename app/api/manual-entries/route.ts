import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { writeAudit } from '@/lib/audit'

// Chart of accounts for manual BS entries — defines all editable fields
// NOTE: 610 (Prepayments) is intentionally excluded — it is auto-calculated from prepayment_schedules
const MANUAL_ACCOUNTS = [
  { code: 'fixed_assets',name: 'Fixed Assets',                  section: 'noncurrent_assets' },
  { code: '670',         name: '670 - Intangible Assets',        section: 'noncurrent_assets' },
  { code: '835',         name: '835 - Director Current Account', section: 'current_liabilities' },
  { code: '840',         name: '840 - Director Current Account', section: 'current_liabilities' },
  { code: '842',         name: '842 - Director Current Account', section: 'current_liabilities' },
  { code: '860',         name: '860 - Income Tax Payable',       section: 'current_liabilities' },
  { code: 'gst',         name: 'GST Payable',                    section: 'current_liabilities' },
  { code: '851',         name: '851 - Loans (Non-current)',       section: 'noncurrent_liabilities' },
  { code: '852',         name: '852 - Founder Investment',       section: 'noncurrent_liabilities' },
  { code: '853',         name: '853 - Founder Investment',       section: 'noncurrent_liabilities' },
  { code: '900',         name: '900 - Share Capital',            section: 'equity',  default: 2.10 },
]

// GET /api/manual-entries?periodId=1
// GET /api/manual-entries?action=schedules
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'schedules') {
    const res = await query('SELECT * FROM prepayment_schedules ORDER BY start_date')
    return NextResponse.json({ schedules: res.rows })
  }

  const periodId = searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

  const res = await query(
    'SELECT account_code, account_name, value, notes FROM manual_entries WHERE period_id = $1',
    [periodId]
  )

  // Merge with MANUAL_ACCOUNTS to include all fields (even those with no DB row yet)
  const saved: Record<string, any> = {}
  for (const row of res.rows) saved[row.account_code] = row

  const entries = MANUAL_ACCOUNTS.map(acct => ({
    account_code: acct.code,
    account_name: acct.name,
    section:      acct.section,
    value:        saved[acct.code]?.value ?? acct.default ?? 0,
    notes:        saved[acct.code]?.notes ?? '',
  }))

  return NextResponse.json({ entries })
}

// PATCH /api/manual-entries  { periodId, accountCode, value, notes }
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, accountCode, value, notes } = await req.json()

  if (!periodId || !accountCode) {
    return NextResponse.json({ error: 'periodId and accountCode required' }, { status: 400 })
  }

  // Check period lock
  const period = await query('SELECT locked FROM periods WHERE id = $1', [periodId])
  if (period.rows[0]?.locked) {
    return NextResponse.json({ error: 'Period is locked — unlock before editing' }, { status: 403 })
  }

  const acct = MANUAL_ACCOUNTS.find(a => a.code === accountCode)
  if (!acct) {
    return NextResponse.json({ error: `Unknown account code: ${accountCode}` }, { status: 400 })
  }

  // Get old value for audit
  const oldRes = await query(
    'SELECT value FROM manual_entries WHERE period_id = $1 AND account_code = $2',
    [periodId, accountCode]
  )
  const oldValue = oldRes.rows[0]?.value ?? null

  await query(
    `INSERT INTO manual_entries (period_id, account_code, account_name, value, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (period_id, account_code)
     DO UPDATE SET value = $4, notes = $5, updated_at = NOW()`,
    [periodId, accountCode, acct.name, value ?? 0, notes ?? '']
  )

  await writeAudit('manual_entries', `${periodId}:${accountCode}`, 'update',
    { value: oldValue }, { value }, (session as any).email)

  return NextResponse.json({ ok: true })
}

// POST /api/manual-entries
// actions: add_schedule | delete_schedule | convert_to_equity
export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  // ── add_schedule ────────────────────────────────────────────────────────────
  if (action === 'add_schedule') {
    const { serviceName, totalAmount, startDate, months, currency, notes } = body
    if (!serviceName || !totalAmount || !startDate || !months) {
      return NextResponse.json({ error: 'serviceName, totalAmount, startDate, months required' }, { status: 400 })
    }
    const res = await query(
      `INSERT INTO prepayment_schedules (service_name, total_amount, start_date, months, currency, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [serviceName, totalAmount, startDate, months, currency || 'USD', notes || '']
    )
    await writeAudit('prepayment_schedules', res.rows[0].id, 'insert', null, res.rows[0], (session as any).email)
    return NextResponse.json({ ok: true, schedule: res.rows[0] })
  }

  // ── delete_schedule ─────────────────────────────────────────────────────────
  if (action === 'delete_schedule') {
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const old = await query('SELECT * FROM prepayment_schedules WHERE id = $1', [id])
    await query('DELETE FROM prepayment_schedules WHERE id = $1', [id])
    await writeAudit('prepayment_schedules', id, 'delete', old.rows[0], null, (session as any).email)
    return NextResponse.json({ ok: true })
  }

  // ── convert_to_equity ───────────────────────────────────────────────────────
  // Moves the sum of director accounts (835, 840, 842) into share capital (900)
  if (action === 'convert_to_equity') {
    const { periodId } = body
    if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

    const period = await query('SELECT locked FROM periods WHERE id = $1', [periodId])
    if (period.rows[0]?.locked) {
      return NextResponse.json({ error: 'Period is locked — unlock before converting' }, { status: 403 })
    }

    const dirRes = await query(
      `SELECT account_code, value FROM manual_entries
       WHERE period_id = $1 AND account_code IN ('835','840','842')`,
      [periodId]
    )
    const dirMap: Record<string, number> = {}
    for (const r of dirRes.rows) dirMap[r.account_code] = parseFloat(r.value || 0)
    const directorTotal = (dirMap['835'] || 0) + (dirMap['840'] || 0) + (dirMap['842'] || 0)

    if (directorTotal <= 0) {
      return NextResponse.json({ error: 'No director amounts to convert' }, { status: 400 })
    }

    const scRes = await query(
      `SELECT value FROM manual_entries WHERE period_id = $1 AND account_code = '900'`,
      [periodId]
    )
    const currentSC = parseFloat(scRes.rows[0]?.value || '2.10')
    const newSC = currentSC + directorTotal

    // Update share capital
    await query(
      `INSERT INTO manual_entries (period_id, account_code, account_name, value, notes, updated_at)
       VALUES ($1, '900', '900 - Share Capital', $2, $3, NOW())
       ON CONFLICT (period_id, account_code)
       DO UPDATE SET value = $2, notes = $3, updated_at = NOW()`,
      [periodId, newSC, `Converted from director accounts: 835=${dirMap['835']||0}, 840=${dirMap['840']||0}, 842=${dirMap['842']||0}`]
    )
    await writeAudit('manual_entries', `${periodId}:900`, 'update',
      { value: currentSC }, { value: newSC }, (session as any).email)

    // Zero out director accounts
    for (const code of ['835', '840', '842']) {
      const acct = MANUAL_ACCOUNTS.find(a => a.code === code)!
      await query(
        `INSERT INTO manual_entries (period_id, account_code, account_name, value, notes, updated_at)
         VALUES ($1, $2, $3, 0, 'Converted to equity', NOW())
         ON CONFLICT (period_id, account_code)
         DO UPDATE SET value = 0, notes = 'Converted to equity', updated_at = NOW()`,
        [periodId, code, acct.name]
      )
      await writeAudit('manual_entries', `${periodId}:${code}`, 'update',
        { value: dirMap[code] || 0 }, { value: 0, notes: 'Converted to equity' }, (session as any).email)
    }

    return NextResponse.json({ ok: true, converted: directorTotal, newShareCapital: newSC })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
