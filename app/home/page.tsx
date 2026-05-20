'use client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

const SECTIONS = [
  {
    icon: '📈',
    title: 'MRR',
    color: 'bg-narra-green/20 border-narra-green/40',
    iconBg: 'bg-narra-green/30',
    steps: [
      'Select the month and year at the top of the screen.',
      'Click "↻ Refresh from Sheet" to pull the latest outgoing invoices from your Google Sheet tracker.',
      'Toggle between Monthly view and Full Year view to see either a single month\'s MRR or a full annual breakdown.',
      'The KPI boxes show Accrual MRR, Total Invoiced (cash value of invoices issued), Cash Received (from bank imports), Total Costs, Net, and running Cash Position.',
      'The client table below lists every active invoice, its billing type, amount, and whether it was distributed through a third party.',
    ],
  },
  {
    icon: '🏢',
    title: 'Clients',
    color: 'bg-blue-50 border-blue-200',
    iconBg: 'bg-blue-100',
    steps: [
      'Manage your client roster here — add, edit, or deactivate clients.',
      'Client records link to invoices across all months so you have a full history.',
    ],
  },
  {
    icon: '⚖️',
    title: 'Reconciliation',
    color: 'bg-amber-50 border-amber-200',
    iconBg: 'bg-amber-100',
    steps: [
      'After uploading bank statements, go here to review auto-matched pairs.',
      'Proposed matches (medium confidence) require your approval — click "✓ Approve" or "✕ Decline" on each one.',
      'Unmatched transactions can be linked manually, split across multiple invoices, or acknowledged as verified.',
      'Use "⊕ Split" on a bulk distributor payment to break it into individual client lines — type an Invoice ID to auto-fill the client name and amount.',
      'Click "↻ Run Auto-Match" after uploading new invoices or bank data to re-run matching.',
    ],
  },
  {
    icon: '📄',
    title: 'Invoices',
    color: 'bg-purple-50 border-purple-200',
    iconBg: 'bg-purple-100',
    steps: [
      'Syncs your incoming (expense) invoices from Google Drive.',
      'Click "Sync from Drive" to pull the latest invoices for the selected month.',
      'Each invoice can be tagged with an account code (e.g. 411 - Professional Fees) for cost categorisation.',
      'Invoices are automatically matched against bank transactions during reconciliation.',
    ],
  },
  {
    icon: '🏦',
    title: 'Bank Import',
    color: 'bg-green-50 border-green-200',
    iconBg: 'bg-green-100',
    steps: [
      'Upload your bank statements here — drag and drop or click to browse.',
      'Supports CSV and PDF. PDFs are read by AI (Claude) to extract transactions automatically.',
      'Multiple files can be uploaded at once (e.g. one per bank account).',
      'Review the extracted transactions before saving — you can edit dates, descriptions, amounts, and type (revenue / expense / transfer / FX).',
      'The month coverage grid at the top shows which months already have statements uploaded for the selected year.',
      'After saving, auto-matching runs immediately against your invoices.',
    ],
  },
  {
    icon: '📊',
    title: 'Reports',
    color: 'bg-narra-light border-narra-border',
    iconBg: 'bg-narra-green/20',
    steps: [
      'View a full P&L summary for the selected month — revenue, costs broken down by account code, and net.',
      'Export to CSV for use in your accounting software or board reports.',
      'Data is pulled from reconciled bank transactions and synced invoices.',
    ],
  },
  {
    icon: '✏️',
    title: 'Adjustments',
    color: 'bg-orange-50 border-orange-200',
    iconBg: 'bg-orange-100',
    steps: [
      'Add manual journal entries for items not captured in bank imports — accruals, prepayments, corrections.',
      'Each entry has a date, description, amount, and account code.',
      'Manual entries feed into the Reports P&L alongside bank-sourced costs.',
    ],
  },
  {
    icon: '✨',
    title: 'AI Insights',
    color: 'bg-violet-50 border-violet-200',
    iconBg: 'bg-violet-100',
    steps: [
      'After reconciliation is complete, click "Generate Insights" for an AI-written summary of the month.',
      'Highlights revenue trends, cost anomalies, and cash flow observations based on your actual data.',
      'Insights are cached per month — regenerate anytime to refresh the analysis.',
    ],
  },
]

const WORKFLOW = [
  { step: '1', label: 'Select month', detail: 'Choose month + year in the header' },
  { step: '2', label: 'Refresh MRR', detail: 'Pull latest outgoing invoices from Sheet' },
  { step: '3', label: 'Import bank', detail: 'Upload bank statement CSVs or PDFs' },
  { step: '4', label: 'Sync invoices', detail: 'Pull expense invoices from Drive' },
  { step: '5', label: 'Reconcile', detail: 'Review & approve matched pairs' },
  { step: '6', label: 'Adjust', detail: 'Add any manual journal entries' },
  { step: '7', label: 'Close month', detail: 'Run the Close Month wizard to lock the period' },
]

export default function HomePage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-narra-surface">

      {/* Header */}
      <header className="bg-narra-dark text-white px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Image src="/narra-logo.png" alt="Narra Health" width={100} height={36} className="object-contain" priority />
          <span className="text-white/30 text-sm font-light border-l border-white/10 pl-3">finance</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/finance')}
            className="text-narra-green text-sm font-body px-4 py-2 rounded-lg border border-narra-green/30 hover:bg-narra-green/10 transition-all"
          >
            Open Dashboard →
          </button>
          <button
            onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login') }}
            className="text-white/40 hover:text-white text-xs transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-14">

        {/* Hero */}
        <div className="text-center space-y-4">
          <h1 className="font-heading text-4xl font-semibold text-narra-dark">
            Narra Finance Dashboard
          </h1>
          <p className="text-narra-muted text-lg max-w-2xl mx-auto">
            Your end-to-end financial close platform — from bank imports to MRR reporting.
            Here's how everything works.
          </p>
          <button
            onClick={() => router.push('/finance')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-narra-dark text-narra-green rounded-xl font-body text-sm hover:bg-narra-mid transition-all"
          >
            Go to Dashboard →
          </button>
        </div>

        {/* Monthly workflow */}
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark mb-6">Monthly Close Workflow</h2>
          <div className="relative">
            {/* connector line */}
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
          <h2 className="font-heading text-xl font-semibold text-narra-dark mb-6">Dashboard Tabs — What Each One Does</h2>
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
                        <li key={i} className="flex items-start gap-2 text-sm text-narra-ink">
                          <span className="text-narra-muted shrink-0 mt-0.5">·</span>
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
              { icon: '📅', text: 'Annual invoices count for 12 months, quarterly for 3 months, monthly for 1 month. Once the term ends, the invoice no longer appears in MRR.' },
              { icon: '↻', text: 'After editing the Google Sheet invoice tracker, click "Refresh from Sheet" in the MRR tab to pull in the changes immediately.' },
              { icon: '📊', text: '2025 revenue is calculated from the outgoing invoice tracker. 2025 costs come from the MRR sheet. 2026 onwards: both come from data entered through the monthly close workflow.' },
            ].map((tip, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-xl shrink-0">{tip.icon}</span>
                <span className="leading-relaxed">{tip.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center pb-4">
          <button
            onClick={() => router.push('/finance')}
            className="px-8 py-3 bg-narra-green text-narra-dark font-heading font-semibold rounded-xl hover:bg-narra-light transition-all"
          >
            Open Dashboard →
          </button>
        </div>

      </div>
    </div>
  )
}
