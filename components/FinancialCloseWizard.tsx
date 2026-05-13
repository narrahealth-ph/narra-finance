'use client'
import { useState } from 'react'

interface Step {
  id: number
  title: string
  description: string
  tab: string
  checkLabel: string
  isDone: boolean
  hasIssue?: boolean
  issueLabel?: string
}

interface Props {
  reportData: any
  selectedMonth: string
  onNavigate: (tab: string) => void
  onClose: () => void
}

export default function FinancialCloseWizard({ reportData, selectedMonth, onNavigate, onClose }: Props) {
  const [activeStep, setActiveStep] = useState<number | null>(null)

  const r = reportData?.reconciliation || {}
  const invoiceCount  = r.totalInvoices  ?? 0
  const bankTxCount   = r.bankTxCount    ?? 0
  const matchedCount  = r.matchedCount   ?? 0
  const proposedCount = r.proposedCount  ?? 0
  const flaggedCount  = r.flaggedMatches?.length ?? 0

  const steps: Step[] = [
    {
      id: 1,
      title: 'Sync Invoices from Drive',
      description: 'Pull all expense invoices and receipts from your Google Drive folder for this month. Claude AI will extract vendor, amount, and account code from each file.',
      tab: 'invoices',
      checkLabel: `${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''} synced`,
      isDone: invoiceCount > 0,
    },
    {
      id: 2,
      title: 'Import Bank Statement',
      description: 'Upload your Sleek multi-currency bank statement (PDF or CSV). Claude AI extracts every transaction. Review the list and delete any duplicates before saving.',
      tab: 'bank',
      checkLabel: `${bankTxCount} transaction${bankTxCount !== 1 ? 's' : ''} imported`,
      isDone: bankTxCount > 0,
    },
    {
      id: 3,
      title: 'Run Reconciliation',
      description: 'Go to the Reconciliation tab. Expand each cost group and delete any duplicates (click ✕). Then use the AI reconcile feature to match bank transactions against invoices.',
      tab: 'reconcile',
      checkLabel: `${matchedCount} matched`,
      isDone: matchedCount > 0,
      hasIssue: proposedCount > 0 || flaggedCount > 0,
      issueLabel: `${proposedCount + flaggedCount} need review`,
    },
    {
      id: 4,
      title: 'Review Proposed Matches',
      description: 'In the Reconciliation → Matches tab, approve or decline each proposed match. Approve confirmed pairs and decline anything that looks wrong.',
      tab: 'reconcile',
      checkLabel: 'All matches reviewed',
      isDone: matchedCount > 0 && proposedCount === 0 && flaggedCount === 0,
      hasIssue: proposedCount > 0 || flaggedCount > 0,
      issueLabel: `${proposedCount + flaggedCount} still pending`,
    },
    {
      id: 5,
      title: 'Check Manual Adjustments',
      description: 'Go to the Adjustments tab and fill in any manual entries: director amounts owed, income tax payable, GST, investments, or any prepayment schedules.',
      tab: 'entries',
      checkLabel: 'Adjustments reviewed',
      isDone: false, // always manual — user marks this themselves
    },
    {
      id: 6,
      title: 'Export Reports',
      description: 'Go to the Reports tab. Review the P&L, Balance Sheet, and General Ledger. Download all three CSVs to send to your accountant.',
      tab: 'reports',
      checkLabel: 'Reports exported',
      isDone: false, // always manual
    },
  ]

  const completedCount = steps.filter(s => s.isDone).length

  function goTo(tab: string) {
    onNavigate(tab)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-narra-dark px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-heading font-semibold text-lg">Monthly Financial Close</h2>
              <p className="text-white/50 text-xs mt-0.5">{selectedMonth.replace('_', ' ')} · {completedCount}/{steps.length} steps complete</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-all flex items-center justify-center text-white/60 hover:text-white text-sm"
            >
              ✕
            </button>
          </div>
          {/* Progress bar */}
          <div className="mt-4 bg-white/10 rounded-full h-1.5">
            <div
              className="bg-narra-green h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="overflow-y-auto flex-1 divide-y divide-narra-border/50">
          {steps.map((step) => {
            const isOpen = activeStep === step.id
            return (
              <div key={step.id} className={`${step.isDone ? 'bg-green-50/30' : ''}`}>
                {/* Step row */}
                <button
                  onClick={() => setActiveStep(isOpen ? null : step.id)}
                  className="w-full px-6 py-4 flex items-center gap-4 hover:bg-narra-surface transition-all text-left"
                >
                  {/* Status icon */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 font-heading font-semibold ${
                    step.isDone
                      ? 'bg-green-100 text-green-700'
                      : step.hasIssue
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-narra-light text-narra-muted'
                  }`}>
                    {step.isDone ? '✓' : step.hasIssue ? '!' : step.id}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-heading font-semibold text-sm ${step.isDone ? 'text-green-800' : 'text-narra-dark'}`}>
                        {step.title}
                      </span>
                      {step.isDone && (
                        <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                          {step.checkLabel}
                        </span>
                      )}
                      {!step.isDone && step.hasIssue && (
                        <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          ⚠ {step.issueLabel}
                        </span>
                      )}
                      {!step.isDone && !step.hasIssue && step.id <= 4 && bankTxCount === 0 && invoiceCount === 0 && (
                        <span className="text-xs text-narra-muted">Not started</span>
                      )}
                    </div>
                  </div>

                  <span className={`text-narra-muted text-xs transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="px-6 pb-4 ml-12">
                    <p className="text-sm text-narra-muted mb-3 leading-relaxed">{step.description}</p>
                    <button
                      onClick={() => goTo(step.tab)}
                      className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all"
                    >
                      Go to {step.tab === 'reconcile' ? 'Reconciliation' :
                             step.tab === 'invoices'  ? 'Invoices' :
                             step.tab === 'bank'      ? 'Bank Import' :
                             step.tab === 'entries'   ? 'Adjustments' :
                             'Reports'} →
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-narra-border bg-narra-light/30">
          <p className="text-xs text-narra-muted text-center">
            Steps 1–4 track automatically · Steps 5–6 are manual checkpoints
          </p>
        </div>
      </div>
    </div>
  )
}
