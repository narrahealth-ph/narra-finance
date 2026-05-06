import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const INVOICE_SHEET_ID = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'
const MRR_SHEET_ID     = '1057EJCsrTPT7LFHBYqsqYVVERuwgZ7kScmHy8j1Or8s'
const MRR_TAB          = '🟩 MRR'

// Safe month → column mapping for MRR sheet writes
const MONTH_TO_COL: Record<string, string> = {
  'Jan_2026': 'Y',  'Feb_2026': 'Z',  'Mar_2026': 'AA', 'Apr_2026': 'AB',
  'May_2026': 'AC', 'Jun_2026': 'AD', 'Jul_2026': 'AE', 'Aug_2026': 'AF',
  'Sep_2026': 'AG', 'Oct_2026': 'AH', 'Nov_2026': 'AI', 'Dec_2026': 'AJ',
  'Jan_2027': 'AN', 'Feb_2027': 'AO', 'Mar_2027': 'AP', 'Apr_2027': 'AQ',
  'May_2027': 'AR', 'Jun_2027': 'AS', 'Jul_2027': 'AT', 'Aug_2027': 'AU',
  'Sep_2027': 'AV', 'Oct_2027': 'AW', 'Nov_2027': 'AX', 'Dec_2027': 'AY',
}

const CLIENT_ROWS: Record<string, number> = {
  'ofii': 4, 'orient freight': 4,
  'kllp': 5, 'kline logistics': 5,
  'kalp': 6, 'kline auto logistics': 6,
  'klas': 7, 'kline auto solutions': 7,
  'rib': 8,  'lawina': 8,
  'mbg': 11, 'mbg capital': 11,
  'peralta': 12,
  'new alabang': 15, 'navc': 15,
  'rayomar': 17,
  'krbs': 18,
  'omi': 19,
  'kmsm': 21,
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

// ── GET /api/reconcile?periodId=1 ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periodId = new URL(req.url).searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

  // Get or create session
  let res = await query(
    'SELECT * FROM reconciliation_sessions WHERE period_id = $1 ORDER BY created_at DESC LIMIT 1',
    [periodId]
  )

  if (res.rows.length === 0) {
    res = await query(
      'INSERT INTO reconciliation_sessions (period_id) VALUES ($1) RETURNING *',
      [periodId]
    )
  }

  const session_data = res.rows[0]

  // Also fetch outgoing invoices from Google Sheet for this period
  let outgoingInvoices: any[] = []
  try {
    const sheets = getSheetsClient()
    const invRes = await sheets.spreadsheets.values.get({
      spreadsheetId: INVOICE_SHEET_ID,
      range: '2026!A2:I200',
    })
    const rows = invRes.data.values || []
    outgoingInvoices = rows
      .filter(r => r[0] && r[5] && r[6])
      .map(r => ({
        invoiceId:   r[0] || '',
        clientName:  r[1] || '',
        issueDate:   r[4] || '',
        amount:      parseFloat((r[5] || '0').replace(/[$,]/g, '')),
        status:      r[6] || '',
        billingType: r[7] || 'Annual',
        notes:       r[8] || '',
      }))
  } catch (e) {
    console.error('Could not fetch outgoing invoices:', e)
  }

  return NextResponse.json({
    id:               session_data.id,
    periodId:         session_data.period_id,
    status:           session_data.status,
    bankTransactions: session_data.bank_json || [],
    expenses:         session_data.expenses_json || [],
    outgoingInvoices,
    matches:          session_data.matches_json || [],
    questions:        session_data.questions_json || [],
    mrrSnapshot:      session_data.mrr_snapshot || {},
    notes:            session_data.notes || '',
    approvedAt:       session_data.approved_at,
    pushedToSheet:    session_data.pushed_to_sheet,
  })
}

// ── POST /api/reconcile ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action, periodId, sessionId } = body

  // ── action: save_bank ──────────────────────────────────────────────────────
  if (action === 'save_bank') {
    const { transactions } = body
    await query(
      'UPDATE reconciliation_sessions SET bank_json = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(transactions), sessionId]
    )
    return NextResponse.json({ success: true })
  }

  // ── action: save_expenses ─────────────────────────────────────────────────
  if (action === 'save_expenses') {
    const { expenses } = body
    await query(
      'UPDATE reconciliation_sessions SET expenses_json = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(expenses), sessionId]
    )
    return NextResponse.json({ success: true })
  }

  // ── action: parse_bank_pdf ────────────────────────────────────────────────
  if (action === 'parse_bank_pdf') {
    const { base64, fileName } = body
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          {
            type: 'text',
            text: `Extract ALL transactions from this bank/PayPal statement (${fileName}).
This may be a Sleek multi-currency statement, a DBS statement, or a PayPal PDF/screenshot.

For each transaction extract:
- date (YYYY-MM-DD)
- description (clean vendor/payee name)
- amount (positive number)
- currency (SGD/USD/EUR/GBP/PHP)
- type: "revenue" if incoming deposit, "expense" if outgoing payment, "fx" if currency exchange, "transfer" if internal
- account: which currency account (SGD/USD/etc)
- source: "sleek" | "paypal" | "dbs" | "unknown"

Skip: opening balances, closing balances, summary rows.
Include: all actual transactions.

Return ONLY valid JSON, no markdown:
{
  "transactions": [
    { "date": "2026-04-01", "description": "LAWINA COMPANY LIMITED", "amount": 65043.00, "currency": "USD", "type": "revenue", "account": "USD", "source": "sleek" }
  ]
}`
          }
        ]
      }]
    })
    const text  = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return NextResponse.json(parsed)
  }

  // ── action: parse_paypal_image ────────────────────────────────────────────
  if (action === 'parse_paypal_image') {
    const { base64, mimeType } = body
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          {
            type: 'text',
            text: `Extract all transactions visible in this PayPal screenshot or statement.
Return ONLY valid JSON, no markdown:
{
  "transactions": [
    { "date": "2026-04-01", "description": "Payment from client", "amount": 500.00, "currency": "USD", "type": "revenue", "account": "PayPal", "source": "paypal" }
  ]
}`
          }
        ]
      }]
    })
    const text  = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return NextResponse.json(parsed)
  }

  // ── action: ai_reconcile ──────────────────────────────────────────────────
  if (action === 'ai_reconcile') {
    const { outgoingInvoices, bankTransactions, expenses } = body

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a financial reconciliation expert for Narra Health PTE. LTD., a Singapore-based health SaaS company.

CONTEXT:
- Narra sells annual subscriptions to veterinary clinics
- Some clients pay directly, others pay through distributors (mainly Lawina Company Limited / RIB)
- Lawina collects from: OFII, KLLP, KLAS, KALP, RAYOMAR, KRBS and sends Narra one bulk USD payment
- PayPal may also receive payments from some clients

OUTGOING INVOICES (what Narra invoiced to clients):
${JSON.stringify(outgoingInvoices, null, 2)}

BANK TRANSACTIONS (what actually hit the bank):
${JSON.stringify(bankTransactions, null, 2)}

EXPENSE INVOICES (vendor bills from Google Drive):
${JSON.stringify(expenses, null, 2)}

TASK: Cross-check these three sources and:
1. Match bank deposits to outgoing invoices (even if names differ slightly, e.g. "Lawina" = bulk payment for multiple clients)
2. Match bank withdrawals to expense invoices
3. Flag anything unmatched or unclear
4. For distributor payments: try to identify which clients are included in each bulk payment
5. Note any name discrepancies you resolved (e.g. "IDEIN" = payroll)

Return ONLY valid JSON, no markdown:
{
  "matches": [
    {
      "type": "revenue_match",
      "invoiceIds": ["INV-001"],
      "bankDescription": "LAWINA COMPANY LIMITED",
      "bankAmount": 65043.00,
      "invoiceTotal": 65043.00,
      "confidence": "high",
      "note": "Bulk payment from Lawina covering RAYOMAR, KRBS, OFII invoices",
      "clients": ["RAYOMAR", "KRBS", "OFII"]
    }
  ],
  "unmatched_invoices": [
    { "invoiceId": "INV-002", "clientName": "MBG", "amount": 2063, "reason": "No bank deposit found for this amount" }
  ],
  "unmatched_bank": [
    { "description": "UNKNOWN PAYMENT", "amount": 500, "reason": "Cannot identify matching invoice" }
  ],
  "questions": [
    {
      "id": "q1",
      "question": "The bank shows a payment of $81 from 'Google' on Jan 1. Is this a subscription expense or something else?",
      "context": { "bankDescription": "Google", "amount": 81, "date": "2026-01-01" },
      "answer": null,
      "resolved": false
    }
  ],
  "summary": {
    "totalRevenue": 0,
    "totalExpenses": 0,
    "matchedRevenue": 0,
    "matchedExpenses": 0,
    "unmatchedRevenueCount": 0,
    "unmatchedExpenseCount": 0
  }
}`
      }]
    })

    const text   = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean  = text.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)

    // Save AI result to DB
    await query(
      `UPDATE reconciliation_sessions 
       SET matches_json = $1, questions_json = $2, status = 'in_review', updated_at = NOW() 
       WHERE id = $3`,
      [JSON.stringify(result.matches), JSON.stringify(result.questions), sessionId]
    )

    return NextResponse.json(result)
  }

  // ── action: answer_question ───────────────────────────────────────────────
  if (action === 'answer_question') {
    const { questionId, answer } = body
    const res = await query(
      'SELECT questions_json FROM reconciliation_sessions WHERE id = $1',
      [sessionId]
    )
    const questions = res.rows[0]?.questions_json || []
    const updated = questions.map((q: any) =>
      q.id === questionId ? { ...q, answer, resolved: true } : q
    )
    await query(
      'UPDATE reconciliation_sessions SET questions_json = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(updated), sessionId]
    )
    return NextResponse.json({ success: true, questions: updated })
  }

  // ── action: update_match ──────────────────────────────────────────────────
  if (action === 'update_match') {
    const { matches } = body
    await query(
      'UPDATE reconciliation_sessions SET matches_json = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(matches), sessionId]
    )
    return NextResponse.json({ success: true })
  }

  // ── action: approve ───────────────────────────────────────────────────────
  if (action === 'approve') {
    const { mrrSnapshot, periodLabel, notes } = body

    // Save approval
    await query(
      `UPDATE reconciliation_sessions 
       SET status = 'approved', mrr_snapshot = $1, notes = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(mrrSnapshot), notes || '', sessionId]
    )

    // Also write to the periods table so MRR graph can read it
    await query(
      'UPDATE periods SET approved_mrr = $1 WHERE id = $2',
      [JSON.stringify(mrrSnapshot), periodId]
    )

    return NextResponse.json({ success: true })
  }

  // ── action: push_to_sheet ─────────────────────────────────────────────────
  if (action === 'push_to_sheet') {
    const { mrrSnapshot, periodLabel } = body
    // periodLabel format: "January_2026"
    const [monthName, year] = periodLabel.split('_')
    const monthAbbr = monthName.substring(0, 3)
    const colKey = `${monthAbbr}_${year}`
    const col = MONTH_TO_COL[colKey]

    if (!col) {
      return NextResponse.json({ error: `No column mapping for ${periodLabel}` }, { status: 400 })
    }

    try {
      const sheets = getSheetsClient()
      const data: { range: string; values: any[][] }[] = []
      const cell = (row: number) => `'${MRR_TAB}'!${col}${row}`

      // Write total MRR — skip row 3 as it's a formula
      // Write per-client MRR
      const clients: any[] = mrrSnapshot.clients || []
      for (const c of clients) {
        const lname = c.name.toLowerCase()
        let row: number | null = null
        for (const [key, r] of Object.entries(CLIENT_ROWS)) {
          if (lname.includes(key)) { row = r; break }
        }
        if (row && c.mrr > 0) {
          data.push({ range: cell(row), values: [[Math.round(c.mrr)]] })
        }
      }

      // Write costs
      if (mrrSnapshot.payroll)    data.push({ range: cell(29), values: [[Math.round(mrrSnapshot.payroll)]] })
      if (mrrSnapshot.subs)       data.push({ range: cell(30), values: [[Math.round(mrrSnapshot.subs)]] })
      if (mrrSnapshot.marketing)  data.push({ range: cell(31), values: [[Math.round(mrrSnapshot.marketing)]] })

      if (data.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: MRR_SHEET_ID,
          requestBody: { valueInputOption: 'RAW', data },
        })
      }

      // Mark as pushed
      await query(
        'UPDATE reconciliation_sessions SET pushed_to_sheet = TRUE, updated_at = NOW() WHERE id = $1',
        [sessionId]
      )

      return NextResponse.json({ success: true, cellsWritten: data.length })
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
