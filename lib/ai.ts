import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Extract invoice data from a PDF or image ─────────────────────────────────
export async function extractInvoiceData(base64: string, mimeType: string, fileName: string) {
  const isImage = mimeType.startsWith('image/')
  const isPdf   = mimeType === 'application/pdf'

  if (!isImage && !isPdf) {
    return { error: 'Unsupported file type' }
  }

  const contentBlock = isPdf
    ? {
        type: 'document' as const,
        source: {
          type:       'base64' as const,
          media_type: 'application/pdf' as const,
          data:       base64,
        },
      }
    : {
        type: 'image' as const,
        source: {
          type:       'base64' as const,
          media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data:       base64,
        },
      }

  const response = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role:    'user',
      content: [
        contentBlock,
        {
          type: 'text',
          text: `Extract invoice data from this document (filename: ${fileName}).
Return ONLY valid JSON, no markdown, no explanation:
{
  "vendor": "supplier/vendor name",
  "date": "YYYY-MM-DD",
  "amount": 0.00,
  "currency": "USD",
  "invoice_number": "if visible",
  "description": "brief description of what was purchased",
  "suggested_account": "best match from: 411-Professional fees | 417-Freight | 426-Subscriptions | 427-General Expenses | 452-Bank Fees | 525-FX Gains/Losses",
  "confidence": "high | medium | low"
}
If you cannot extract a field, use null.`
        }
      ]
    }]
  })

  try {
    const text  = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return { error: 'Could not parse AI response', raw: response.content[0] }
  }
}

// ── Generate monthly AI narrative for investors ───────────────────────────────
export async function generateInvestorNarrative(data: {
  period:        string
  totalRevenue:  number
  totalExpenses: number
  netProfit:     number
  mrr:           number
  mrrGrowth:     number
  clientCount:   number
  cashBalance:   number
  runway:        number
  topClients:    { name: string; amount: number }[]
  anomalies:     string[]
}) {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role:    'user',
      content: `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Write a concise, professional monthly financial narrative for ${data.period} to share with investors.

Financial data:
- MRR: $${data.mrr.toLocaleString()} (${data.mrrGrowth >= 0 ? '+' : ''}${data.mrrGrowth.toFixed(1)}% MoM)
- Revenue: $${data.totalRevenue.toLocaleString()}
- Expenses: $${data.totalExpenses.toLocaleString()}
- Net Profit/Loss: $${data.netProfit.toLocaleString()}
- Cash Balance: $${data.cashBalance.toLocaleString()}
- Cash Runway: ${data.runway} months
- Active Clients: ${data.clientCount}
- Top clients: ${data.topClients.map(c => `${c.name} ($${c.amount.toLocaleString()})`).join(', ')}
${data.anomalies.length > 0 ? `- Flagged items: ${data.anomalies.join('; ')}` : ''}

Write 3 short paragraphs:
1. Month headline — key metric and overall tone
2. Revenue & growth — MRR, top clients, any notable changes
3. Cost & outlook — main expenses, runway, forward-looking

Tone: confident, transparent, investor-appropriate. No bullet points. Max 200 words.`
    }]
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ── Detect anomalies in expense data ─────────────────────────────────────────
export async function detectAnomalies(transactions: any[], prevMonthAvg: any) {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role:    'user',
      content: `Analyze these expense transactions for Narra Health and flag anomalies.

Current month transactions:
${JSON.stringify(transactions, null, 2)}

Previous month averages by category:
${JSON.stringify(prevMonthAvg, null, 2)}

Return ONLY valid JSON array of anomalies, no markdown:
[
  {
    "type": "overspend | unusual_vendor | missing_invoice | duplicate",
    "description": "plain english description",
    "amount": 0.00,
    "severity": "high | medium | low"
  }
]
If no anomalies, return empty array [].`
    }]
  })

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return []
  }
}

// ── Answer a financial question ───────────────────────────────────────────────
export async function answerFinancialQuestion(question: string, ctx: {
  period:              string
  totalRevenue:        number
  totalExpenses:       number
  netProfit:           number
  cashBalance:         number
  runway:              number
  totalMrr:            number
  expensesByCategory:  { category: string; amount: number }[]
  topExpenses:         { vendor: string; amount: number; account: string }[]
  mrrByClient:         { client: string; amount: number }[]
}) {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role:    'user',
      content: `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Answer the following question using the financial data below. Be direct, specific, and use actual numbers.

QUESTION: ${question}

FINANCIAL DATA FOR ${ctx.period}:
- Cash balance: $${ctx.cashBalance.toLocaleString()}
- Monthly revenue: $${ctx.totalRevenue.toLocaleString()}
- Monthly expenses: $${ctx.totalExpenses.toLocaleString()}
- Net profit/loss: $${ctx.netProfit.toLocaleString()}
- MRR: $${ctx.totalMrr.toLocaleString()}
- Cash runway: ${ctx.runway} months

Expenses by category:
${ctx.expensesByCategory.map(e => `  ${e.category}: $${e.amount.toLocaleString()}`).join('\n')}

Top expense vendors:
${ctx.topExpenses.slice(0, 8).map(e => `  ${e.vendor} (${e.account}): $${e.amount.toLocaleString()}`).join('\n')}

Revenue by client (MRR):
${ctx.mrrByClient.map(c => `  ${c.client}: $${c.amount.toLocaleString()}`).join('\n')}

Answer in 3–5 sentences. Lead with a clear yes/no or direct finding when applicable. Use specific dollar amounts.`
    }]
  })
  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ── Churn risk assessment ─────────────────────────────────────────────────────
export async function assessChurnRisk(clients: { name: string; payments: number[]; lastPayment: string; seats: number }[]) {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role:    'user',
      content: `Assess churn risk for these Narra Health clients based on payment patterns.

${JSON.stringify(clients, null, 2)}

Return ONLY valid JSON array, no markdown:
[
  {
    "client": "name",
    "risk": "high | medium | low",
    "reason": "one sentence reason",
    "recommendation": "one action to take"
  }
]`
    }]
  })

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return []
  }
}
