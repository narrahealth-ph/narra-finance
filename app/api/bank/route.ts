import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'

// POST /api/bank — save transactions and auto-reconcile
export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, transactions } = await req.json()

  const saved = []
  for (const tx of transactions) {
    const res = await query(
      `INSERT INTO bank_transactions
        (period_id, date, description, amount, currency, amount_usd, type, account, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unmatched')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [periodId, tx.date, tx.description, tx.amount,
       tx.currency || 'USD', tx.amount_usd || tx.amount, tx.type, tx.account || tx.sourceAccount || '']
    )
    if (res.rows[0]) saved.push(res.rows[0].id)
  }

  await autoReconcile(periodId)
  return NextResponse.json({ saved: saved.length })
}

// GET /api/bank?periodId=1
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const periodId = searchParams.get('periodId')
  const action   = searchParams.get('action')

  // GET /api/bank?action=summary&periodId=1
  // Returns costs grouped by account code with individual transactions
  if (action === 'summary') {
    const txs = await query(
      `SELECT bt.*, i.vendor, i.account_name, i.drive_file_name
       FROM bank_transactions bt
       LEFT JOIN invoices i ON i.matched_bank_id = bt.id::text::integer
       WHERE bt.period_id = $1
       ORDER BY bt.date`,
      [periodId]
    )

    const expenses = txs.rows.filter(r => r.type === 'expense')
    const revenue  = txs.rows.filter(r => r.type === 'revenue')

    // Group expenses by account code
    const byAccount: Record<string, { total: number; items: any[] }> = {}
    for (const tx of expenses) {
      const acct = tx.account_name || tx.account || 'Uncategorized'
      if (!byAccount[acct]) byAccount[acct] = { total: 0, items: [] }
      byAccount[acct].total += parseFloat(tx.amount_usd || tx.amount || 0)
      byAccount[acct].items.push({
        id:          tx.id,
        date:        tx.date,
        description: tx.description,
        vendor:      tx.vendor || tx.description,
        amount:      parseFloat(tx.amount_usd || tx.amount || 0),
        currency:    tx.currency,
        status:      tx.status,
        matchedInvoice: tx.drive_file_name || null,
      })
    }

    const totalExpenses = expenses.reduce((s, r) => s + parseFloat(r.amount_usd || r.amount || 0), 0)
    const totalRevenue  = revenue.reduce((s, r) => s + parseFloat(r.amount_usd || r.amount || 0), 0)

    return NextResponse.json({
      byAccount,
      totalExpenses,
      totalRevenue,
      netRevenue: totalRevenue - totalExpenses,
      transactionCount: txs.rows.length,
    })
  }

  const res = await query(
    'SELECT * FROM bank_transactions WHERE period_id = $1 ORDER BY date',
    [periodId]
  )
  return NextResponse.json({ transactions: res.rows })
}

// PATCH /api/bank — unmatch a transaction
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, bankTxId, invoiceId } = await req.json()

  if (action === 'unmatch') {
    // Reset both records to unmatched
    await query(
      "UPDATE bank_transactions SET status='unmatched', matched_invoice_id=NULL WHERE id=$1",
      [bankTxId]
    )
    if (invoiceId) {
      await query(
        "UPDATE invoices SET status='unmatched', matched_bank_id=NULL WHERE id=$1",
        [invoiceId]
      )
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'approve_match') {
    await query(
      "UPDATE bank_transactions SET status='matched' WHERE id=$1",
      [bankTxId]
    )
    if (invoiceId) {
      await query(
        "UPDATE invoices SET status='matched' WHERE id=$1",
        [invoiceId]
      )
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ── Auto-reconcile with confidence scoring ───────────────────────────────────
async function autoReconcile(periodId: number) {
  const invoices = await query(
    "SELECT id, amount_usd, date, vendor FROM invoices WHERE period_id = $1 AND status='unmatched'",
    [periodId]
  )
  const bankTxs = await query(
    "SELECT id, amount, date, description FROM bank_transactions WHERE period_id = $1 AND status='unmatched' AND type='expense'",
    [periodId]
  )

  for (const inv of invoices.rows) {
    const invAmount = parseFloat(inv.amount_usd || 0)
    if (!invAmount) continue

    let bestMatch: any = null
    let bestScore = 0

    for (const tx of bankTxs.rows) {
      const txAmount = parseFloat(tx.amount || 0)
      const amountDiff = Math.abs(txAmount - invAmount) / invAmount
      const daysDiff = inv.date && tx.date
        ? Math.abs(new Date(tx.date).getTime() - new Date(inv.date).getTime()) / 86400000
        : 999

      // Score: amount match (0-50) + date proximity (0-30) + vendor name match (0-20)
      let score = 0
      if (amountDiff < 0.01)      score += 50  // exact match
      else if (amountDiff < 0.05) score += 35  // within 5%
      else if (amountDiff < 0.10) score += 15  // within 10%
      else continue                             // too far off — skip

      if (daysDiff <= 1)       score += 30
      else if (daysDiff <= 3)  score += 20
      else if (daysDiff <= 7)  score += 10
      else if (daysDiff <= 14) score += 5

      // Vendor name match
      if (inv.vendor && tx.description) {
        const vendor = inv.vendor.toLowerCase()
        const desc   = tx.description.toLowerCase()
        if (desc.includes(vendor) || vendor.includes(desc.split(' ')[0])) score += 20
        else if (vendor.split(' ').some((w: string) => w.length > 3 && desc.includes(w))) score += 10
      }

      if (score > bestScore) {
        bestScore = score
        bestMatch = tx
      }
    }

    if (!bestMatch) continue

    // High confidence (score >= 65) → auto-confirm
    // Medium confidence (score 40-64) → mark as proposed for review
    const confidence = bestScore >= 65 ? 'high' : bestScore >= 40 ? 'medium' : 'low'
    if (confidence === 'low') continue

    const status = confidence === 'high' ? 'matched' : 'proposed'

    await query(
      "UPDATE invoices SET status=$1, matched_bank_id=$2 WHERE id=$3",
      [status, bestMatch.id, inv.id]
    )
    await query(
      "UPDATE bank_transactions SET status=$1, matched_invoice_id=$2 WHERE id=$3",
      [status, inv.id, bestMatch.id]
    )

    // Remove from pool
    bankTxs.rows = bankTxs.rows.filter((tx: any) => tx.id !== bestMatch.id)
  }
}
