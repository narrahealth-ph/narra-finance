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

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

const YEARS = ['2025', '2026', '2027']

type Tab = 'mrr' | 'reconcile' | 'invoices' | 'bank' | 'reports' | 'ai'

export default function FinancePage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('mrr')

  const now = new Date()
  const [selectedMonthName, setSelectedMonthName] = useState(MONTHS[now.getMonth()])
  const [selectedYear, setSelectedYear]           = useState(String(now.getFullYear()))

  const selectedMonth = `${selectedMonthName}_${selectedYear}`

  const [periodId,      setPeriodId]      = useState<number | null>(null)
  const [reportData,    setReportData]    = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  useEffect(() => {
    async function ensurePeriod() {
      const monthIdx  = MONTHS.indexOf(selectedMonthName)
      const startDate = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}-01`
      const lastDay   = new Date(parseInt(selectedYear), monthIdx + 1, 0).getDate()
      const endDate   = `${selectedYear}-${String(monthIdx + 1).padStart(2, '00')}-${lastDay}`

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
    const res  = await fetch(`/api/reports?periodId=${periodId}`)
    const data = await res.json()
    setReportData(data)
    setLoadingReport(false)
  }, [periodId])

  useEffect(() => { loadReports() }, [loadReports])

  async function signOut() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'mrr',       label: 'MRR',           icon: '📈' },
    { id: 'reconcile', label: 'Reconciliation', icon: '⚖️' },
    { id: 'invoices',  label: 'Invoices',       icon: '📄' },
    { id: 'bank',      label: 'Bank Import',    icon: '🏦' },
    { id: 'reports',   label: 'Reports',        icon: '📊' },
    { id: 'ai',        label: 'AI Insights',    icon: '✨' },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-narra-surface">

      {/* Header */}
      <header className="bg-narra-dark text-white px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-4">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <Image
              src="/narra-logo.png"
              alt="Narra Health"
              width={100}
              height={36}
              className="object-contain"
              priority
            />
            <span className="text-white/30 text-sm font-light border-l border-white/10 pl-3">
              finance
            </span>
          </div>

          {/* Month selector */}
          <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5">
            <span className="text-white/40 text-xs">Month:</span>
            <select
              value={selectedMonthName}
              onChange={e => setSelectedMonthName(e.target.value)}
              className="bg-transparent text-white text-sm font-body outline-none cursor-pointer"
            >
              {MONTHS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Year selector */}
          <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5">
            <span className="text-white/40 text-xs">Year:</span>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="bg-transparent text-white text-sm font-body outline-none cursor-pointer"
            >
              {YEARS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {reportData && (
            <div className="hidden md:flex items-center gap-6 text-sm">
              <div className="text-center">
                <div className="text-narra-green font-heading font-semibold">
                  ${(reportData.pl?.totalRevenue || 0).toLocaleString()}
                </div>
                <div className="text-white/30 text-xs">Revenue</div>
              </div>
              <div className="text-center">
                <div className={`font-heading font-semibold ${(reportData.pl?.netProfit || 0) >= 0 ? 'text-narra-green' : 'text-red-400'}`}>
                  ${Math.abs(reportData.pl?.netProfit || 0).toLocaleString()}
                </div>
                <div className="text-white/30 text-xs">{(reportData.pl?.netProfit || 0) >= 0 ? 'Profit' : 'Loss'}</div>
              </div>
              <div className="text-center">
                <div className="text-white font-heading font-semibold">
                  {reportData.reconciliation?.matchedCount}/{reportData.reconciliation?.totalInvoices}
                </div>
                <div className="text-white/30 text-xs">Matched</div>
              </div>
            </div>
          )}

          <button onClick={signOut}
            className="text-white/40 hover:text-white text-xs transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10">
            Sign out
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-narra-dark/95 border-b border-white/10 px-6 flex gap-1 sticky top-[61px] z-20">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-body transition-all border-b-2 whitespace-nowrap
              ${tab === t.id
                ? 'text-narra-green border-narra-green'
                : 'text-white/40 border-transparent hover:text-white/70'
              }`}>
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
        {!periodId ? (
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
              />
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
              <BankImport periodId={periodId} onImport={loadReports} />
            )}
            {tab === 'reports' && (
              <ReportsPanel data={reportData} loading={loadingReport} period={selectedMonth} />
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