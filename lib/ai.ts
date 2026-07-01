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
    model:      'claude-sonnet-4-5',
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
  totalRevenue:  number   // accrual MRR (earned this month under contracts)
  cashRevenue:   number   // actual bank cash received this month
  totalExpenses: number
  netProfit:     number
  mrr:           number
  mrrGrowth:     number
  clientCount:   number
  cashBalance:   number
  runway:        number
  topClients:    { name: string; amount: number }[]
  anomalies:     string[]
  billingNote:   string
  prevRevenue:   { label: string; revenue: number }[]
  prevBurn:      { label: string; expenses: number }[]
}) {
  const prevRevenueStr = data.prevRevenue.length > 0
    ? data.prevRevenue.map(r => `  ${r.label}: $${r.revenue.toLocaleString()} cash received`).join('\n')
    : '  No prior months on record'

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{
      role:    'user',
      content: `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Write a concise, professional monthly financial narrative for ${data.period} to share with investors.

BILLING MODEL: Narra Health clients are on annual contracts — they pay once per year upfront. This means cash received in the bank may be $0 in months where clients already pre-paid earlier in the year. MRR (accrual) reflects the revenue earned each month regardless of when cash is received.

${data.billingNote ? data.billingNote + '\n' : ''}
Financial data for ${data.period}:
- MRR (accrual revenue earned): $${data.mrr.toLocaleString()}
- Cash received from clients this month: $${data.cashRevenue.toLocaleString()}
- Operating expenses (from bank): $${data.totalExpenses.toLocaleString()}
- Net Profit/Loss (accrual): $${data.netProfit.toLocaleString()}
- Cash Balance: $${data.cashBalance.toLocaleString()}
- Cash Runway: ${data.runway} months
- Active Clients: ${data.clientCount}
- Top clients by MRR: ${data.topClients.map(c => `${c.name} ($${c.amount.toLocaleString()}/mo)`).join(', ')}

Recent cash received (prior months for context):
${prevRevenueStr}

Write 3 short paragraphs:
1. Month headline — use MRR as the primary revenue metric, note if $0 cash was received and why (annual billing)
2. Revenue & growth — MRR, top clients, cash timing explanation if relevant
3. Cost & outlook — main expenses, runway, forward-looking

Tone: confident, transparent, investor-appropriate. Do not flag $0 cash months as a problem — explain they are expected under annual billing. No bullet points. Max 220 words.`
    }]
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ── Detect anomalies in expense data ─────────────────────────────────────────
export async function detectAnomalies(transactions: any[], prevMonthAvg: any, billingNote = '') {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{
      role:    'user',
      content: `Analyze these EXPENSE transactions for Narra Health and flag anomalies.

IMPORTANT: Only analyze expenses (outgoing bank payments). Do NOT flag missing revenue or $0 revenue as an anomaly — Narra Health clients are on annual plans so cash revenue may be $0 in many months by design.
${billingNote ? '\n' + billingNote + '\n' : ''}
Current month expense transactions:
${JSON.stringify(transactions.map(t => ({ description: t.description, amount: t.amount_usd || t.amount, account: t.account })), null, 2)}

Expense totals by category:
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
  totalRevenue:        number   // accrual MRR
  cashRevenue:         number   // cash received this month
  totalExpenses:       number
  netProfit:           number
  cashBalance:         number
  runway:              number
  totalMrr:            number
  billingNote:         string
  expensesByCategory:  { category: string; amount: number }[]
  topExpenses:         { vendor: string; amount: number; account: string }[]
  mrrByClient:         { client: string; amount: number }[]
  prevRevenue:         { label: string; revenue: number }[]
}) {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 600,
    messages: [{
      role:    'user',
      content: `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Answer the following question using the financial data below. Be direct, specific, and use actual numbers.

BILLING MODEL: Clients are on annual contracts — they pay once per year upfront. Cash received from clients can be $0 in months where annual clients already pre-paid. MRR (accrual) is the true monthly revenue figure.
${ctx.billingNote ? '\n' + ctx.billingNote + '\n' : ''}
QUESTION: ${question}

FINANCIAL DATA FOR ${ctx.period}:
- MRR (accrual revenue earned this month): $${ctx.totalMrr.toLocaleString()}
- Cash received from clients this month: $${ctx.cashRevenue.toLocaleString()}
- Operating expenses (bank outflows): $${ctx.totalExpenses.toLocaleString()}
- Net profit/loss (accrual): $${ctx.netProfit.toLocaleString()}
- Cash balance: $${ctx.cashBalance.toLocaleString()}
- Cash runway: ${ctx.runway} months

Recent cash received from clients (prior months):
${ctx.prevRevenue.map(r => `  ${r.label}: $${r.revenue.toLocaleString()}`).join('\n') || '  No prior data'}

Expenses by category:
${ctx.expensesByCategory.map(e => `  ${e.category}: $${e.amount.toLocaleString()}`).join('\n')}

Top expense vendors:
${ctx.topExpenses.slice(0, 8).map(e => `  ${e.vendor} (${e.account}): $${e.amount.toLocaleString()}`).join('\n')}

MRR by client (monthly accrual):
${ctx.mrrByClient.map(c => `  ${c.client}: $${c.amount.toLocaleString()}/mo`).join('\n')}

Answer in 3–5 sentences. Lead with a clear yes/no or direct finding when applicable. Use specific dollar amounts. When discussing revenue, use MRR as the primary figure and note cash timing only if relevant.`
    }]
  })
  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// ── Churn risk assessment ─────────────────────────────────────────────────────
export async function assessChurnRisk(clients: { name: string; payments: number[]; lastPayment: string; seats: number }[]) {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
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
