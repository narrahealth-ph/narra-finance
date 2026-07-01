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
  totalRevenue:        number
  cashRevenue:         number
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
  avgMonthlyBurn:      number
  mrrPeriodNote:       string
  contractSchedule:    { client: string; billingType: string; contractEnd: string | null; daysUntilRenewal: number | null; renewingSoon: boolean }[]
}) {
  const expensesLine = ctx.expensesByCategory.length > 0
    ? ctx.expensesByCategory.map(e => `  ${e.category}: $${e.amount.toLocaleString()}`).join('\n')
    : `  No expense breakdown for selected month. Avg monthly burn across recent months: $${Math.round(ctx.avgMonthlyBurn).toLocaleString()}`

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 800,
    messages: [{
      role:    'user',
      content: `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Answer the following question using the financial data below. Be direct, specific, and use actual numbers.

CRITICAL BILLING MODEL — READ CAREFULLY:
- Narra Health clients are on ANNUAL contracts with AUTOMATIC RENEWAL. They pay once per year upfront.
- When a client pays $X annually, the FULL $X lands in the bank that one month. In all other months, $0 cash is received — but the cash is STILL IN THE BANK accumulating from all upfront payments.
- $0 cash received in a month does NOT mean revenue disappeared or the business has no income. Contracts auto-renew; clients are still active.
- The current cash balance ($${ctx.cashBalance.toLocaleString()}) already accounts for ALL cash ever received minus ALL expenses ever paid. This is the ground truth — do not re-derive it.
- MRR ($${ctx.totalMrr.toLocaleString()}/mo) is the accrual revenue earned monthly from active contracts.
- Average monthly operating expenses (from recent months): $${Math.round(ctx.avgMonthlyBurn).toLocaleString()}/mo — use this as the baseline for hypothetical expense calculations, not the selected month's figure which may be $0 if statements aren't imported yet.
${ctx.mrrPeriodNote ? '\n' + ctx.mrrPeriodNote + '\n' : ''}${ctx.billingNote ? '\n' + ctx.billingNote + '\n' : ''}
QUESTION: ${question}

FINANCIAL DATA (viewing period: ${ctx.period}):
- Monthly Recurring Revenue (MRR, accrual): $${ctx.totalMrr.toLocaleString()}/mo
- Cash received from clients this period: $${ctx.cashRevenue.toLocaleString()} (may be $0 under annual billing — normal)
- Operating expenses this period: $${ctx.totalExpenses.toLocaleString()}
- Average monthly burn (recent months): $${Math.round(ctx.avgMonthlyBurn).toLocaleString()}/mo
- CURRENT CASH BALANCE (actual bank position, all time): $${ctx.cashBalance.toLocaleString()}
- Cash runway at avg burn: ${ctx.runway} months

When clients paid (recent months — annual upfront payments):
${ctx.prevRevenue.map(r => `  ${r.label}: $${r.revenue.toLocaleString()}`).join('\n') || '  No prior cash data'}

Expenses by category (this period):
${expensesLine}

Top expense vendors:
${ctx.topExpenses.slice(0, 8).map(e => `  ${e.vendor} (${e.account}): $${e.amount.toLocaleString()}`).join('\n') || '  No expense detail for this period'}

Active clients and MRR (annual auto-renewing contracts):
${ctx.mrrByClient.map(c => `  ${c.client}: $${c.amount.toLocaleString()}/mo`).join('\n') || '  See most recent closed month above'}

Contract renewal schedule (upcoming cash inflows from auto-renewals):
${ctx.contractSchedule.length > 0
  ? ctx.contractSchedule.map(c => `  ${c.client} (${c.billingType}): contract ends ${c.contractEnd}${c.daysUntilRenewal !== null ? ` — ${c.daysUntilRenewal <= 0 ? 'up for renewal now' : `renews in ${c.daysUntilRenewal} days`}` : ''}${c.renewingSoon ? ' ⚠ RENEWING SOON' : ''}`).join('\n')
  : '  No contract end dates recorded yet — add them in Client Registry'}
When a client renews their annual contract, that full annual payment lands in the bank as a lump sum. Factor this into any cash flow projections.

Answer in 3–5 sentences. Lead with a clear yes/no or direct finding. Use specific dollar amounts. For hypothetical questions about new costs, use the avg monthly burn ($${Math.round(ctx.avgMonthlyBurn).toLocaleString()}/mo) as the baseline, not $0. NEVER assume the business has no revenue or no clients based on a single month's data.`
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
