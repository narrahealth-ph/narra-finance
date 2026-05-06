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
