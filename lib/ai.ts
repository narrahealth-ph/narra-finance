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
  totalRevenue:      number
  cashRevenue:       number
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
  // Investment utilization
  investmentRounds:  { round: string; rene: number; mike: number; total: number }[]
  totalInvestment:   number
  // Financial history table (oldest → newest, last entry = current period)
  financialHistory:  { month: string; arr: number; costs: number; netRevenue: number; margin: number }[]
}) {
  const month = data.period   // e.g. "September 2025"

  // ── Investment utilization table ────────────────────────────────────────────
  const invRowsStr = data.investmentRounds.map(r =>
    `${r.round.padEnd(12)} | $${r.rene.toLocaleString().padStart(10)} | $${r.mike.toLocaleString().padStart(10)} | $${r.total.toLocaleString().padStart(10)} | $0`
  ).join('\n')
  const invTotalStr =
    `${'Total'.padEnd(12)} | $${data.investmentRounds.reduce((s, r) => s + r.rene, 0).toLocaleString().padStart(10)} | $${data.investmentRounds.reduce((s, r) => s + r.mike, 0).toLocaleString().padStart(10)} | $${data.totalInvestment.toLocaleString().padStart(10)} | $0`

  // ── Financial history table ──────────────────────────────────────────────────
  const histHeaderStr = `${'Month'.padEnd(12)} | ${'Total ARR'.padStart(10)} | ${'Costs (ARC)'.padStart(12)} | ${'Net Revenue'.padStart(12)} | Margin`
  const histRowsStr = data.financialHistory.map(h => {
    const marginStr = h.arr > 0 ? `${Math.round(h.margin)}%` : 'N/A'
    return `${h.month.padEnd(12)} | $${h.arr.toLocaleString().padStart(9)} | $${h.costs.toLocaleString().padStart(11)} | $${h.netRevenue.toLocaleString().padStart(11)} | ${marginStr}`
  }).join('\n')
  const histRange = data.financialHistory.length >= 2
    ? `${data.financialHistory[0].month} – ${data.financialHistory[data.financialHistory.length - 1].month}`
    : month

  // ── Pipeline / pending ───────────────────────────────────────────────────────
  const pipelineTotal = data.pipelineDeals.reduce((s, d) => s + d.amount, 0)
  const pipelineStr = data.pipelineDeals.length > 0
    ? data.pipelineDeals.map(d => `${d.clientName} ($${d.amount.toLocaleString()} ${d.billingType}${d.notes ? ', ' + d.notes : ''})`).join('; ')
    : 'None currently'

  const pendingStr = data.pendingCollection.length > 0
    ? data.pendingCollection.map(i => `${i.clientName} ($${i.amount.toLocaleString()}, ${i.daysOutstanding}d outstanding)`).join('; ')
    : 'None'

  const newClientsStr = data.newClients.length > 0
    ? data.newClients.map(c => `${c.name} ($${c.amount.toLocaleString()}/mo)`).join(', ')
    : 'none'

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1800,
    messages: [{
      role:    'user',
      content: `You are Karina Garcia, CEO of Narra Health PTE. LTD., writing the monthly investor update email for ${month}.

Produce the COMPLETE email body below, following this EXACT structure and format. Do not add extra sections or change the order.

---

Subject: Investment Update Narra Health – ${month}

Dear Rene and Mike,

[Write a 2–3 sentence intro paragraph: highlight the month's headline metric (MRR = $${data.mrr.toLocaleString()}), any new clients (${newClientsStr}), and overall momentum. Tone: warm, direct, CEO voice.]

INVESTMENT UTILIZATION
──────────────────────────────────────────────────────────────────
Round        | Contributed (Rene) | Contributed (Mike) | Total
──────────────────────────────────────────────────────────────────
${invRowsStr}
──────────────────────────────────────────────────────────────────
${invTotalStr}

FINANCIAL OVERVIEW: ${histRange}
──────────────────────────────────────────────────────────────────
${histHeaderStr}
──────────────────────────────────────────────────────────────────
${histRowsStr}

Key Financial Movements:
• Revenue: [one sentence on MRR trend and what drove it — use data above]
• Costs: [one sentence on operating expenses trend — use data above]
• Efficiency: [one sentence on net revenue and operating margin trend — use data above]

WHAT'S NEXT?
1. [Most important strategic or sales priority — name specific pipeline deals if any: ${pipelineStr}]
2. [Second priority — pending collections follow-up if any: ${pendingStr}]
3. [Product or operational milestone]
4. [Team or hiring update, or another business priority]
5. [Investor relations or financial milestone, e.g. closing next round, reaching break-even, etc.]

[Write 1–2 closing sentences expressing gratitude and commitment. Warm but professional.]

Ingat,
Karina Garcia
Chief Executive Officer, Narra Health

---

RULES:
- Copy the tables EXACTLY as shown above (including the separator lines) — only fill in the bracketed placeholders.
- Do NOT add markdown, asterisks, or extra formatting.
- The Key Financial Movements bullets must each be exactly one sentence.
- The WHAT'S NEXT items must each be one sentence.
- Use specific dollar amounts and client names from the data provided.
- Do not include the "Subject:" line in the body — start with "Dear Rene and Mike,".

CONTEXT:
- Billing model: annual contracts, clients pay full year upfront. $0 cash months are NORMAL.
- Cash balance: $${data.cashBalance.toLocaleString()} | Runway: ${data.runway} months
- Active clients: ${data.topClients.map(c => `${c.name} ($${c.amount.toLocaleString()}/mo)`).join(', ')}
- Cash received this month: $${data.cashRevenue.toLocaleString()}
- Operating expenses this month: $${data.totalExpenses.toLocaleString()}
${data.billingNote ? data.billingNote : ''}`
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
  // Live Google Sheet data
  sheetClients?:       { name: string; annualAmount: number; monthlyMrr: number; billingType: string; status: string }[]
  sheetMrr?:           number
  totalInvoicedSheet?: number
  totalPipelineSheet?: number
},
conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
) {
  const expensesLine = ctx.expensesByCategory.length > 0
    ? ctx.expensesByCategory.map(e => `  ${e.category}: $${e.amount.toLocaleString()}`).join('\n')
    : `  No expense breakdown for selected month. Avg monthly burn across recent months: $${Math.round(ctx.avgMonthlyBurn).toLocaleString()}`

  // Financial context lives in the system prompt so it persists across all turns
  const systemPrompt = `You are the CFO of Narra Health PTE. LTD., a B2B SaaS health platform based in Singapore.
Answer questions using the financial data below. Be direct, specific, and use actual numbers. Keep replies concise (3–5 sentences). You are in a conversation — you can reference earlier questions and answers.

CRITICAL BILLING MODEL:
- Clients are on ANNUAL contracts with AUTOMATIC RENEWAL. They pay the full year upfront.
- $0 cash received in a month is normal — cash sits in the bank from prior upfront payments.
- Cash balance ($${ctx.cashBalance.toLocaleString()}) = all cash ever received minus all expenses. Ground truth.
- MRR ($${ctx.totalMrr.toLocaleString()}/mo) = accrual revenue earned monthly from active contracts.
- Avg monthly burn: $${Math.round(ctx.avgMonthlyBurn).toLocaleString()}/mo — use for hypothetical cost questions.
${ctx.mrrPeriodNote ? ctx.mrrPeriodNote + '\n' : ''}${ctx.billingNote ? ctx.billingNote + '\n' : ''}
FINANCIAL DATA (period: ${ctx.period}):
- MRR: $${ctx.totalMrr.toLocaleString()}/mo
- Cash received this period: $${ctx.cashRevenue.toLocaleString()}
- Expenses this period: $${ctx.totalExpenses.toLocaleString()}
- Avg monthly burn: $${Math.round(ctx.avgMonthlyBurn).toLocaleString()}/mo
- Cash balance: $${ctx.cashBalance.toLocaleString()}
- Runway: ${ctx.runway} months

Recent cash received:
${ctx.prevRevenue.map(r => `  ${r.label}: $${r.revenue.toLocaleString()}`).join('\n') || '  No prior data'}

Expenses by category:
${expensesLine}

Top vendors:
${ctx.topExpenses.slice(0, 8).map(e => `  ${e.vendor} (${e.account}): $${e.amount.toLocaleString()}`).join('\n') || '  No expense detail'}

Active clients — LIVE from invoice tracker:
${ctx.sheetClients && ctx.sheetClients.length > 0
  ? ctx.sheetClients.map(c => `  ${c.name} | ${c.billingType} | $${c.annualAmount.toLocaleString()}/yr ($${Math.round(c.monthlyMrr).toLocaleString()}/mo) | ${c.status}`).join('\n')
  : ctx.mrrByClient.map(c => `  ${c.client}: $${c.amount.toLocaleString()}/mo`).join('\n') || '  No client data'}
${ctx.sheetMrr != null ? `Live MRR total: $${Math.round(ctx.sheetMrr).toLocaleString()}/mo` : ''}
${ctx.totalInvoicedSheet != null ? `Total invoiced (Paid + Partial/Pending): $${ctx.totalInvoicedSheet.toLocaleString()}` : ''}
${ctx.totalPipelineSheet != null ? `Total + pipeline (incl. Sales-Sent): $${ctx.totalPipelineSheet.toLocaleString()}` : ''}

Contract renewals:
${ctx.contractSchedule.length > 0
  ? ctx.contractSchedule.map(c => `  ${c.client} (${c.billingType}): ends ${c.contractEnd}${c.renewingSoon ? ' ⚠ SOON' : ''}`).join('\n')
  : '  None recorded'}`

  // Build messages: prior turns + new question
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...conversationHistory,
    { role: 'user', content: question },
  ]

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 600,
    system:     systemPrompt,
    messages,
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
