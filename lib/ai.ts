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
  period:            string
  totalRevenue:      number   // accrual MRR (earned this month under contracts)
  cashRevenue:       number   // actual bank cash received this month
  totalExpenses:     number
  netProfit:         number
  mrr:               number
  mrrGrowth:         number
  clientCount:       number
  cashBalance:       number
  runway:            number
  topClients:        { name: string; amount: number }[]
  anomalies:         string[]
  billingNote:       string
  prevRevenue:       { label: string; revenue: number }[]
  prevBurn:          { label: string; expenses: number }[]
  newClients:        { name: string; amount: number }[]
  costMoMPct:        number | null
  pendingCollection: { clientName: string; amount: number; daysOutstanding: number }[]
  pipelineDeals:     { clientName: string; amount: number; billingType: string; notes?: string }[]
}) {
  const prevRevenueStr = data.prevRevenue.length > 0
    ? data.prevRevenue.map(r => `  ${r.label}: $${r.revenue.toLocaleString()} cash received`).join('\n')
    : '  No prior months on record'

  const topClient = data.topClients[0]

  const pendingStr = data.pendingCollection.length > 0
    ? `$${data.pendingCollection.reduce((s, i) => s + i.amount, 0).toLocaleString()} across ${data.pendingCollection.length} invoice(s) — ` +
      data.pendingCollection.map(i => `${i.clientName} ($${i.amount.toLocaleString()}, ${i.daysOutstanding}d outstanding)`).join(', ')
    : 'None'

  const pipelineTotal = data.pipelineDeals.reduce((s, d) => s + d.amount, 0)
  const pipelineStr = data.pipelineDeals.length > 0
    ? `$${pipelineTotal.toLocaleString()} ARR — ${data.pipelineDeals.map(d => `${d.clientName} ($${d.amount.toLocaleString()} ${d.billingType}${d.notes ? ', ' + d.notes : ''})`).join(', ')}`
    : 'None currently'

  const costMomStr = data.costMoMPct !== null
    ? `${data.costMoMPct > 0 ? '+' : ''}${data.costMoMPct}% vs prior month`
    : 'No prior month data'

  const newClientsStr = data.newClients.length > 0
    ? data.newClients.map(c => `${c.name} ($${c.amount.toLocaleString()}/mo)`).join(', ')
    : 'None this month'

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1200,
    messages: [{
      role:    'user',
      content: `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Write a concise, professional monthly financial narrative for ${data.period} to share with investors.

BILLING MODEL: Narra Health clients are on ANNUAL contracts with automatic renewal. They pay the full year upfront. Cash received may be $0 in months where clients already pre-paid earlier in the year — this is NORMAL and expected, NOT a revenue problem. MRR (accrual) reflects the true monthly revenue regardless of when cash arrives.

${data.billingNote ? data.billingNote + '\n' : ''}
FINANCIAL DATA FOR ${data.period}:
- MRR (accrual revenue earned this month): $${data.mrr.toLocaleString()}
- Cash received from clients this month: $${data.cashRevenue.toLocaleString()}
- Operating expenses: $${data.totalExpenses.toLocaleString()} (${costMomStr})
- Net Profit/Loss (accrual): $${data.netProfit.toLocaleString()}
- Cash Balance: $${data.cashBalance.toLocaleString()}
- Cash Runway: ${data.runway} months
- Active Clients: ${data.clientCount}
- Top revenue client: ${topClient ? `${topClient.name} at $${topClient.amount.toLocaleString()}/mo` : 'N/A'}
- All clients by MRR: ${data.topClients.map(c => `${c.name} ($${c.amount.toLocaleString()}/mo)`).join(', ')}
- New clients added this month: ${newClientsStr}

Recent cash received (prior months):
${prevRevenueStr}

PENDING COLLECTION (invoices sent but not yet paid):
${pendingStr}

SALES PIPELINE (deals not yet contracted):
${pipelineStr}

Write 4 short paragraphs:
1. Month headline — MRR as primary revenue figure, note any new clients added
2. Revenue & clients — MRR, top revenue client, client count, cash timing if relevant (annual billing)
3. Costs & cash — operating expenses, MoM cost change, cash balance, runway
4. Pipeline & outlook — pending collections, sales pipeline names and amounts, forward-looking

Tone: confident, transparent, investor-appropriate. Include all specific dollar amounts and client names provided. Do not flag $0 cash months as a problem. No bullet points. Max 280 words.`
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
    max_tokens: 800,
    messages: [{
      role:    'user',
      content: `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Answer the following question using the financial data below. Be direct, specific, and use actual numbers.

CRITICAL BILLING MODEL — READ CAREFULLY:
- Narra Health clients are on ANNUAL contracts with AUTOMATIC RENEWAL. They pay once per year upfront.
- When a client pays $X annually, the FULL $X lands in the bank in that one month. It does NOT drip in monthly.
- In subsequent months, $0 cash is received from that client — but the cash is STILL IN THE BANK from the upfront payment.
- This means: $0 cash received in a month does NOT mean revenue disappeared or cash ran out. It simply means no new invoices were collected that month.
- The current cash balance ($${ctx.cashBalance.toLocaleString()}) already accounts for all cash in and all expenses out. Use this figure — do not try to re-derive cash by subtracting monthly expenses from revenue.
- MRR ($${ctx.totalMrr.toLocaleString()}/mo) is the accrual revenue earned each month; cash balance is the actual bank position.
${ctx.billingNote ? '\n' + ctx.billingNote + '\n' : ''}
QUESTION: ${question}

FINANCIAL DATA FOR ${ctx.period}:
- MRR (accrual revenue earned this month): $${ctx.totalMrr.toLocaleString()}
- Cash received from clients this month: $${ctx.cashRevenue.toLocaleString()} (may be $0 — annual clients pre-paid)
- Operating expenses (bank outflows): $${ctx.totalExpenses.toLocaleString()}
- Net profit/loss (accrual): $${ctx.netProfit.toLocaleString()}
- CURRENT CASH BALANCE (actual bank position): $${ctx.cashBalance.toLocaleString()}
- Cash runway at current spend: ${ctx.runway} months

Recent cash received from clients (prior months — shows when annual payments landed):
${ctx.prevRevenue.map(r => `  ${r.label}: $${r.revenue.toLocaleString()}`).join('\n') || '  No prior data'}

Expenses by category:
${ctx.expensesByCategory.map(e => `  ${e.category}: $${e.amount.toLocaleString()}`).join('\n')}

Top expense vendors:
${ctx.topExpenses.slice(0, 8).map(e => `  ${e.vendor} (${e.account}): $${e.amount.toLocaleString()}`).join('\n')}

MRR by client (monthly accrual — reflects active contracts, NOT when cash was received):
${ctx.mrrByClient.map(c => `  ${c.client}: $${c.amount.toLocaleString()}/mo`).join('\n')}

Answer in 3–5 sentences. Lead with a clear yes/no or direct finding. Use specific dollar amounts. NEVER assume cash ran out just because $0 was received in a month — always use the cash balance figure provided above as the ground truth for how much money is in the bank.`
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
