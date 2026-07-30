'use client'

const SECTIONS = [
  {
    icon: '🏢',
    title: 'Business Overview',
    color: 'bg-blue-50 border-blue-200',
    iconBg: 'bg-blue-100',
    steps: [
      'A live summary of the business built from real bank data and your invoice tracker — no manual input needed.',
      'A banner at the top warns you if bank statements are missing for recent months.',
      'The three summary pills show: Total Raised (Rene + Mike totals pulled directly from the Google Sheet investments tab), Total Revenue Earned (all cash received since inception), and What Was Built (active client count from the client registry + current month accrual MRR).',
      'KPI cards — hover the ? icon on each for a plain-English explanation:',
      '→ Avg Monthly Revenue: Average accrual MRR across the last 3 months from the invoice tracker (not cash basis — this reflects contracted revenue, smoothed for annual/quarterly billing cycles).',
      '→ Avg Monthly Spend: Average operating expenses over the last 3 months from bank data.',
      '→ Cash Position: Total money remaining across all bank accounts (opening balance + revenue + investment − expenses − capex).',
      '→ Runway: How many months the company can operate at current spend rate (cash in bank ÷ avg monthly spend).',
      'Charts show Revenue vs Spend and MRR growth over the last 18 months.',
      'Paying Clients section shows each client\'s share of this month\'s accrual MRR with percentage breakdown.',
    ],
  },
  {
    icon: '📈',
    title: 'Revenue',
    color: 'bg-narra-green/20 border-narra-green/40',
    iconBg: 'bg-narra-green/30',
    steps: [
      'Select the month and year at the top of the screen.',
      'Click "↻ Refresh from Sheet" to pull the latest outgoing invoices from your Google Sheet tracker.',
      'The top card row shows the full-year P&L summary (pulled from bank data): Total Revenue, Operating Expenses, Product Capex, Net Profit, Operating Margin, Opening Cash, Closing Cash, Total Invoiced (from sheet), and Cash Received (from bank). Click Total Revenue or Cash Received to drill into a breakdown.',
      'Below the cards, the monthly MRR chart shows Confirmed MRR vs Costs over time.',
      'Sub-tabs inside Revenue:',
      '→ Outgoing (Revenue): All active client contracts for the month. Shows invoice #, client name, distributor, billing type, amount, monthly MRR, and payment status. Click ✎ to rename how a client appears.',
      '→ Incoming (Expenses): Vendor invoices synced from Google Drive with account codes and match status.',
      '→ Pending Collection: Outstanding invoices with aging (color-coded by days overdue). Export to CSV.',
      '→ Sales Pipeline: Deals not yet contracted — shows potential ARR, potential MRR, and deal details. Export to CSV.',
      'Annual invoices are spread across 12 months, quarterly across 3 — MRR is the smoothed monthly equivalent, not the invoice face value.',
    ],
  },
  {
    icon: '💵',
    title: 'Profit & Loss',
    color: 'bg-emerald-50 border-emerald-200',
    iconBg: 'bg-emerald-100',
    steps: [
      'Shows the full-year cash-basis P&L using actual bank statement data.',
      'Seven KPI cards at the top:',
      '→ Total Revenue (dark, clickable): All client payments received in bank this year. Tap to see a full transaction breakdown.',
      '→ Operating Expenses (dark, clickable): Day-to-day running costs — salaries, software, marketing. Tap to see a grouped breakdown by description.',
      '→ Product Capex (amber): Money spent building the product (e.g. developer costs). Funded by investors — excluded from operating margin.',
      '→ Net Profit: Revenue minus operating expenses only. Capex is not deducted here.',
      '→ Operating Margin: Net profit ÷ revenue. 40%+ is healthy for a SaaS business.',
      '→ Opening Cash: Money in bank at the start of the year, carried forward from prior years.',
      '→ Closing Cash: Opening cash + revenue + investment − operating expenses − capex.',
      'Month status pills show which months are closed (✓) and which are still open (○).',
      'The bar chart shows monthly revenue vs expenses side by side.',
      'The monthly breakdown table shows Revenue, Operating Expenses, Capex, Net, Opening/Closing Cash, and MoM growth % for each month.',
      'Lock Year button closes all months at once — use at year-end.',
      'Export P&L CSV or Expenses CSV for your accountant.',
    ],
  },
  {
    icon: '📄',
    title: 'Invoices',
    color: 'bg-purple-50 border-purple-200',
    iconBg: 'bg-purple-100',
    steps: [
      'Syncs incoming (expense) invoices from Google Drive for the selected month.',
      'The app reads from: Incoming Invoices & Receipts / [Month_Year] in your Drive.',
      'Click "Sync from Drive" to load all files. Click "✨ AI Extract All" to extract all at once.',
      'Each file shows its status: ○ pending, ⟳ extracting, ✓ done, ✗ error, = already saved.',
      'AI extracts vendor, date, amount, and account code automatically. Confidence is shown as high / medium / low.',
      'Click any field (vendor, date, amount) to edit inline before saving.',
      'Use ↻ to re-run AI extraction on any file that failed or needs updating.',
      'If the Drive folder is not found, check that the folder name matches the month and year exactly.',
    ],
  },
  {
    icon: '🏦',
    title: 'Bank Import',
    color: 'bg-green-50 border-green-200',
    iconBg: 'bg-green-100',
    steps: [
      'Upload bank statements by dragging and dropping files or clicking to browse. Supports CSV, PDF, PNG, and JPG.',
      'PayPal exports are automatically detected and parsed with their own column mapping.',
      'PDFs and images are processed by AI (Claude) — transactions are extracted automatically, no manual entry needed.',
      'Upload multiple files at once (e.g. one per bank account). Each file shows a status icon: processing, done, or error.',
      'The month coverage grid at the top shows which months already have bank data for the selected year.',
      'Before saving, review the extracted transactions in the preview table. You can edit date, description, amount, currency, and type (expense / revenue / capex / transfer / FX).',
      'Remove individual rows from the preview using the delete button before saving.',
      'After saving, auto-matching runs immediately against your invoices.',
      'Previously saved transactions are shown below with revenue and expense totals. Delete duplicates if needed.',
    ],
  },
  {
    icon: '⚖️',
    title: 'Reconciliation',
    color: 'bg-amber-50 border-amber-200',
    iconBg: 'bg-amber-100',
    steps: [
      'Matches bank transactions against invoices. KPIs show Revenue, Total Costs, Net, and Invoice Match %.',
      'Click "↻ Run Auto-Match" after uploading new invoices or bank data to re-run the matching algorithm.',
      'Sub-tabs inside Reconciliation:',
      '→ Costs Breakdown: Expenses grouped by account code (411, 417, 426, etc.). Expand each group to see individual transactions. Change account codes using the dropdown. Delete duplicate transactions with the ✕ button.',
      '→ Matches: Proposed matches need your approval — review the side-by-side comparison and click Approve or Decline. Confirmed matches are shown below; use ✕ to unmatch if needed.',
      '→ Unmatched: Transactions with no match yet. For revenue: assign a client and invoice ID. For expenses: match to an invoice, split across multiple invoices, or acknowledge with "I see it".',
      'Split feature (⊕): Use this for bulk payments that cover multiple clients (e.g. Lawina covering multiple companies). Enter each Invoice ID to auto-fill client name and amount. A running balance shows whether the split totals correctly.',
      '"I see it all" acknowledges multiple unmatched expenses at once when no invoice exists.',
      'Export Costs CSV downloads the full expense breakdown by account code.',
    ],
  },
  {
    icon: '📊',
    title: 'Reports',
    color: 'bg-narra-light border-narra-border',
    iconBg: 'bg-narra-green/20',
    steps: [
      'Toggle between Monthly and Annual view using the buttons at the top right.',
      'Monthly view shows three statements: P&L, Balance Sheet, and General Ledger.',
      '→ P&L: Revenue and operating expenses grouped by account code, with net profit at the bottom.',
      '→ Balance Sheet: Assets, liabilities, and equity with a balance check indicator (✓ balanced or ⚠ out of balance).',
      '→ General Ledger: All transactions by account with running balances.',
      'Annual view: Shows the full-year P&L, year-end balance sheet (from December), and all bank transactions as a GL.',
      'Export buttons: GL CSV, BS CSV, P&L CSV, or Export All at once.',
    ],
  },
  {
    icon: '✨',
    title: 'AI Insights',
    color: 'bg-violet-50 border-violet-200',
    iconBg: 'bg-violet-100',
    steps: [
      'Toggle between "This Period" (single month) and "Annual" (full calendar year) using the buttons at the top right.',
      'Summary cards show Revenue, Expenses, Net, and Runway for the selected view.',
      'Ask a Financial Question: Type any question about your finances (e.g. "Can we afford a $5k/month marketing campaign?"). Press Enter or click Ask. Claude answers using your real financial data.',
      '→ Investor Narrative (✨ Generate): A written summary of the month\'s or year\'s performance for investor updates. Copy to clipboard when done.',
      '→ Anomaly Detection (✨ Analyze): Flags unusual expenses or overspend. Each anomaly shows severity (high/medium/low), type, amount, and description.',
      '→ Client Churn Risk (✨ Assess): Identifies clients at risk of churning based on payment patterns. Shows risk level, reason, and recommended action.',
      'Works best after reconciliation is complete and bank data is up to date.',
    ],
  },
  {
    icon: '🏢',
    title: 'Clients',
    color: 'bg-slate-50 border-slate-200',
    iconBg: 'bg-slate-100',
    steps: [
      'Add, edit, or deactivate clients from the client registry.',
      'Each client has a name, holding company, distributor/payer, billing type (annual/quarterly/monthly/one-off), and notes.',
      'Use the search bar to filter by client name or distributor. Filter by active, inactive, or all.',
      'Click the status button next to a client to mark them as active or churned.',
      'Select multiple clients using checkboxes and bulk-assign them to a holding company.',
      'Holding companies group related clients together — create and manage them in the collapsible section at the bottom.',
      'The header shows total active clients, inactive clients, and total lifetime value (LTV) across all clients.',
    ],
  },
  {
    icon: '✏️',
    title: 'Adjustments',
    color: 'bg-orange-50 border-orange-200',
    iconBg: 'bg-orange-100',
    steps: [
      'Add manual balance sheet entries for items not captured in bank imports.',
      'Prepayments (610): Add service schedules (name, total paid, start date, months). The app automatically amortizes them monthly onto the balance sheet.',
      'Non-current Assets: Enter fixed assets and intangible assets (capitalized software development costs).',
      'Director Current Accounts (835, 840, 842): Enter amounts the company owes to founders. Use "Convert to Equity" to move these amounts to Share Capital (900).',
      'Other Liabilities: Enter income tax payable, GST payable, loans (851), and founder investments (852, 853).',
      'Equity: Share Capital (900) is editable. Retained Earnings (920) is read-only and auto-calculated from cumulative net P&L.',
      'Click Save on each field individually after editing.',
    ],
  },
]

const WORKFLOW = [
  { step: '1', label: 'Select month',    detail: 'Choose month + year in the header' },
  { step: '2', label: 'Import bank',     detail: 'Upload bank statement CSVs or PDFs' },
  { step: '3', label: 'Sync Revenue',    detail: 'Pull latest outgoing invoices from Sheet' },
  { step: '4', label: 'Sync Invoices',   detail: 'Pull expense invoices from Drive' },
  { step: '5', label: 'Reconcile',       detail: 'Review & approve matched pairs' },
  { step: '6', label: 'Adjust',          detail: 'Add manual balance sheet entries' },
  { step: '7', label: 'Close month',     detail: 'Run the Close Month wizard to lock the period' },
]

export default function InstructionsPanel() {
  return (
    <div className="max-w-4xl mx-auto space-y-12 py-4">

      {/* Monthly workflow */}
      <div>
        <h2 className="font-heading text-xl font-semibold text-narra-dark mb-2">Monthly Close Workflow</h2>
        <p className="text-narra-muted text-sm mb-6">Follow these steps left to right each month to close the books.</p>
        <div className="relative">
          <div className="absolute top-6 left-6 right-6 h-0.5 bg-narra-border hidden md:block" />
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3 relative">
            {WORKFLOW.map(w => (
              <div key={w.step} className="flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-narra-dark text-narra-green font-heading font-semibold text-sm flex items-center justify-center z-10 shrink-0">
                  {w.step}
                </div>
                <div>
                  <div className="text-sm font-medium text-narra-dark font-heading">{w.label}</div>
                  <div className="text-xs text-narra-muted mt-0.5 leading-tight">{w.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tab instructions */}
      <div>
        <h2 className="font-heading text-xl font-semibold text-narra-dark mb-2">What Each Tab Does</h2>
        <p className="text-narra-muted text-sm mb-6">Tabs are ordered to match the close workflow — go left to right.</p>
        <div className="space-y-4">
          {SECTIONS.map(s => (
            <div key={s.title} className={`border rounded-xl overflow-hidden ${s.color}`}>
              <div className="px-5 py-4 flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg ${s.iconBg} flex items-center justify-center text-xl shrink-0`}>
                  {s.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-heading font-semibold text-narra-dark text-base mb-3">{s.title}</h3>
                  <ul className="space-y-1.5">
                    {s.steps.map((step, i) => (
                      <li key={i} className={`flex items-start gap-2 text-sm ${step.startsWith('→') ? 'text-narra-dark ml-3' : 'text-narra-ink'}`}>
                        {!step.startsWith('→') && <span className="text-narra-muted shrink-0 mt-0.5">·</span>}
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div className="bg-narra-dark text-white rounded-2xl p-8">
        <h2 className="font-heading text-lg font-semibold text-narra-green mb-5">Tips & Notes</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-white/80">
          {[
            { icon: '🔒', text: 'Locked periods cannot be edited. Use the unlock option in the Close Month wizard if you need to make corrections.' },
            { icon: '🗑️', text: 'Use "Clear ▾" in the header to erase specific data types (bank, invoices, MRR, etc.) for the selected month without wiping everything.' },
            { icon: '⊕', text: 'Bulk distributor payments (e.g. Lawina covering multiple clients) should be split in Reconciliation → Unmatched using the Split feature. Enter each Invoice ID to auto-fill client and amount.' },
            { icon: '📅', text: 'Annual invoices count for 12 months, quarterly for 3, monthly for 1. Once the term ends, the invoice no longer appears in MRR.' },
            { icon: '↻', text: 'After editing the Google Sheet invoice tracker, click "Refresh from Sheet" in the Revenue tab to pull in the changes immediately.' },
            { icon: '🧙', text: 'The "Close Month" button in the header opens a wizard that tracks all 8 close steps automatically — steps 1–6 track themselves, steps 7–8 you tick manually.' },
            { icon: '💼', text: 'Capex (product build spend) is kept separate from operating expenses throughout the app. It affects cash position but not operating margin — it\'s investor-funded and shouldn\'t penalise your P&L.' },
            { icon: '📊', text: 'The Profit & Loss tab is for reviewing a full year using bank data. The Reports tab is for reviewing a single month with full Balance Sheet and General Ledger.' },
          ].map((tip, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-xl shrink-0">{tip.icon}</span>
              <span className="leading-relaxed">{tip.text}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
