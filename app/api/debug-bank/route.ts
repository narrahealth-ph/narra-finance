import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [byMonth, sample, periods] = await Promise.all([
    query(`
      SELECT
        DATE_TRUNC('month', date) AS month,
        type,
        COUNT(*) AS cnt,
        COALESCE(SUM(
          CASE WHEN amount_usd IS NOT NULL AND amount_usd > 0 THEN amount_usd
               WHEN currency = 'USD' OR currency IS NULL THEN amount
               ELSE 0 END
        ), 0) AS total_usd,
        MIN(date) AS earliest,
        MAX(date) AS latest
      FROM bank_transactions
      WHERE date >= '2026-01-01'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `),
    query(`
      SELECT id, date, type, amount, amount_usd, currency, period_id, description
      FROM bank_transactions
      WHERE date >= '2026-04-01'
      ORDER BY date DESC
      LIMIT 20
    `),
    query(`SELECT id, label, start_date FROM periods ORDER BY start_date DESC LIMIT 12`),
  ])

  return NextResponse.json({
    byMonth: byMonth.rows,
    recentTransactions: sample.rows,
    periods: periods.rows,
  })
}
