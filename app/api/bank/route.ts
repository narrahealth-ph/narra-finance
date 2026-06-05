import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { toUSD } from '@/lib/fx'
import { writeAudit } from '@/lib/audit'

const DISCREPANCY_FLAG_THRESHOLD = 0.05 // Flag matches with >5% amount difference

// POST /api/bank — save transactions and auto-reconcile
export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, transactions } = await req.json()

  // Check period lock
  const period = await query('SELECT locked FROM periods WHERE id = $1', [periodId])
  if (period.rows[0]?.locked) {
    return NextResponse.json({ error: 'Period is locked — unlock before importing bank statements' }, { status: 403 })
  }

  const userEmail = (session as any).email || 'unknown'
  const saved = []

  for (const tx of transactions) {
    const currency  = tx.currency || 'USD'
    const txDate    = tx.date || new Date().toISOString().split('T')[0]
    const amountUsd = currency !== 'USD'
      ? await toUSD(tx.amount, currency, txDate)
      : (tx.amount_usd || tx.amount)

    const res = await query(
      `INSERT INTO bank_transactions
        (period_id, date, description, amount, currency, amount_usd, type, account, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unmatched')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [periodId, txDate, tx.description, tx.amount,
       currency, amountUsd, tx.type, tx.account || tx.sourceAccount || '']
    )
    if (res.rows[0]) {
      saved.push(res.rows[0].id)
      await writeAudit('bank_transactions', res.rows[0].id, 'insert', null,
        { periodId, amount: tx.amount, currency, type: tx.type }, userEmail)
    }
  }

  await autoReconcile(periodId)
  return NextResponse.json({ saved: saved.length })
}

// GET /api/bank?periodId=1&action=summary
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const periodId = searchParams.get('periodId')
  const action   = searchParams.get('action')

  if (action === 'coverage') {
    // Returns all periods that have bank transactions, with counts
    const res = await query(
      `SELECT p.label, p.start_date,
              COUNT(bt.id)::int                                       AS tx_count,
              COALESCE(SUM(CASE WHEN bt.type='revenue'  THEN bt.amount_usd ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN bt.type='expense'  THEN bt.amount_usd ELSE 0 END), 0) AS expenses
       FROM periods p
       LEFT JOIN bank_transactions bt ON bt.period_id = p.id
       GROUP BY p.id, p.label, p.start_date
       HAVING COUNT(bt.id) > 0
       ORDER BY p.start_date`,
      []
    )
    const coverage: Record<string, { txCount: number; revenue: number; expenses: number }> = {}
    for (const row of res.rows) {
      coverage[row.label] = {
        txCount:  row.tx_count,
        revenue:  parseFloat(row.revenue),
        expenses: parseFloat(row.expenses),
      }
    }
    return NextResponse.json({ coverage })
  }

  if (action === 'year_revenue') {
    const year = searchParams.get('year')
    if (!year) return NextResponse.json({ error: 'year required' }, { status: 400 })
    const res = await query(
      `SELECT bt.id, bt.date, bt.description, bt.amount, bt.currency, bt.amount_usd,
              bt.account, bt.status, p.label AS period_label
       FROM bank_transactions bt
       JOIN periods p ON p.id = bt.period_id
       WHERE EXTRACT(YEAR FROM bt.date) = $1 AND bt.type = 'revenue'
       ORDER BY bt.date`,
      [parseInt(year)]
    )
    const total = res.rows.reduce((s: number, r: any) => {
      const usd = parseFloat(r.amount_usd)
      return s + (isNaN(usd) ? 0 : usd)
    }, 0)
    return NextResponse.json({ transactions: res.rows, total })
  }

  if (action === 'year_all') {
    const year = searchParams.get('year')
    if (!year) return NextResponse.json({ error: 'year required' }, { status: 400 })
    const res = await query(
      `SELECT bt.id, bt.date, bt.description, bt.amount, bt.currency, bt.amount_usd,
              bt.account, bt.status, bt.type, bt.client_id, bt.invoice_ref,
              p.label AS period_label
       FROM bank_transactions bt
       JOIN periods p ON p.id = bt.period_id
       WHERE EXTRACT(YEAR FROM p.start_date) = $1
         AND bt.type IN ('revenue', 'expense')
       ORDER BY bt.date`,
      [parseInt(year)]
    )
    return NextResponse.json({ transactions: res.rows })
  }

  if (action === 'summary') {
    const txs = await query(
      `SELECT bt.*, i.id as invoice_id, i.vendor, i.account_name, i.drive_file_name, i.amount_usd as invoice_amount_usd
       FROM bank_transactions bt
       LEFT JOIN invoices i ON bt.matched_invoice_id = i.id
       WHERE bt.period_id = $1
       ORDER BY bt.date`,
      [periodId]
    )

    const expenses = txs.rows.filter((r: any) => r.type === 'expense')
    const revenue  = txs.rows.filter((r: any) => r.type === 'revenue')

    const safeUsd = (r: any) => {
      const usd = parseFloat(r.amount_usd)
      if (!isNaN(usd) && usd > 0) return usd
      if ((r.currency || 'USD') === 'USD') return parseFloat(r.amount || 0)
      return 0
    }

    const byAccount: Record<string, { total: number; items: any[] }> = {}
    for (const tx of expenses) {
      const acct = tx.account || tx.account_name || 'Uncategorized'
      if (!byAccount[acct]) byAccount[acct] = { total: 0, items: [] }
      const amt = safeUsd(tx)
      byAccount[acct].total += amt
      byAccount[acct].items.push({
        id:              tx.id,
        date:            tx.date,
        description:     tx.description,
        vendor:          tx.vendor || tx.description,
        amount:          amt,
        currency:        tx.currency,
        status:          tx.status,
        discrepancyPct:  tx.discrepancy_pct ? parseFloat(tx.discrepancy_pct) : null,
        invoiceId:        tx.invoice_id || null,
        matchedInvoice:  tx.drive_file_name || null,
        invoiceAmountUsd: tx.invoice_amount_usd ? parseFloat(tx.invoice_amount_usd) : null,
      })
    }

    const totalExpenses = expenses.reduce((s: number, r: any) => s + safeUsd(r), 0)
    const totalRevenue  = revenue.reduce((s: number, r: any) => s + safeUsd(r), 0)

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

// DELETE /api/bank?txId=X — delete a single bank transaction
export async function DELETE(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const txId = searchParams.get('txId')
  if (!txId) return NextResponse.json({ error: 'txId required' }, { status: 400 })

  // Block if period is locked
  const txCheck = await query(
    `SELECT bt.id, p.locked FROM bank_transactions bt
     JOIN periods p ON p.id = bt.period_id WHERE bt.id = $1`,
    [txId]
  )
  if (!txCheck.rows[0]) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  if (txCheck.rows[0].locked) return NextResponse.json({ error: 'Period is locked' }, { status: 403 })

  // Unlink any matched invoice first
  await query(
    "UPDATE invoices SET status='unmatched', matched_bank_id=NULL WHERE matched_bank_id=$1",
    [txId]
  )
  await query('DELETE FROM bank_transactions WHERE id=$1', [txId])
  await writeAudit('bank_transactions', txId, 'delete', null, null, (session as any).email)

  return NextResponse.json({ ok: true })
}

// PATCH /api/bank — unmatch, approve, reassign
export async function PATCH(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, bankTxId, invoiceId, newInvoiceId, periodId: bodyPeriodId, splits, clientId, clientIds, invoiceRef, account: bodyAccount, amount: bodyAmount } = await req.json()
  const userEmail = (session as any).email || 'unknown'

  // Check period lock via the bank transaction's period
  if (bankTxId) {
    const tx = await query('SELECT bt.id, p.locked FROM bank_transactions bt JOIN periods p ON p.id = bt.period_id WHERE bt.id = $1', [bankTxId])
    if (tx.rows[0]?.locked) {
      return NextResponse.json({ error: 'Period is locked — unlock before modifying matches' }, { status: 403 })
    }
  }

  // ── unmatch ──────────────────────────────────────────────────────────────────
  if (action === 'unmatch') {
    const old = await query('SELECT status, matched_invoice_id FROM bank_transactions WHERE id = $1', [bankTxId])

    await query(
      "UPDATE bank_transactions SET status='unmatched', matched_invoice_id=NULL, discrepancy_pct=NULL WHERE id=$1",
      [bankTxId]
    )
    if (invoiceId) {
      // Only reset the invoice if no other bank txs are still linked to it
      const remaining = await query(
        "SELECT id FROM bank_transactions WHERE matched_invoice_id=$1 AND id!=$2 AND status!='unmatched'",
        [invoiceId, bankTxId]
      )
      if (remaining.rows.length === 0) {
        await query(
          "UPDATE invoices SET status='unmatched', matched_bank_id=NULL WHERE id=$1",
          [invoiceId]
        )
      } else {
        // Keep matched_bank_id pointing to a remaining linked tx
        await query(
          `UPDATE invoices SET matched_bank_id=$1
           WHERE id=$2 AND matched_bank_id=$3`,
          [remaining.rows[0].id, invoiceId, bankTxId]
        )
      }
    }
    await writeAudit('bank_transactions', bankTxId, 'unmatch',
      { status: old.rows[0]?.status, matched_invoice_id: old.rows[0]?.matched_invoice_id },
      { status: 'unmatched', matched_invoice_id: null }, userEmail)

    return NextResponse.json({ ok: true })
  }

  // ── acknowledge — mark as manually reviewed, no invoice needed ───────────────
  if (action === 'acknowledge') {
    await query(
      "UPDATE bank_transactions SET status='acknowledged' WHERE id=$1",
      [bankTxId]
    )
    await writeAudit('bank_transactions', bankTxId, 'acknowledge', null, { status: 'acknowledged' }, userEmail)
    return NextResponse.json({ ok: true })
  }

  // ── retag — update the account category on a bank transaction ───────────────
  if (action === 'retag') {
    if (!bodyAccount) return NextResponse.json({ error: 'account required' }, { status: 400 })
    await query('UPDATE bank_transactions SET account=$1 WHERE id=$2', [bodyAccount, bankTxId])
    await writeAudit('bank_transactions', bankTxId, 'retag', null, { account: bodyAccount }, userEmail)
    return NextResponse.json({ ok: true })
  }

  // ── tag_transfer — categorize as bank fee / FX cost and dismiss ──────────────
  if (action === 'tag_transfer') {
    const acct = bodyAccount || '452 - Bank Fees'
    await query(
      "UPDATE bank_transactions SET status='acknowledged', account=$1 WHERE id=$2",
      [acct, bankTxId]
    )
    await writeAudit('bank_transactions', bankTxId, 'tag_transfer', null, { account: acct, status: 'acknowledged' }, userEmail)
    return NextResponse.json({ ok: true })
  }

  // ── approve_match ────────────────────────────────────────────────────────────
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
    await writeAudit('bank_transactions', bankTxId, 'approve_match', null,
      { status: 'matched', invoiceId }, userEmail)

    return NextResponse.json({ ok: true })
  }

  // ── reassign — move bank tx to a different invoice ───────────────────────────
  if (action === 'reassign') {
    if (!newInvoiceId) {
      return NextResponse.json({ error: 'newInvoiceId required for reassign' }, { status: 400 })
    }

    // Verify new invoice exists and is for the same period
    const newInv = await query('SELECT id, vendor, amount_usd FROM invoices WHERE id = $1', [newInvoiceId])
    if (!newInv.rows[0]) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const tx = await query('SELECT id, amount_usd FROM bank_transactions WHERE id = $1', [bankTxId])
    const txAmt  = parseFloat(tx.rows[0]?.amount_usd || 0)
    const invAmt = parseFloat(newInv.rows[0].amount_usd || 0)
    const diff   = invAmt > 0 ? Math.abs(txAmt - invAmt) / invAmt : 0
    const newStatus = diff > DISCREPANCY_FLAG_THRESHOLD ? 'flagged' : 'matched'

    // Unlink old invoice if any
    if (invoiceId) {
      await query(
        "UPDATE invoices SET status='unmatched', matched_bank_id=NULL WHERE id=$1",
        [invoiceId]
      )
    }

    // Link to new invoice
    await query(
      "UPDATE bank_transactions SET status=$1, matched_invoice_id=$2, discrepancy_pct=$3 WHERE id=$4",
      [newStatus, newInvoiceId, diff > 0 ? (diff * 100).toFixed(4) : null, bankTxId]
    )
    // Only set matched_bank_id on the invoice if it doesn't already have one (preserve first link)
    await query(
      `UPDATE invoices SET status=$1,
        matched_bank_id = CASE WHEN matched_bank_id IS NULL THEN $2 ELSE matched_bank_id END
       WHERE id=$3`,
      [newStatus, bankTxId, newInvoiceId]
    )

    await writeAudit('bank_transactions', bankTxId, 'reassign',
      { matched_invoice_id: invoiceId },
      { matched_invoice_id: newInvoiceId, status: newStatus, discrepancy_pct: diff * 100 },
      userEmail)

    return NextResponse.json({
      ok: true,
      status: newStatus,
      discrepancyPct: diff * 100,
      flagged: newStatus === 'flagged',
      vendor: newInv.rows[0].vendor,
    })
  }

  // ── split — replace one bank tx with multiple smaller ones ──────────────────
  if (action === 'split') {
    if (!bankTxId || !splits?.length) {
      return NextResponse.json({ error: 'bankTxId and splits required' }, { status: 400 })
    }

    const origRes = await query('SELECT * FROM bank_transactions WHERE id = $1', [bankTxId])
    const orig = origRes.rows[0]
    if (!orig) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

    const originalAmount = parseFloat(orig.amount)
    const totalSplit = splits.reduce((s: number, r: any) => s + parseFloat(r.amount), 0)

    // Pro-rate amount_usd for each split piece
    const origUsd = parseFloat(orig.amount_usd || orig.amount)
    const usdRate = originalAmount > 0 ? origUsd / originalAmount : 1

    for (const split of splits) {
      const splitAmount = parseFloat(split.amount)
      const splitUsd    = Math.round(splitAmount * usdRate * 100) / 100
      await query(
        `INSERT INTO bank_transactions
          (period_id, date, description, amount, currency, amount_usd, type, account, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unmatched')`,
        [orig.period_id, orig.date, split.description, splitAmount,
         orig.currency, splitUsd, orig.type, orig.account]
      )
    }

    // Unlink any matched invoice, then delete the original
    await query("UPDATE invoices SET status='unmatched', matched_bank_id=NULL WHERE matched_bank_id=$1", [bankTxId])
    await query('DELETE FROM bank_transactions WHERE id=$1', [bankTxId])
    await writeAudit('bank_transactions', bankTxId, 'split', { amount: originalAmount }, { splits }, userEmail)

    return NextResponse.json({ ok: true, count: splits.length })
  }

  // ── tag_client — link a revenue bank tx to one or more clients ──────────────
  if (action === 'tag_client') {
    const ids: number[] = Array.isArray(clientIds)
      ? clientIds.filter(Boolean)
      : clientId != null ? [clientId] : []
    const primaryId = ids[0] ?? null
    // If clients are being tagged, mark as matched. If all clients are removed, revert to unmatched.
    const newStatus = ids.length > 0 ? 'matched' : 'unmatched'
    await query(
      'UPDATE bank_transactions SET client_id=$1, client_ids=$2, invoice_ref=$3, status=$4 WHERE id=$5',
      [primaryId, ids, invoiceRef || null, newStatus, bankTxId]
    )
    await writeAudit('bank_transactions', bankTxId, 'tag_client', null, { clientIds: ids, invoiceRef, status: newStatus }, userEmail)
    return NextResponse.json({ ok: true })
  }

  // ── rerun — re-run auto-reconcile for the period ──────────────────────────
  if (action === 'rerun') {
    if (!bodyPeriodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })
    // Reset any revenue transactions that were incorrectly auto-proposed back to unmatched
    await query(
      `UPDATE bank_transactions SET status='unmatched', discrepancy_pct=NULL
       WHERE period_id=$1 AND type='revenue' AND status IN ('proposed','flagged') AND matched_invoice_id IS NULL`,
      [bodyPeriodId]
    )
    await autoReconcile(bodyPeriodId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'update_amount') {
    const newAmount = parseFloat(bodyAmount)
    if (isNaN(newAmount) || newAmount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    const old = await query('SELECT amount, amount_usd FROM bank_transactions WHERE id=$1', [bankTxId])
    await query(
      'UPDATE bank_transactions SET amount=$1, amount_usd=$1 WHERE id=$2',
      [newAmount, bankTxId]
    )
    await writeAudit('bank_transactions', bankTxId, 'update',
      { amount: old.rows[0]?.amount, amount_usd: old.rows[0]?.amount_usd },
      { amount: newAmount, amount_usd: newAmount },
      userEmail
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ── Auto-reconcile with confidence scoring + discrepancy flagging ─────────────
async function autoReconcile(periodId: number) {
  // ── 1. Expense invoices → expense bank transactions ──────────────────────
  const invoices = await query(
    "SELECT id, amount_usd, date, vendor FROM invoices WHERE period_id = $1 AND status='unmatched'",
    [periodId]
  )
  const bankExpenses = await query(
    "SELECT id, amount, amount_usd, date, description FROM bank_transactions WHERE period_id = $1 AND status='unmatched' AND type='expense'",
    [periodId]
  )

  for (const inv of invoices.rows) {
    const invAmount = parseFloat(inv.amount_usd || 0)
    if (!invAmount) continue

    let bestMatch: any = null
    let bestScore = 0

    for (const tx of bankExpenses.rows) {
      const txAmount   = parseFloat(tx.amount_usd || tx.amount || 0)
      const amountDiff = Math.abs(txAmount - invAmount) / invAmount
      const daysDiff   = inv.date && tx.date
        ? Math.abs(new Date(tx.date).getTime() - new Date(inv.date).getTime()) / 86400000
        : 999

      let score = 0
      if (amountDiff < 0.01)       score += 50
      else if (amountDiff < 0.05)  score += 35
      else if (amountDiff < 0.10)  score += 15
      else continue

      if (daysDiff <= 1)       score += 30
      else if (daysDiff <= 3)  score += 20
      else if (daysDiff <= 7)  score += 10
      else if (daysDiff <= 14) score += 5

      if (inv.vendor && tx.description) {
        const vendor = inv.vendor.toLowerCase()
        const desc   = tx.description.toLowerCase()
        if (desc.includes(vendor) || vendor.includes(desc.split(' ')[0])) score += 20
        else if (vendor.split(' ').some((w: string) => w.length > 3 && desc.includes(w))) score += 10
      }

      if (score > bestScore) { bestScore = score; bestMatch = { tx, amountDiff } }
    }

    if (!bestMatch) continue

    const { tx: matchedTx, amountDiff } = bestMatch
    const confidence = bestScore >= 65 ? 'high' : bestScore >= 40 ? 'medium' : 'low'
    if (confidence === 'low') continue

    const isFlagged = amountDiff > DISCREPANCY_FLAG_THRESHOLD
    const status = isFlagged ? 'flagged' : confidence === 'high' ? 'matched' : 'proposed'

    await query(
      `UPDATE invoices SET status=$1,
        matched_bank_id = CASE WHEN matched_bank_id IS NULL THEN $2 ELSE matched_bank_id END
       WHERE id=$3`,
      [status, matchedTx.id, inv.id]
    )
    await query(
      "UPDATE bank_transactions SET status=$1, matched_invoice_id=$2, discrepancy_pct=$3 WHERE id=$4",
      [status, inv.id, isFlagged ? (amountDiff * 100).toFixed(4) : null, matchedTx.id]
    )

    bankExpenses.rows = bankExpenses.rows.filter((tx: any) => tx.id !== matchedTx.id)
  }

  // Revenue matching is intentionally manual — bank revenue transactions stay
  // unmatched until the user tags clients and splits them via the Reconciliation tab.
  // Auto-matching MRR entries to revenue bank transactions was removed because it
  // created false proposed matches, especially for bulk distributor payments (Lawina)
  // where one bank deposit covers multiple clients.
}
