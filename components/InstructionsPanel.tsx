'use client'

const SECTIONS = [
  {
    icon: '🏢',
    title: 'Clients',
    color: 'bg-blue-50 border-blue-200',
    iconBg: 'bg-blue-100',
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
      'Before saving, review the extracted transactions in the preview table. You can edit date, description, amount, currency, and type (expense / revenue / transfer / FX).',
      'Remove individual rows from the preview using the delete button before saving.',
      'After saving, auto-matching runs immediately against your invoices.',
      'Previously saved transactions are shown below with revenue and expense totals. Delete duplicates if needed.',
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
      'Click "Sync Revenue to Period" to lock active client MRR into the current period\'s P&L.',
      'Toggle between Monthly and Full Year view to see either a single month or full annual breakdown.',
      'KPI tiles show: Confirmed MRR, Pending MRR, Net Revenue, Cash Runway, Total LTV, and Churn count.',
      'The MRR chart shows Confirmed MRR, Expected MRR, and Costs over time. Toggle between All Time and 2025 only.',
      'Sub-tabs inside Revenue:',
      '→ Outgoing (Revenue): All active client contracts. Shows invoice #, client name, distributor, billing type, amount, monthly MRR, and payment status. New and carried-over invoices are badged. Click ✎ to rename how a client appears.',
      '→ Incoming (Expenses): Vendor invoices synced from Google Drive with account codes and match status.',
      '→ Pending Collection: Outstanding invoices with aging (color-coded by days overdue). Export to CSV.',
      '→ Sales Pipeline: Deals not yet contracted — shows potential ARR, potential MRR, and deal details. Export to CSV.',
      'Click the "Cash Received" KPI to drill into a breakdown of all revenue bank transactions for the year.',
      '(2026 onwards) Use "Push to Sheet" to write the current month\'s data back to the Google Sheet.',
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
      'Split feature (⊕): Use this for bulk payments that cover multiple clients. Enter each Invoice ID to auto-fill the client name and amount. A running balance shows whether the split totals correctly.',
      '"I see it all" acknowledges multiple unmatched expenses at once when no invoice exists.',
      'Export Costs CSV downloads the full expense breakdown by account code.',
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
  {
    icon: '📊',
    title: 'Reports',
    color: 'bg-narra-light border-narra-border',
    iconBg: 'bg-narra-green/20',
    steps: [
      'Toggle between Monthly and Annual view using the buttons at the top right.',
      'Monthly view shows three statements: P&L, Balance Sheet, and General Ledger.',
      '→ P&L: Revenue and expenses grouped by account code, with net profit at the bottom.',
      '→ Balance Sheet: Assets, liabilities, and equity with a balance check indicator (✓ balanced or ⚠ out of balance).',
      '→ General Ledger: All transactions by account with running balances.',
      'Annual view (select the year first): Shows the full-year P&L, year-end balance sheet (from December), and all bank transactions as a GL.',
      'Export buttons: GL CSV, BS CSV, P&L CSV, or Export All at once.',
    ],
  },
  {
    icon: '💵',
    title: 'Cash Flow',
    color: 'bg-emerald-50 border-emerald-200',
    iconBg: 'bg-emerald-100',
    steps: [
      'Shows actual cash in and out of your bank accounts for the full year selected.',
      'KPI cards show Total Revenue, Total Expenses, Net Profit, and Operating Margin % for the year.',
      'Month status pills show which months are closed (✓) and which are still open (○).',
      'The stacked bar chart shows monthly costs (red) and net revenue (green) — the full bar height equals gross revenue.',
      'The monthly breakdown table shows Revenue, Expenses, Net, and Status for each month.',
      'Expense Detail table shows every expense line item with description, bank account, number of transactions, and total.',
      'Lock Year button closes all months for the year at once — use this at year-end.',
      'Export P&L CSV or Expenses CSV for your accountant.',
    ],
  },
  {
    icon: '✨',
    title: 'AI Insights',
    color: 'bg-violet-50 border-violet-200',
    iconBg: 'bg-violet-100',
    steps: [
      'Three AI-powered analyses for the selected month — generate each independently.',
      '→ Investor Narrative (✨ Generate): A written summary of the month\'s performance suitable for investor updates. Copy to clipboard when done.',
      '→ Anomaly Detection (✨ Analyze): Flags unusual expenses or overspend. Each anomaly shows severity (high/medium/low), type, amount, and description.',
      '→ Client Churn Risk (✨ Assess): Identifies clients at risk of churning based on payment patterns. Shows risk level, reason, and recommended action.',
      'Results are cached per month — click the generate button again to refresh the analysis.',
      'Works best after reconciliation is complete so all data is accurate.',
    ],
  },
  {
    icon: '📋',
    title: 'Investor View',
    color: 'bg-slate-50 border-slate-200',
    iconBg: 'bg-slate-100',
    steps: [
      'A live summary of the business built from your actual bank data — no manual input needed.',
      'A banner at the top tells you if bank statements are missing for recent months and prompts you to upload them.',
      'The three summary cards show: Total Raised ($60k from Mike and Rene), Total Revenue Earned (all time from bank), and What Was Built (active clients and MRR).',
      'KPI cards — hover the ? icon on each for a plain-English explanation:',
      '→ Avg Monthly Revenue: Average cash received from clients over the last 3 months of bank data.',
      '→ Annual Run Rate: Avg monthly revenue × 12 (a projection, not actual annual revenue).',
      '→ Avg Monthly Spend: Average expenses over the last 3 months of bank data.',
      '→ Runway: How many months the company can operate before running out of money (cash in bank ÷ monthly spend).',
      'Charts show Revenue vs Spend and MRR growth over the last 18 months.',
      'Paying Clients section shows each client\'s share of this month\'s recurring revenue.',
      'Cash Position shows the total money remaining in all bank accounts (opening balance + all revenue − all expenses).',
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
            { icon: '📊', text: '2025 revenue comes from the outgoing invoice tracker. 2026 onwards: both revenue and costs come from the monthly close workflow.' },
            { icon: '🏦', text: 'The Cash Flow tab is for closing a full year using only bank statements — no invoices needed. Use it at year-end to lock all months and export for your accountant.' },
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
