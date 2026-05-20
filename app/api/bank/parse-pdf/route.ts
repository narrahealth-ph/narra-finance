import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { base64, fileName, mimeType } = await req.json()

  const isImage = mimeType && mimeType.startsWith('image/')
  const resolvedMimeType = isImage ? mimeType : 'application/pdf'

  const contentBlock: any = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: resolvedMimeType, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }

  const prompt = isImage
    ? `This is a screenshot or image of a financial statement or payment summary (filename: ${fileName}).

Extract ALL individual transactions or payment entries visible in this image.
If it shows a summary page (e.g. PayPal monthly summary, bank summary), extract each line item as a separate transaction.

For each entry extract:
- date (format: YYYY-MM-DD, use the statement date if individual dates are not shown)
- description (vendor, payee, or payment description)
- amount (positive number)
- currency (USD, SGD, EUR, GBP, PHP — default USD if unclear)
- type: "revenue" if money received, "expense" if money sent/paid out, "transfer" for internal moves
- account: the account name or platform (e.g. "PayPal", "USD", "SGD")

IMPORTANT:
- Do NOT include running balances or total balance rows as transactions
- DO include fees as separate expense transactions if shown
- If only totals are visible (e.g. "Total payments sent: $X"), create one transaction for that total

Return ONLY valid JSON, no markdown:
{"transactions": [{"date": "2026-04-01", "description": "Payment to vendor", "amount": 100.00, "currency": "USD", "type": "expense", "account": "PayPal"}]}`
    : `Extract ALL transactions from this Sleek bank statement PDF (filename: ${fileName}).

STATEMENT FORMAT:
- This is a Sleek multi-currency statement for Narra Health PTE. LTD.
- It is divided into currency sections: EUR, GBP, SGD, USD (each headed "SLEEK / NARRA HEALTH PTE. LTD. XXX - 885413718826")
- Each section has columns: Date | Description | Deposit | Withdrawal | Balance
- Descriptions are multi-line blocks — treat everything between two Date entries as one transaction's description
- Use only the primary vendor/payee name as the description (e.g. "K LINE LOGISTICS PHILS INC", "GOOGLE*GSUITE NARRAMIN", "Stella Regina Pangilinan") — omit reference numbers, bank names, card holder names, card numbers, and "INSTRUCTED AMT" lines

AMOUNT RULES — CRITICAL:
- ALWAYS use the number in the Deposit or Withdrawal column as the transaction amount
- NEVER use amounts mentioned inside the description text (e.g. "INSTRUCTED AMT USD 12917.3" or "SENDER CHARGES USD 15" — ignore these; use only the actual column value)
- If Deposit column has a value → amount = that number, type = "revenue"
- If Withdrawal column has a value → amount = that number, type = "expense"
- Amount 0.00 is valid — include the transaction with amount 0.00

TYPE RULES — COLUMN DETERMINES TYPE, NOT VENDOR NAME:
- type is determined SOLELY by which column has a value: Deposit = "revenue", Withdrawal = "expense"
- Do NOT assume a vendor is always revenue or always expense based on their name
- Example: "Lawina Company Limited" usually pays Narra (deposit = revenue), but can also appear as a withdrawal (expense) when Narra pays them for something like health insurance — classify by the column, not the name
- "fx" — ONLY for rows whose description starts with or contains "Currency Exchange" or "Converted USD to SGD" / "Converted USD X to SGD"
- "transfer" — internal account transfer not labelled as FX

CURRENCY & ACCOUNT:
- Each transaction's currency = the section it appears in (EUR / GBP / SGD / USD)
- account field = the currency code (e.g. "SGD", "USD")

CURRENCY EXCHANGE (FX) DEDUPLICATION — CRITICAL:
- Every FX conversion appears TWICE: as a Deposit in the destination currency section AND as a Withdrawal in the source currency section
- There can be multiple FX conversions in one month — deduplicate each one individually
- For each FX conversion: extract it ONLY ONCE using the SGD deposit side (type "fx", currency "SGD", amount = the SGD deposit amount)
- SKIP every "Currency Exchange" row that appears as a Withdrawal (these are always in the USD section)
- Matching rule: a USD withdrawal labelled "Currency Exchange" on date X pairs with the SGD deposit labelled "Currency Exchange" on date X — skip the USD side

SAME-DATE SAME-PAYEE RULE:
- If the same payee appears multiple times on the same date (even with the same amount), extract each row as a SEPARATE transaction — do NOT merge or deduplicate them
- This applies to reversals/refunds too: e.g. a withdrawal of 1.42 followed by a deposit of 1.42 from the same vendor on the same date = two separate transactions

BANK FEE ROWS:
- Small withdrawals (typically $5–$35) that appear 1-2 days after a large payment, with just a company name and no payment description, are bank processing fees — include them as type "expense"
- Examples: "K LINE LOGISTICS PHILS INC" for 7.40, "LAWINA COMPANY LIMITED" for 7.72, "MC1 ENTERPRISES" for 7.53 — these are fees, not the main payment

ROWS TO SKIP (not real transactions):
- "Balance brought forward" rows
- "Total Balance Carried Forward" summary rows
- Any row with no date and no deposit/withdrawal amount

Return ONLY valid JSON, no markdown, no explanation:
{"transactions": [{"date": "2025-02-20", "description": "K LINE LOGISTICS PHILS INC", "amount": 8257.00, "currency": "USD", "type": "revenue", "account": "USD"}]}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [contentBlock, { type: 'text', text: prompt }]
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return NextResponse.json(parsed)

  } catch (err: any) {
    console.error('Bank PDF parse error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
