import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { base64, fileName } = await req.json()

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          {
            type: 'text',
            text: `Extract ALL transactions from this bank statement PDF (filename: ${fileName}).

This is a Sleek multi-currency bank statement for Narra Health PTE. LTD.
It has sections for SGD, USD, EUR, and GBP accounts.

For each transaction row extract:
- date (format: YYYY-MM-DD)
- description (vendor/payee name, clean it up)
- amount (positive number, the actual transaction amount)
- currency (SGD, USD, EUR, or GBP based on which account section it's in)
- type: use these rules:
  * "revenue" if it's a deposit/incoming payment (e.g. LAWINA COMPANY, client payments)
  * "expense" if it's a withdrawal/outgoing payment (e.g. PLANETSCALE, Google, Slack, Zoom, Calendly, Netlify, Notion, IDEIN SERVICES, SLEEK SUBSCRIPTION, Mailchimp, ChatGPT)
  * "fx" if it's a currency exchange/conversion between accounts
  * "transfer" if it's an internal transfer
- account: the currency account it belongs to (e.g. "SGD", "USD")

IMPORTANT: 
- Do NOT include opening balances or "Balance brought forward" rows
- Do NOT include "Total Balance Carried Forward" summary rows
- DO include all actual transactions including payroll (IDEIN SERVICES)
- For FX conversions, use the SGD amount and mark as "fx"

Return ONLY valid JSON, no markdown:
{
  "transactions": [
    {
      "date": "2026-04-01",
      "description": "PLANETSCALE INC",
      "amount": 60.79,
      "currency": "SGD",
      "type": "expense",
      "account": "SGD"
    }
  ]
}`
          }
        ]
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
