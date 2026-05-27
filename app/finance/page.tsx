'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import InvoiceSync from '@/components/InvoiceSync'
import BankImport from '@/components/BankImport'
import ReportsPanel from '@/components/ReportsPanel'
import MRRPanel from '@/components/MRRPanel'
import ReconciliationPanel from '@/components/ReconciliationPanel'
import AIInsights from '@/components/AIInsights'
import AnnualReportPanel from '@/components/AnnualReportPanel'
import ManualEntriesPanel from '@/components/ManualEntriesPanel'
import FinancialCloseWizard from '@/components/FinancialCloseWizard'
import ClientsPanel from '@/components/ClientsPanel'
import InvestorPanel from '@/components/InvestorPanel'
import InstructionsPanel from '@/components/InstructionsPanel'
import NotificationsBell from '@/components/NotificationsBell'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

// Generate years from 2024 through next year dynamically
const _cy = new Date().getFullYear()
const YEARS = Array.from({ length: _cy - 2022 }, (_, i) => String(2024 + i))

type Tab = 'mrr' | 'clients' | 'reconcile' | 'invoices' | 'bank' | 'reports' | 'entries' | 'ai' | 'annual' | 'investor' | 'instructions'

export default function FinancePage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('investor')

  const now = new Date()
  const [selectedMonthName, setSelectedMonthName] = useState(MONTHS[now.getMonth()])
  const [selectedYear, setSelectedYear]           = useState(String(now.getFullYear()))

  const selectedMonth = `${selectedMonthName}_${selectedYear}`

  const [periodId,      setPeriodId]      = useState<number | null>(null)
  const [reportData,    setReportData]    = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [showWizard,    setShowWizard]    = useState(false)
  const [clearing,        setClearing]        = useState(false)
  const [showClearMenu,   setShowClearMenu]   = useState(false)
  const [clearConfirm,    setClearConfirm]    = useState<string | null>(null) // null | 'all' | type key
  const [mrrRefreshKey,   setMrrRefreshKey]   = useState(0)
  const [bankRefreshKey,  setBankRefreshKey]  = useState(0)

  useEffect(() => {
    setPeriodId(null) // reset so components don't show stale data during transition
    async function ensurePeriod() {
      const monthIdx  = MONTHS.indexOf(selectedMonthName)
      const startDate = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}-01`
      const lastDay   = new Date(parseInt(selectedYear), monthIdx + 1, 0).getDate()
      const endDate   = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}-${lastDay}`

      const res = await fetch('/api/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: selectedMonth, startDate, endDate }),
      })
      const data = await res.json()
      setPeriodId(data.id)
    }
    ensurePeriod()
  }, [selectedMonth, selectedMonthName, selectedYear])

  const loadReports = useCallback(async () => {
    if (!periodId) return
    setLoadingReport(true)
    try {
      const res  = await fetch(`/api/reports?periodId=${periodId}`)
      const data = await res.json()
      setReportData(data)
    } catch (err) {
      console.error('Failed to load reports:', err)
    } finally {
      setLoadingReport(false)
    }
  }, [periodId])

  useEffect(() => { loadReports() }, [loadReports])

  async function signOut() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  const CLEAR_OPTIONS = [
    { key: 'all',           label: 'Everything',       desc: 'Wipe all data for this month' },
    { key: 'bank',          label: 'Bank transactions', desc: 'Imported bank statements' },
    { key: 'invoices',      label: 'Invoices',          desc: 'Expense invoices from Drive' },
    { key: 'mrr',           label: 'MRR entries',       desc: 'Synced outgoing invoices' },
    { key: 'reconciliation',label: 'Reconciliation',    desc: 'Match sessions' },
    { key: 'entries',       label: 'Manual entries',    desc: 'Adjustments & journal entries' },
    { key: 'ai',            label: 'AI insights',       desc: 'Cached AI analysis' },
  ]

  async function clearPeriod(type: string) {
    if (!periodId) { alert('Period not ready yet — please wait a moment and try again.'); return }
    setClearing(true)
    setClearConfirm(null)
    setShowClearMenu(false)
    try {
      const url = type === 'all'
        ? `/api/periods?periodId=${periodId}`
        : `/api/periods?periodId=${periodId}&type=${type}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to clear')
        return
      }
      setReportData(null)
      setMrrRefreshKey(k => k + 1)
      setBankRefreshKey(k => k + 1)
      await loadReports()
    } catch (err) {
      console.error('Clear failed:', err)
      alert('Something went wrong. Please refresh and try again.')
    } finally {
      setClearing(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'investor',     label: 'Business Overview', icon: '📋' },
    { id: 'clients',   label: 'Clients',          icon: '🏢' },
    { id: 'bank',      label: 'Bank Import',      icon: '🏦' },
    { id: 'mrr',       label: 'Revenue',          icon: '📈' },
    { id: 'invoices',  label: 'Invoices',         icon: '📄' },
    { id: 'reconcile', label: 'Reconciliation',   icon: '⚖️' },
    { id: 'entries',   label: 'Adjustments',      icon: '✏️' },
    { id: 'reports',   label: 'Reports',          icon: '📊' },
    { id: 'annual',    label: 'Cash Flow',        icon: '💵' },
    { id: 'ai',        label: 'AI Insights',      icon: '✨' },
    { id: 'instructions', label: 'How to Use',       icon: '📖' },
  ]

  const isLoading = loadingReport || !periodId || clearing

  return (
    <div className="min-h-screen flex flex-col bg-narra-surface">

      {/* Top loading bar */}
      {isLoading && (
        <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-narra-dark/20 overflow-hidden">
          <div className="h-full bg-narra-green animate-loading-bar" />
        </div>
      )}

      {showWizard && (
        <FinancialCloseWizard
          reportData={reportData}
          selectedMonth={selectedMonth}
          onNavigate={(t) => setTab(t as Tab)}
          onClose={() => setShowWizard(false)}
          onRefresh={loadReports}
        />
      )}

      {/* Header */}
      <header className="bg-narra-dark text-white px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-30 gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">

          {/* Logo */}
          <button onClick={() => router.push('/finance')} className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
            <Image
              src="/narra-logo.png"
              alt="Narra Health"
              width={80}
              height={30}
              className="object-contain"
              priority
            />
            <span className="text-white/30 text-xs font-light border-l border-white/10 pl-2 hidden sm:inline">
              finance
            </span>
          </button>

          {/* Month selector */}
          <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-1.5">
            <span className="text-white/40 text-xs hidden sm:inline">Month:</span>
            <select
              value={selectedMonthName}
              onChange={e => setSelectedMonthName(e.target.value)}
              className="bg-transparent text-white text-xs font-body outline-none cursor-pointer"
            >
              {MONTHS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Year selector */}
          <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-1.5">
            <span className="text-white/40 text-xs hidden sm:inline">Year:</span>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="bg-transparent text-white text-xs font-body outline-none cursor-pointer"
            >
              {YEARS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          {/* Clear period — dropdown menu */}
          <div className="relative">
            {clearConfirm ? (
              <div className="flex items-center gap-1.5">
                <span className="text-red-400 text-xs hidden sm:inline whitespace-nowrap">
                  Clear {clearConfirm === 'all' ? `all ${selectedMonthName}` : CLEAR_OPTIONS.find(o => o.key === clearConfirm)?.label} data?
                </span>
                <button
                  onClick={() => clearPeriod(clearConfirm)}
                  className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all"
                >Yes</button>
                <button
                  onClick={() => setClearConfirm(null)}
                  className="text-xs px-2 py-1 bg-white/10 text-white/60 rounded-lg hover:bg-white/20 transition-all"
                >No</button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearMenu(v => !v)}
                disabled={clearing}
                className="text-white/30 hover:text-red-400 text-xs transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-white/10 flex items-center gap-1"
              >
                {clearing ? '…' : 'Clear ▾'}
              </button>
            )}

            {showClearMenu && !clearConfirm && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowClearMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-narra-border rounded-xl shadow-xl py-1 min-w-[220px]">
                  <div className="px-3 py-1.5 text-[10px] text-narra-muted uppercase tracking-widest border-b border-narra-border">
                    Clear {selectedMonthName} data
                  </div>
                  {CLEAR_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => { setShowClearMenu(false); setClearConfirm(opt.key) }}
                      className={`w-full text-left px-3 py-2 hover:bg-narra-surface transition-colors ${opt.key === 'all' ? 'border-t border-narra-border mt-1' : ''}`}
                    >
                      <div className={`text-sm font-medium ${opt.key === 'all' ? 'text-red-600' : 'text-narra-dark'}`}>
                        {opt.label}
                      </div>
                      <div className="text-xs text-narra-muted">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <NotificationsBell />

          {/* Monthly close wizard */}
          <button
            onClick={() => setShowWizard(true)}
            className="text-narra-green text-xs font-body px-2 sm:px-3 py-1.5 rounded-lg border border-narra-green/30 hover:bg-narra-green/10 transition-all whitespace-nowrap"
          >
            <span className="hidden sm:inline">Close Month</span>
            <span className="sm:hidden">Close</span>
          </button>

          <button onClick={signOut}
            className="text-white/40 hover:text-white text-xs transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-white/10 hidden sm:block">
            Sign out
          </button>
        </div>
      </header>

      {/* Tabs — scrollable on mobile */}
      <div className="bg-narra-dark/95 border-b border-white/10 px-2 sm:px-6 flex gap-0.5 sticky top-[53px] sm:top-[61px] z-20 overflow-x-auto scrollbar-none">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-2.5 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-body transition-all border-b-2 whitespace-nowrap rounded-t-md flex-shrink-0
              ${tab === t.id
                ? 'text-narra-green border-narra-green bg-white/8 font-medium'
                : 'text-white/40 border-transparent hover:text-white/70 hover:bg-white/5'
              }`}>
            <span className="mr-1">{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.label.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <main className={`flex-1 px-4 sm:px-6 py-4 sm:py-6 max-w-7xl mx-auto w-full transition-opacity duration-200 ${loadingReport && tab !== 'annual' && tab !== 'investor' && tab !== 'instructions' ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
        {tab === 'instructions' ? (
          <InstructionsPanel />
        ) : tab === 'investor' ? (
          <InvestorPanel />
        ) : tab === 'annual' ? (
          <AnnualReportPanel selectedYear={selectedYear} />
        ) : !periodId ? (
          <div className="flex items-center justify-center h-64 text-narra-muted">
            Loading period…
          </div>
        ) : (
          <>
            {tab === 'mrr' && (
              <MRRPanel
                periodId={periodId}
                data={reportData?.mrr}
                onRefresh={loadReports}
                selectedMonth={selectedMonth}
                refreshKey={mrrRefreshKey}
              />
            )}
            {tab === 'clients' && (
              <ClientsPanel />
            )}
            {tab === 'reconcile' && (
              <ReconciliationPanel
                periodId={periodId}
                data={reportData?.reconciliation}
                onRefresh={loadReports}
                selectedMonth={selectedMonth}
              />
            )}
            {tab === 'invoices' && (
              <InvoiceSync periodId={periodId} monthLabel={selectedMonth} onSync={loadReports} />
            )}
            {tab === 'bank' && (
              <BankImport periodId={periodId} onImport={loadReports} refreshKey={bankRefreshKey} selectedYear={selectedYear} />
            )}
            {tab === 'reports' && (
              <ReportsPanel data={reportData} loading={loadingReport} period={selectedMonth} selectedYear={selectedYear} />
            )}
            {tab === 'entries' && (
              <ManualEntriesPanel
                periodId={periodId}
                reportData={reportData}
                onRefresh={loadReports}
              />
            )}
            {tab === 'ai' && (
              <AIInsights periodId={periodId} data={reportData} />
            )}
          </>
        )}
      </main>
    </div>
  )
}