import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { generateInvestorNarrative, detectAnomalies, assessChurnRisk } from '@/lib/ai'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, type } = await req.json()

  const period = await query('SELECT * FROM periods WHERE id = $1', [periodId])
  const p = period.rows[0]
  if (!p) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const invoices = await query('SELECT * FROM invoices WHERE period_id = $1', [periodId])
  const bankTxs = await query('SELECT * FROM bank_transactions WHERE period_id = $1', [periodId])
  const mrr = await query('SELECT * FROM mrr_entries WHERE period_id = $1', [periodId])

  const totalExpenses = invoices.rows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const totalRevenue = bankTxs.rows.filter((r: any) => r.type === 'revenue').reduce((s: number, r: any) => s + parseFloat(r.amount || 0), 0)
  const totalMrr = mrr.rows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0)
  const cashOpening = bankTxs.rows.filter((r: any) => r.type === 'opening').reduce((s: number, r: any) => s + parseFloat(r.amount || 0), 0)
  const cashBalance = cashOpening + totalRevenue - totalExpenses
  const runway = totalExpenses > 0 ? Math.floor(cashBalance / (totalExpenses)) : 999

  let result: any = {}

  if (type === 'narrative' || type === 'all') {
    const narrative = await generateInvestorNarrative({
      period: p.label,
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      mrr: totalMrr,
      mrrGrowth: 0, // enhance with prev period comparison
      clientCount: mrr.rows.length,
      cashBalance,
      runway,
      topClients: mrr.rows.slice(0, 3).map((r: any) => ({ name: r.client_name, amount: r.amount_usd })),
      anomalies: [],
    })
    result.narrative = narrative

    await query(
      `INSERT INTO ai_insights (period_id, type, content) VALUES ($1, 'narrative', $2)
       ON CONFLICT DO NOTHING`,
      [periodId, narrative]
    )
  }

  if (type === 'anomalies' || type === 'all') {
    const expenseByAccount: Record<string, number> = {}
    for (const inv of invoices.rows) {
      const acct = inv.account_name || 'Other'
      expenseByAccount[acct] = (expenseByAccount[acct] || 0) + parseFloat(inv.amount_usd || 0)
    }
    const anomalies = await detectAnomalies(invoices.rows, expenseByAccount)
    result.anomalies = anomalies
  }

  if (type === 'churn' || type === 'all') {
    const clients = mrr.rows.map((r: any) => ({
      name: r.client_name,
      payments: [r.amount_usd],
      lastPayment: r.created_at,
      seats: r.seats || 0,
    }))
    const churn = await assessChurnRisk(clients)
    result.churn = churn
  }

  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodId = new URL(req.url).searchParams.get('periodId')
  const res = await query(
    'SELECT * FROM ai_insights WHERE period_id = $1 ORDER BY generated_at DESC',
    [periodId]
  )
  return NextResponse.json({ insights: res.rows })
}
