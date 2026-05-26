'use client'
import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'
import { downloadCSV, toCSV } from '@/lib/csv'

type HistoryPoint = { month: string; confirmed: number; pending: number; costs: number; net: number }
type PendingInvoice = { invoiceId: string; clientName: string; amount: number; issueDate: string; daysOutstanding: number; billingType: string }
type PipelineInvoice = { invoiceId: string; clientName: string; amount: number; issueDate: string; billingType: string; notes?: string }
type Client = { invoiceId?: string; name: string; annualAmount: number; seats: number; billingType: string; issueDate?: string; isNew: boolean; isPending: boolean; isOneOff: boolean; isCarryover?: boolean; countedInMrr?: boolean }
type Cost = { name: string; amount: number }

const DEFAULT_COSTS: Cost[] = [
  { name: 'Payroll',         amount: 5264 },
  { name: 'Subscriptions',   amount: 1315 },
  { name: 'Sleek+Marketing', amount: 0    },
]

const FALLBACK_HISTORY: HistoryPoint[] = [
  { month: 'Jan 2025', confirmed: 0,    pending: 0, costs: 1173,  net: -1173 },
  { month: 'Feb 2025', confirmed: 3805, pending: 0, costs: 1666,  net: 2139  },
  { month: 'Mar 2025', confirmed: 3805, pending: 0, costs: 1989,  net: 1816  },
  { month: 'Apr 2025', confirmed: 3977, pending: 0, costs: 2338,  net: 1639  },
  { month: 'May 2025', confirmed: 3977, pending: 0, costs: 2166,  net: 1811  },
  { month: 'Jun 2025', confirmed: 5589, pending: 0, costs: 4330,  net: 1258  },
  { month: 'Jul 2025', confirmed: 5589, pending: 0, costs: 4383,  net: 1206  },
  { month: 'Aug 2025', confirmed: 5589, pending: 0, costs: 1211,  net: 4378  },
  { month: 'Sep 2025', confirmed: 6212, pending: 0, costs: 4560,  net: 1652  },
  { month: 'Oct 2025', confirmed: 7640, pending: 0, costs: 7094,  net: 547   },
  { month: 'Nov 2025', confirmed: 7640, pending: 0, costs: 1916,  net: 5724  },
  { month: 'Dec 2025', confirmed: 7640, pending: 0, costs: 6062,  net: 1579  },
]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-narra-dark border border-white/20 rounded-xl p-3 text-xs shadow-xl min-w-[180px]">
      <p className="text-narra-green font-heading font-semibold mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-white">
            <span style={{ background: entry.color }} className="inline-block w-2 h-2 rounded-full flex-shrink-0" />
            {entry.name}
          </span>
          <span className="text-white font-medium">${Number(entry.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export default function MRRPanel({ periodId, data, onRefresh, selectedMonth, refreshKey }: {
  periodId: number; data: any; onRefresh: () => void; selectedMonth?: string; refreshKey?: number
}) {
  const [history,         setHistory]         = useState<HistoryPoint[]>(FALLBACK_HISTORY)
  const [historyLoading,  setHistoryLoading]  = useState(true)
  const [clients,         setClients]         = useState<Client[]>([])
  const [costs,           setCosts]           = useState<Cost[]>([])
  const [pendingInvoices,  setPendingInvoices]  = useState<PendingInvoice[]>([])
  const [pipelineInvoices, setPipelineInvoices] = useState<PipelineInvoice[]>([])
  const [activeTab,        setActiveTab]        = useState<'outgoing' | 'incoming' | 'pending' | 'pipeline'>('outgoing')
  const [incomingInvoices, setIncomingInvoices] = useState<any[]>([])
  const [dbClients,        setDbClients]        = useState<any[]>([])
  const [overrides,        setOverrides]        = useState<Record<string, string>>({})
  const [editingInvoice,   setEditingInvoice]   = useState<{ invoiceId: string; currentName: string } | null>(null)
  const [editName,         setEditName]         = useState('')
  const [pushing,         setPushing]         = useState(false)
  const [pushMsg,         setPushMsg]         = useState('')
  const [syncing,         setSyncing]         = useState(false)
  const [syncResult,      setSyncResult]      = useState<any>(null)
  const [chartView,    setChartView]    = useState<'all' | '2025'>('all')
  const [periodView,   setPeriodView]   = useState<'month' | 'year'>('year')
  const [yearTotals,   setYearTotals]   = useState<Record<number, { mrr: number; costs: number; net: number }>>({})
  const [cumulativeCash,       setCumulativeCash]       = useState<number | null>(null)  // kept for legacy compat
  const [closing2025,          setClosing2025]          = useState<number>(0)            // kept for legacy compat
  const [totalInvoicedByYear,  setTotalInvoicedByYear]  = useState<Record<number, number>>({})
  const [bankReceivedByYear,   setBankReceivedByYear]   = useState<Record<number, number>>({})
  const [sheetRefreshKey,      setSheetRefreshKey]      = useState(0)
  const [showCashDetail,       setShowCashDetail]       = useState(false)
  const [cashDetailRows,       setCashDetailRows]       = useState<any[]>([])
  const [cashDetailLoading,    setCashDetailLoading]    = useState(false)
  const selectedYear = selectedMonth?.split('_')[1] || '2026'

  // ── Load history + client breakdown from Google Sheet ──────────────────────
  useEffect(() => {
    setHistoryLoading(true)
    setClients([])
    setCosts([])
    const yearView = periodView === 'year'
    fetch(`/api/mrr/history?month=${encodeURIComponent(selectedMonth || '')}&yearView=${yearView}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { history: [], clientBreakdown: [], yearTotals: {} })
      .then(json => {
        // History
        if (json.history?.length > 0) setHistory(json.history)

        // Client breakdown from Sheet — this is cumulative (all active contracts)
        if (json.clientBreakdown?.length > 0) {
          setClients(json.clientBreakdown.map((c: any) => ({
            invoiceId:    c.invoiceId || '',
            name:         c.name,
            annualAmount: c.annualAmount,
            seats:        0,
            billingType:  c.billingType || 'annual',
            issueDate:    c.issueDate || '',
            isNew:        c.isNew,
            isPending:    c.isPending || false,
            isOneOff:     c.isOneOff || false,
            isCarryover:  c.isCarryover || false,
            countedInMrr: c.countedInMrr ?? true,
          })))
        }

        // Year totals for annual view
        if (json.yearTotals) setYearTotals(json.yearTotals)

        // Cumulative cash position
        if (json.cumulativeCash        !== undefined) setCumulativeCash(json.cumulativeCash)
        if (json.closing2025           !== undefined) setClosing2025(json.closing2025)
        if (json.totalInvoicedByYear   !== undefined) setTotalInvoicedByYear(json.totalInvoicedByYear)
        if (json.bankReceivedByYear    !== undefined) setBankReceivedByYear(json.bankReceivedByYear)
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [selectedMonth, refreshKey, sheetRefreshKey, periodView]) // re-fetch when month/year-view/refresh changes

  useEffect(() => {
    if (!periodId) return
    fetch(`/api/mrr/pending?periodId=${periodId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { pending: [] })
      .then(d => setPendingInvoices(d.pending || []))
      .catch(() => {})
  }, [periodId, refreshKey])

  // Load incoming (expense) invoices for this period
  useEffect(() => {
    if (!periodId) return
    fetch(`/api/invoices?periodId=${periodId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { invoices: [] })
      .then(d => setIncomingInvoices(d.invoices || []))
      .catch(() => {})
  }, [periodId, refreshKey])

  // Load client registry for distributor info
  useEffect(() => {
    fetch('/api/clients', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { clients: [] })
      .then(d => setDbClients(d.clients || []))
      .catch(() => {})
  }, [])

  // Load invoice name overrides
  useEffect(() => {
    fetch('/api/mrr/overrides', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { overrides: {} })
      .then(d => setOverrides(d.overrides || {}))
      .catch(() => {})
  }, [])

  // Pipeline invoices (Sales status) — still from invoice tracker
  useEffect(() => {
    const year = selectedMonth?.split('_')[1] || '2026'
    fetch(`/api/invoice-revenue?year=${year}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { pipeline: [] })
      .then(d => {
        if (d.pipeline?.length > 0) {
          setPipelineInvoices(d.pipeline.map((inv: any) => ({
            invoiceId:   inv.invoiceId,
            clientName:  inv.clientName,
            amount:      inv.amount,
            issueDate:   inv.issueDate,
            billingType: inv.billingType,
            notes:       inv.notes,
          })))
        }
      })
      .catch(() => {})
  }, [selectedMonth])

  function calcMonthly(amount: number, billingType: string): number {
    const t = (billingType || 'annual').toLowerCase().trim()
    if (t === 'monthly')   return amount
    if (t === 'quarterly') return amount / 3
    if (t === 'pro-rated') return amount / (12 - new Date().getMonth())
    return amount / 12
  }

  // Count all paid recurring clients toward confirmed MRR (one-offs and pending excluded)
  const totalConfirmedMrr = useMemo(() => clients.filter(c => !c.isPending && !c.isOneOff).reduce((s, c) => s + Math.round(c.annualAmount / 12), 0), [clients])
  const totalPendingMrr   = useMemo(() => pendingInvoices.reduce((s, i) => s + calcMonthly(i.amount, i.billingType), 0), [pendingInvoices])
  const totalCosts        = costs.reduce((s, c) => s + c.amount, 0)
  const netRevenue        = totalConfirmedMrr - totalCosts
  const opMargin          = totalConfirmedMrr > 0 ? ((netRevenue / totalConfirmedMrr) * 100).toFixed(1) : '0'
  const prevMrr           = history.filter(h => h.confirmed > 0).slice(-2)[0]?.confirmed || 0
  const mrrGrowth         = prevMrr > 0 ? ((totalConfirmedMrr - prevMrr) / prevMrr * 100).toFixed(1) : '0'
  const hasCurrentYearData = history.some(h => !h.month.includes('2025'))
  const last3             = history.slice(-3).map(d => d.costs)
  const avgBurn           = last3.length > 0 ? last3.reduce((s, c) => s + c, 0) / last3.length : 1
  const cumNet            = history.reduce((s, d) => s + d.net, 0)
  const runway            = avgBurn > 0 ? Math.floor(cumNet / avgBurn) : 999

  // Cash position = cumulative (bank revenue − costs) across all years up to selected year
  const cashPosition = useMemo(() => {
    const selectedYearNum = parseInt(selectedYear)
    const allYears = Array.from(new Set([
      ...Object.keys(bankReceivedByYear).map(Number),
      ...Object.keys(yearTotals).map(Number),
    ])).filter(yr => yr <= selectedYearNum).sort((a, b) => a - b)
    let running = 0
    for (const yr of allYears) {
      running += (bankReceivedByYear[yr] || 0) - (yearTotals[yr]?.costs || 0)
    }
    return running
  }, [bankReceivedByYear, yearTotals, selectedYear])

  const chartData = useMemo(() => {
    if (chartView === '2025') return history.filter(h => h.month.includes('2025'))
    return history
  }, [history, chartView])

  async function saveOverride() {
    if (!editingInvoice || !editName.trim()) return
    await fetch('/api/mrr/overrides', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId: editingInvoice.invoiceId, displayName: editName.trim() }),
    })
    setOverrides(prev => ({ ...prev, [editingInvoice.invoiceId]: editName.trim() }))
    setEditingInvoice(null)
  }

  async function clearOverride(invoiceId: string) {
    await fetch(`/api/mrr/overrides?invoiceId=${encodeURIComponent(invoiceId)}`, { method: 'DELETE', credentials: 'include' })
    setOverrides(prev => { const n = { ...prev }; delete n[invoiceId]; return n })
  }

  async function syncInvoices() {
    setSyncing(true); setSyncResult(null)
    // Include all active clients — both recurring and one-off.
    // Recurring: divide annual amount by billing period to get monthly.
    // One-offs: use the full invoice amount (recognised in the month they're issued).
    const monthlyClients = clients
      .filter(c => !c.isPending)
      .map(c => ({
        name:   c.name,
        amount: c.isOneOff
          ? Math.round(c.annualAmount)  // full amount — already the invoice total
          : Math.round(calcMonthly(c.annualAmount, c.billingType)),
      }))
      .filter(c => c.amount > 0)

    const res  = await fetch('/api/invoice-revenue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, clients: monthlyClients }),
    })
    const result = await res.json()
    setSyncResult(result)

    // Immediately update the history graph with this month's synced MRR
    if (result.totalMrr > 0 && selectedMonth) {
      const label = selectedMonth.replace('_', ' ')
      setHistory(prev => {
        const without = prev.filter(h => h.month !== label)
        return [...without, {
          month:     label,
          confirmed: result.totalMrr,
          pending:   0,
          costs:     totalCosts,
          net:       result.totalMrr - totalCosts,
        }].sort((a, b) => {
          // Keep chronological order
          const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
          const [am, ay] = a.month.split(' ')
          const [bm, by] = b.month.split(' ')
          return parseInt(ay) !== parseInt(by)
            ? parseInt(ay) - parseInt(by)
            : MONTHS.indexOf(am) - MONTHS.indexOf(bm)
        })
      })
    }

    setSyncing(false)
    onRefresh()
  }

  async function pushToSheet() {
    setPushing(true); setPushMsg('')
    const year = selectedMonth?.split('_')[1] || '2026'
    const res = await fetch('/api/sheets-sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year, month: selectedMonth,
        clients: clients.filter(c => !c.isPending).map(c => ({ name: c.name, monthlyMrr: Math.round(c.annualAmount / 12), isNew: c.isNew })),
        costs: {
          payroll:        costs.find(c => c.name.toLowerCase().includes('payroll'))?.amount || 0,
          subscriptions:  costs.find(c => c.name.toLowerCase().includes('subscriptions'))?.amount || 0,
          sleekMarketing: costs.find(c => c.name.toLowerCase().includes('sleek'))?.amount || 0,
        },
      }),
    })
    const r = await res.json()
    setPushMsg(r.success ? `✓ Sheet updated — ${r.updated} cells written${r.newClientsAdded ? `, ${r.newClientsAdded} new client(s) added` : ''}` : `✗ ${r.error}`)
    setPushing(false)
  }

  async function openCashDetail() {
    setShowCashDetail(true)
    setCashDetailLoading(true)
    try {
      const res = await fetch(`/api/bank?action=year_revenue&year=${selectedYear}`, { credentials: 'include' })
      const data = await res.json()
      setCashDetailRows(data.transactions || [])
    } catch {
      setCashDetailRows([])
    } finally {
      setCashDetailLoading(false)
    }
  }

  function exportMRR() {
    downloadCSV(toCSV([
      ...clients.map(c => ({ Client: c.name, 'MRR (USD)': Math.round(c.annualAmount / 12), 'ARR (USD)': c.annualAmount, Period: selectedMonth || '' })),
      { Client: 'TOTAL', 'MRR (USD)': totalConfirmedMrr, 'ARR (USD)': totalConfirmedMrr * 12, Period: '' },
    ], ''), `MRR_${selectedMonth}.csv`)
  }

  function exportPending() {
    downloadCSV(toCSV(pendingInvoices.map(i => ({
      Client: i.clientName, 'Invoice ID': i.invoiceId, 'Amount': i.amount,
      'Issue Date': i.issueDate, 'Days Outstanding': i.daysOutstanding,
    })), ''), `Pending_${selectedMonth}.csv`)
  }

  return (
    <>
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Monthly Recurring Revenue</h2>
          <p className="text-sm text-narra-muted mt-0.5">
            {historyLoading
              ? 'Loading from Google Sheet…'
              : periodView === 'year'
                ? `Full Year ${selectedYear}`
                : `${selectedMonth?.replace('_', ' ')} · ${history.length} months of history`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Month / Year view toggle */}
          <div className="flex bg-narra-surface border border-narra-border rounded-lg overflow-hidden text-xs">
            <button onClick={() => setPeriodView('month')}
              className={`px-4 py-2 font-body transition-all ${periodView === 'month' ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>
              Month
            </button>
            <button onClick={() => setPeriodView('year')}
              className={`px-4 py-2 font-body transition-all ${periodView === 'year' ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>
              Full Year
            </button>
          </div>
          <button
            onClick={() => setSheetRefreshKey(k => k + 1)}
            disabled={historyLoading}
            title="Re-fetch latest data from Google Sheet"
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all disabled:opacity-50">
            {historyLoading ? '⟳ Loading…' : '↻ Refresh from Sheet'}
          </button>
          <button onClick={syncInvoices} disabled={syncing || clients.length === 0 || !periodId}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-50"
            title={clients.length === 0 ? 'No clients loaded from invoice tracker yet' : 'Save active client MRR for this period so the P&L uses accrual revenue'}>
            {syncing ? '⟳ Syncing…' : clients.length === 0 ? '⟳ Loading clients…' : '⟳ Sync Revenue to Period'}
          </button>
          <button onClick={exportMRR}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all">
            ↓ Export CSV
          </button>
          {selectedYear === '2026' && (
            <button onClick={pushToSheet} disabled={pushing}
              className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
              {pushing ? '⟳ Pushing…' : '↑ Push to Sheet'}
            </button>
          )}
        </div>
      </div>

      {pushMsg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${pushMsg.startsWith('✓') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{pushMsg}</div>
      )}
      {syncResult && (
        <div className={`border rounded-xl px-4 py-3 text-sm ${syncResult.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          {syncResult.error
            ? `✗ ${syncResult.error}`
            : `✓ Synced ${syncResult.saved} client${syncResult.saved !== 1 ? 's' : ''} · Total MRR $${(syncResult.totalMrr || 0).toLocaleString()} — P&L will now use accrual revenue`
          }
        </div>
      )}

      {/* KPI tiles — switches between month and year view */}
      {periodView === 'year' && yearTotals[parseInt(selectedYear)] ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* Total Invoiced — full cash value of all invoices issued this year */}
          <div className="bg-narra-dark text-white rounded-xl p-5">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-2 font-body">Total Invoiced {selectedYear}</div>
            <div className="font-heading text-2xl font-semibold text-narra-green">
              ${(totalInvoicedByYear[parseInt(selectedYear)] || 0).toLocaleString()}
            </div>
            <div className="text-xs mt-1 text-white/40">Full invoice amounts issued this year</div>
          </div>
          {/* Cash received from bank statements — click to drill down */}
          <button onClick={openCashDetail} className="bg-narra-dark text-white rounded-xl p-5 text-left hover:bg-narra-mid transition-colors group">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-2 font-body">Cash Received {selectedYear}</div>
            <div className="font-heading text-2xl font-semibold text-narra-green">
              ${(bankReceivedByYear[parseInt(selectedYear)] || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs mt-1 text-white/40 group-hover:text-white/60">Click to see breakdown →</div>
          </button>
          <div className="bg-white border border-narra-border rounded-xl p-5">
            <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Accrual MRR {selectedYear}</div>
            <div className="font-heading text-2xl font-semibold text-narra-dark">${yearTotals[parseInt(selectedYear)].mrr.toLocaleString()}</div>
            <div className="text-xs mt-1 text-narra-muted">Revenue earned by month</div>
          </div>
          <div className="bg-white border border-narra-border rounded-xl p-5">
            <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Total Costs {selectedYear}</div>
            <div className="font-heading text-2xl font-semibold text-red-500">${yearTotals[parseInt(selectedYear)].costs.toLocaleString()}</div>
            <div className="text-xs mt-1 text-narra-muted">Operating costs</div>
          </div>
          <div className="bg-white border border-narra-border rounded-xl p-5">
            <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Net {selectedYear}</div>
            <div className={`font-heading text-2xl font-semibold ${yearTotals[parseInt(selectedYear)].net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {yearTotals[parseInt(selectedYear)].net < 0 ? '(' : ''}${Math.abs(yearTotals[parseInt(selectedYear)].net).toLocaleString()}{yearTotals[parseInt(selectedYear)].net < 0 ? ')' : ''}
            </div>
            <div className="text-xs mt-1 text-narra-muted">Accrual revenue minus costs</div>
          </div>
          <div className={`rounded-xl p-5 border ${cashPosition >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Cash Position</div>
            <div className={`font-heading text-2xl font-semibold ${cashPosition >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {cashPosition < 0 ? '(' : ''}${Math.abs(cashPosition).toLocaleString(undefined, { maximumFractionDigits: 0 })}{cashPosition < 0 ? ')' : ''}
            </div>
            <div className="text-xs mt-1 text-narra-muted">
              Cumulative bank receipts minus all costs to end of {selectedYear}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Confirmed MRR',  value: `$${totalConfirmedMrr.toLocaleString()}`,           sub: `${parseFloat(mrrGrowth) >= 0 ? '+' : ''}${mrrGrowth}% vs prev month`, vc: 'text-narra-dark',   sc: parseFloat(mrrGrowth) >= 0 ? 'text-green-600' : 'text-red-500' },
            { label: 'Pending MRR',    value: `$${Math.round(totalPendingMrr).toLocaleString()}`,  sub: `${pendingInvoices.length} invoice(s) awaiting payment`,              vc: 'text-amber-600',   sc: 'text-amber-500' },
            { label: 'Net Revenue',    value: `$${netRevenue.toLocaleString()}`,                   sub: `${opMargin}% operating margin`,                                       vc: netRevenue >= 0 ? 'text-green-600' : 'text-red-500', sc: 'text-narra-muted' },
            { label: 'Cash Runway',    value: hasCurrentYearData ? (runway >= 999 ? '∞' : `${runway} months`) : '—',  sub: hasCurrentYearData ? `$${Math.round(avgBurn).toLocaleString()} avg monthly burn` : 'Sync a month to calculate', vc: !hasCurrentYearData ? 'text-narra-muted' : runway < 3 ? 'text-red-500' : runway < 6 ? 'text-amber-600' : 'text-narra-dark', sc: 'text-narra-muted' },
            { label: 'Total LTV',      value: dbClients.length > 0 ? `$${dbClients.reduce((s: number, c: any) => s + (c.ltv || 0), 0).toLocaleString()}` : '—', sub: `${dbClients.filter((c: any) => c.ltv > 0).length} clients with revenue`, vc: 'text-narra-dark', sc: 'text-narra-muted' },
            { label: 'Churn',          value: dbClients.filter((c: any) => !c.active).length > 0 ? `${dbClients.filter((c: any) => !c.active).length}` : '0', sub: dbClients.filter((c: any) => !c.active).length > 0 ? 'inactive clients — check holding groups' : 'No known churn', vc: dbClients.filter((c: any) => !c.active).length > 0 ? 'text-red-500' : 'text-green-600', sc: 'text-narra-muted' },
          ].map(t => (
            <div key={t.label} className="bg-white border border-narra-border rounded-xl p-4">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">{t.label}</div>
              <div className={`font-heading text-xl font-semibold ${t.vc}`}>{t.value}</div>
              <div className={`text-xs mt-1 ${t.sc}`}>{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="bg-white border border-narra-border rounded-xl p-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark">Monthly Recurring Revenue</h3>
            <p className="text-xs text-narra-muted mt-0.5">Hover any point to see exact values</p>
            {/* Legend */}
            <div className="flex gap-5 mt-3 flex-wrap">
              {[
                { color: '#173f46', dash: false,  label: 'Confirmed MRR', desc: 'fully paid revenue' },
                { color: '#c7e995', dash: true,   label: 'Expected MRR',  desc: 'sent, not collected yet' },
                { color: '#ef4444', dash: true,   label: 'Costs',         desc: 'monthly operating costs' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <svg width="20" height="8">
                    <line x1="0" y1="4" x2="20" y2="4"
                      stroke={item.color} strokeWidth="2"
                      strokeDasharray={item.dash ? '4 2' : 'none'} />
                  </svg>
                  <span className="text-xs font-medium text-narra-dark">{item.label}</span>
                  <span className="text-xs text-narra-muted hidden sm:inline">— {item.desc}</span>
                </div>
              ))}
            </div>
          </div>
          {/* View toggle */}
          <div className="flex bg-narra-surface border border-narra-border rounded-lg overflow-hidden text-xs">
            {(['all', '2025'] as const).map(v => (
              <button key={v} onClick={() => setChartView(v)}
                className={`px-4 py-2 font-body transition-all ${chartView === v ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>
                {v === 'all' ? 'All Time' : v}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: Math.max(600, chartData.length * 58) }}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d0e8b8" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8aab6e' }} interval={0} angle={-35} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: '#8aab6e' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="confirmed" stroke="#173f46" strokeWidth={2.5}
                  dot={{ fill: '#173f46', r: 3, strokeWidth: 0 }} activeDot={{ r: 6, fill: '#173f46' }} name="Confirmed MRR" />
                <Line type="monotone" dataKey="pending" stroke="#c7e995" strokeWidth={2} strokeDasharray="5 3"
                  dot={{ fill: '#c7e995', r: 3, strokeWidth: 0 }} activeDot={{ r: 6, fill: '#c7e995' }} name="Expected MRR" />
                <Line type="monotone" dataKey="costs" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 3"
                  dot={false} activeDot={{ r: 4, fill: '#ef4444' }} name="Costs" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="text-xs text-narra-muted mt-1">← Scroll to see all months</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-narra-border">
        {[
          { id: 'outgoing',  label: `Outgoing · ${clients.length} client${clients.length !== 1 ? 's' : ''}` },
          { id: 'incoming',  label: `Incoming · ${incomingInvoices.length} invoice${incomingInvoices.length !== 1 ? 's' : ''}` },
          { id: 'pending',   label: `Pending Collection${pendingInvoices.length > 0 ? ` (${pendingInvoices.length})` : ''}` },
          { id: 'pipeline',  label: `Pipeline${pipelineInvoices.length > 0 ? ` (${pipelineInvoices.length})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={`px-5 py-2.5 text-sm font-body transition-all border-b-2 -mb-px whitespace-nowrap
              ${activeTab === t.id ? 'text-narra-dark border-narra-dark font-medium' : 'text-narra-muted border-transparent hover:text-narra-dark'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Outgoing invoices (revenue / client MRR) */}
      {activeTab === 'outgoing' && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-light/40 border-b border-narra-border flex justify-between items-center">
            <div>
              <span className="text-sm font-heading font-medium text-narra-dark">
                {periodView === 'year' ? `All active clients · ${selectedYear}` : `Active clients · ${selectedMonth?.replace('_', ' ')}`}
              </span>
              <p className="text-xs text-narra-muted mt-0.5">From outgoing invoice tracker · billing type determines MRR contribution</p>
            </div>
            <span className="text-xs text-narra-muted">Annual÷12 · Quarterly÷3 · Monthly=full · One-off excluded</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-narra-dark text-white">
                {['Invoice #', 'Client', 'Distributor', 'Issued', 'Billing', 'Invoice Amt', 'MRR', 'Payment', '% of MRR'].map(h => (
                  <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${['Invoice #','Client','Distributor','Issued','Billing','Payment'].includes(h) ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-narra-muted text-sm">
                  Loading from outgoing invoice tracker…
                </td></tr>
              ) : clients.map((c, i) => {
                const displayName = (c.invoiceId && overrides[c.invoiceId]) || c.name
                const hasOverride = !!(c.invoiceId && overrides[c.invoiceId])
                const mrr        = c.isOneOff ? c.annualAmount : Math.round(c.annualAmount / 12)
                const invoiceAmt = c.isOneOff ? c.annualAmount
                                 : c.billingType === 'monthly'  ? mrr
                                 : c.billingType === 'quarterly' ? mrr * 3
                                 : c.annualAmount
                const billingLabel = c.isOneOff ? 'One-off'
                                   : c.billingType === 'monthly'   ? 'Monthly'
                                   : c.billingType === 'quarterly'  ? 'Quarterly'
                                   : 'Annual'
                const pct = !c.isOneOff && !c.isPending && totalConfirmedMrr > 0 ? (mrr / totalConfirmedMrr * 100).toFixed(0) : '—'
                const dbClient = dbClients.find((dc: any) => {
                  const a = dc.name.toLowerCase()
                  const b = displayName.toLowerCase()
                  if (a === b) return true
                  if (a.includes(b) || b.includes(a)) return true
                  // word overlap: any meaningful word (>3 chars) shared between names
                  const wordsA = a.split(/\s+/).filter((w: string) => w.length > 3)
                  const wordsB = b.split(/\s+/).filter((w: string) => w.length > 3)
                  return wordsA.some((w: string) => wordsB.includes(w))
                })
                return (
                  <tr key={i} className={`border-t border-narra-border hover:bg-narra-surface transition-colors ${c.isPending ? 'opacity-75' : ''}`}>
                    <td className="px-4 py-2.5 font-mono text-xs text-narra-muted whitespace-nowrap">{c.invoiceId || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {c.isNew && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">New</span>}
                        {c.isCarryover && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">↩ Carried over</span>}
                        <span className="font-medium text-narra-dark">{displayName}</span>
                        {hasOverride && <span className="text-xs text-narra-muted italic">({c.name})</span>}
                        <button
                          onClick={() => { setEditingInvoice({ invoiceId: c.invoiceId || '', currentName: displayName }); setEditName(displayName) }}
                          className="text-narra-muted hover:text-narra-dark text-xs ml-0.5"
                          title="Edit display name">✎</button>
                        {hasOverride && <button onClick={() => clearOverride(c.invoiceId!)} className="text-xs text-red-400 hover:text-red-600" title="Revert">✕</button>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {dbClient?.distributor
                        ? <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">{dbClient.distributor}</span>
                        : <span className="text-xs text-narra-border">Direct</span>}
                    </td>
                    <td className="px-4 py-2.5 text-narra-muted text-xs">
                      {c.issueDate ? new Date(c.issueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.isOneOff ? 'bg-purple-100 text-purple-700' : 'bg-narra-light text-narra-muted'}`}>{billingLabel}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-narra-dark">${invoiceAmt.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-narra-dark">
                      {c.isOneOff ? <span className="text-purple-700">${mrr.toLocaleString()} this month</span> : `$${mrr.toLocaleString()}/mo`}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.isPending ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {c.isPending ? 'Sent' : 'Paid'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {c.isOneOff ? <span className="text-xs text-narra-muted italic">non-recurring</span> : (
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-14 h-1.5 bg-narra-light rounded-full overflow-hidden">
                            <div className="h-full bg-narra-dark rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-narra-muted text-xs w-8 text-right">{pct}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {clients.length > 0 && (() => {
                const confirmedRecurring = clients.filter(c => !c.isPending && !c.isOneOff)
                const pendingRecurring   = clients.filter(c => c.isPending && !c.isOneOff)
                const confirmedOneOff    = clients.filter(c => !c.isPending && c.isOneOff)
                const pendingOneOff      = clients.filter(c => c.isPending && c.isOneOff)
                const pendingMrr         = pendingRecurring.reduce((s, c) => s + Math.round(c.annualAmount / 12), 0)
                const confirmedOneOffTotal = confirmedOneOff.reduce((s, c) => s + c.annualAmount, 0)
                const pendingOneOffTotal   = pendingOneOff.reduce((s, c) => s + c.annualAmount, 0)
                return (
                  <>
                    <tr className="border-t-2 border-narra-dark bg-narra-surface">
                      <td className="px-4 py-3 font-heading font-bold text-narra-dark" colSpan={4}>
                        Confirmed MRR · {confirmedRecurring.length} recurring client{confirmedRecurring.length !== 1 ? 's' : ''} (Paid)
                      </td>
                      <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">${totalConfirmedMrr.toLocaleString()}/mo</td>
                      <td colSpan={2} />
                    </tr>
                    {confirmedOneOffTotal > 0 && (
                      <tr className="border-t border-purple-200 bg-purple-50">
                        <td className="px-4 py-3 font-medium text-purple-800" colSpan={4}>
                          + One-off revenue this month ({confirmedOneOff.length} payment{confirmedOneOff.length !== 1 ? 's' : ''}, Paid)
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-purple-800">${confirmedOneOffTotal.toLocaleString()}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    {pendingMrr > 0 && (
                      <tr className="border-t border-amber-200 bg-amber-50">
                        <td className="px-4 py-3 font-medium text-amber-700" colSpan={4}>
                          + Pending recurring · {pendingRecurring.length} invoice{pendingRecurring.length !== 1 ? 's' : ''} sent, not yet paid
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-amber-700">${pendingMrr.toLocaleString()}/mo</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    {pendingOneOffTotal > 0 && (
                      <tr className="border-t border-amber-100 bg-amber-50/50">
                        <td className="px-4 py-3 font-medium text-amber-600" colSpan={4}>
                          + Pending one-off · {pendingOneOff.length} invoice{pendingOneOff.length !== 1 ? 's' : ''} sent, not yet paid
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-amber-600">${pendingOneOffTotal.toLocaleString()}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                  </>
                )
              })()}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-narra-border">
            <p className="text-xs text-narra-muted">Data from outgoing invoice tracker · sync invoices to refresh</p>
          </div>
        </div>
      )}

      {/* Incoming invoices (expense invoices from DB) */}
      {activeTab === 'incoming' && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-light/40 border-b border-narra-border flex justify-between items-center">
            <div>
              <span className="text-sm font-heading font-medium text-narra-dark">Incoming Invoices (Expenses)</span>
              <p className="text-xs text-narra-muted mt-0.5">Expense invoices synced from Google Drive for this period</p>
            </div>
            <span className="text-xs text-narra-muted">{incomingInvoices.length} invoice{incomingInvoices.length !== 1 ? 's' : ''} · Total ${incomingInvoices.reduce((s, i) => s + parseFloat(i.amount_usd || i.amount || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          {incomingInvoices.length === 0 ? (
            <div className="px-4 py-10 text-center text-narra-muted text-sm">
              No expense invoices for this period yet — sync from the Invoices tab first.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-narra-dark text-white">
                  {['Vendor', 'Account', 'Date', 'Currency', 'Amount (USD)', 'Status'].map(h => (
                    <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'Amount (USD)' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incomingInvoices.map((inv: any, i: number) => (
                  <tr key={i} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                    <td className="px-4 py-2.5 font-medium text-narra-dark">{inv.vendor || inv.drive_file_name || '—'}</td>
                    <td className="px-4 py-2.5 text-narra-muted text-xs">{inv.account_name || '—'}</td>
                    <td className="px-4 py-2.5 text-narra-muted">{inv.date ? new Date(inv.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="px-4 py-2.5">
                      {inv.currency && inv.currency !== 'USD'
                        ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{inv.currency}</span>
                        : <span className="text-xs text-narra-muted">USD</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-narra-dark">
                      ${parseFloat(inv.amount_usd || inv.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        inv.status === 'matched'  ? 'bg-green-100 text-green-700' :
                        inv.status === 'proposed' ? 'bg-blue-100 text-blue-700' :
                        inv.status === 'flagged'  ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'}`}>
                        {inv.status || 'unmatched'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-narra-dark bg-narra-surface">
                  <td colSpan={4} className="px-4 py-3 font-heading font-semibold text-narra-dark">Total Expenses</td>
                  <td className="px-4 py-3 text-right font-heading font-bold text-red-500">
                    ${incomingInvoices.reduce((s: number, i: any) => s + parseFloat(i.amount_usd || i.amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Pending */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-heading font-semibold text-narra-dark">Pending Collection</h3>
              <p className="text-xs text-narra-muted mt-0.5">Invoices marked "Sent" with no matching bank deposit</p>
            </div>
            {pendingInvoices.length > 0 && (
              <button onClick={exportPending}
                className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">
                ↓ Export CSV
              </button>
            )}
          </div>
          {pendingInvoices.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
              <div className="text-3xl mb-2">✓</div>
              <p className="font-heading font-semibold text-green-800">All clear!</p>
              <p className="text-green-600 text-sm mt-1">No outstanding invoices for this period.</p>
            </div>
          ) : (
            <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
                <span className="text-sm font-medium text-amber-800">
                  ⚠️ {pendingInvoices.length} outstanding · ${Math.round(pendingInvoices.reduce((s, i) => s + i.amount, 0)).toLocaleString()} total
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-amber-800/10">
                    {['Client', 'Invoice ID', 'Amount', 'Issue Date', 'Days Out', 'Billing'].map(h => (
                      <th key={h} className={`px-4 py-2.5 text-xs font-body text-amber-800/60 uppercase tracking-wider ${h === 'Amount' || h === 'Days Out' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...pendingInvoices].sort((a, b) => b.daysOutstanding - a.daysOutstanding).map((inv, i) => (
                    <tr key={i} className="border-t border-amber-100 hover:bg-amber-50/50">
                      <td className="px-4 py-3 font-medium text-amber-900">{inv.clientName}</td>
                      <td className="px-4 py-3 text-amber-700 font-mono text-xs">{inv.invoiceId}</td>
                      <td className="px-4 py-3 text-right font-medium text-amber-900">${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-amber-700">{inv.issueDate}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${inv.daysOutstanding > 30 ? 'bg-red-100 text-red-700' : inv.daysOutstanding > 14 ? 'bg-amber-100 text-amber-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {inv.daysOutstanding}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-amber-700 capitalize">{inv.billingType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sales Pipeline */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Pipeline Deals', value: pipelineInvoices.length.toString(), sub: 'Not yet contracted' },
              { label: 'Potential ARR',  value: `$${pipelineInvoices.reduce((s, i) => s + i.amount, 0).toLocaleString()}`, sub: 'If all deals close' },
              { label: 'Potential MRR',  value: `$${Math.round(pipelineInvoices.reduce((s, i) => s + i.amount, 0) / 12).toLocaleString()}`, sub: 'Annual ÷ 12' },
            ].map(t => (
              <div key={t.label} className="bg-white border border-narra-border rounded-xl p-5">
                <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">{t.label}</div>
                <div className="font-heading text-2xl font-semibold text-narra-dark">{t.value}</div>
                <div className="text-xs mt-1 text-narra-muted">{t.sub}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-heading font-semibold text-narra-dark">Sales Pipeline</h3>
              <p className="text-xs text-narra-muted mt-0.5">
                Status "Sales" in invoice tracker — agreed in principle, not yet contracted.
                These are <strong>never</strong> written to the MRR sheet.
              </p>
            </div>
            {pipelineInvoices.length > 0 && (
              <button
                onClick={() => downloadCSV(toCSV(pipelineInvoices.map(inv => ({
                  Client: inv.clientName, 'Invoice ID': inv.invoiceId,
                  'Amount (USD)': inv.amount, 'Issue Date': inv.issueDate,
                  'Billing Type': inv.billingType, Notes: inv.notes || '',
                })), ''), `Pipeline_${selectedMonth}.csv`)}
                className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">
                ↓ Export CSV
              </button>
            )}
          </div>

          {pipelineInvoices.length === 0 ? (
            <div className="bg-narra-light/40 border border-narra-border rounded-xl p-8 text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="font-heading font-semibold text-narra-dark">No pipeline deals</p>
              <p className="text-narra-muted text-sm mt-1">Mark invoices as "Sales" in your invoice tracker to see them here.</p>
            </div>
          ) : (
            <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-narra-light/40 border-b border-narra-border">
                <span className="text-sm font-medium text-narra-dark">
                  🎯 {pipelineInvoices.length} deal(s) · ${pipelineInvoices.reduce((s, i) => s + i.amount, 0).toLocaleString()} potential ARR
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-narra-dark text-white">
                    {['Client', 'Invoice ID', 'Amount', 'Potential MRR', 'Issue Date', 'Billing', 'Notes'].map(h => (
                      <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'Amount' || h === 'Potential MRR' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pipelineInvoices.map((inv, i) => (
                    <tr key={i} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                      <td className="px-4 py-3 font-medium text-narra-dark">{inv.clientName}</td>
                      <td className="px-4 py-3 text-narra-muted font-mono text-xs">{inv.invoiceId}</td>
                      <td className="px-4 py-3 text-right font-medium text-narra-dark">${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs bg-narra-light text-narra-muted px-2 py-0.5 rounded-full">
                          ${Math.round(inv.amount / 12).toLocaleString()}/mo
                        </span>
                      </td>
                      <td className="px-4 py-3 text-narra-muted">{inv.issueDate || '—'}</td>
                      <td className="px-4 py-3 text-narra-muted capitalize">{inv.billingType}</td>
                      <td className="px-4 py-3 text-narra-muted text-xs italic">{inv.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-narra-dark bg-narra-surface">
                    <td className="px-4 py-3 font-heading font-bold text-narra-dark">Total Pipeline</td>
                    <td />
                    <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">${pipelineInvoices.reduce((s, i) => s + i.amount, 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">${Math.round(pipelineInvoices.reduce((s, i) => s + i.amount, 0) / 12).toLocaleString()}/mo</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>

      {/* Cash Received drill-down modal */}
      {showCashDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCashDetail(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-narra-border flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-heading font-semibold text-narra-dark text-lg">Cash Received — {selectedYear}</h3>
                <p className="text-xs text-narra-muted mt-0.5">All revenue bank transactions for this year</p>
              </div>
              <button onClick={() => setShowCashDetail(false)} className="w-8 h-8 rounded-full bg-narra-surface text-narra-muted hover:text-narra-dark flex items-center justify-center transition-all">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {cashDetailLoading ? (
                <div className="flex items-center justify-center h-48 text-narra-muted animate-pulse-soft">Loading…</div>
              ) : cashDetailRows.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-narra-muted">No revenue transactions found for {selectedYear}.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-narra-dark text-white">
                      {['Month', 'Date', 'Description', 'Account', 'Amount', 'USD'].map(h => (
                        <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'Amount' || h === 'USD' ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cashDetailRows.map((tx: any, i: number) => (
                      <tr key={i} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                        <td className="px-4 py-2.5 text-narra-muted text-xs whitespace-nowrap">{tx.period_label?.replace('_', ' ')}</td>
                        <td className="px-4 py-2.5 text-narra-muted text-xs whitespace-nowrap">{String(tx.date).split('T')[0]}</td>
                        <td className="px-4 py-2.5 text-narra-dark font-medium max-w-xs truncate">{tx.description}</td>
                        <td className="px-4 py-2.5 text-narra-muted text-xs">{tx.account || '—'}</td>
                        <td className="px-4 py-2.5 text-right text-narra-dark whitespace-nowrap">
                          {tx.currency !== 'USD' ? `${tx.currency} ` : ''}{parseFloat(tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-green-700 whitespace-nowrap">
                          ${parseFloat(tx.amount_usd || tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0">
                    <tr className="border-t-2 border-narra-dark bg-narra-surface">
                      <td colSpan={5} className="px-4 py-3 font-heading font-semibold text-narra-dark text-sm">
                        {cashDetailRows.length} transaction{cashDetailRows.length !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 text-right font-heading font-bold text-green-700">
                        ${cashDetailRows.reduce((s: number, tx: any) => s + parseFloat(tx.amount_usd || tx.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit invoice display name modal */}
      {editingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingInvoice(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-heading font-semibold text-narra-dark">Edit Invoice Name</h3>
            <p className="text-xs text-narra-muted">Invoice: <span className="font-mono">{editingInvoice.invoiceId || '(no ID)'}</span></p>
            <div>
              <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Display Name</label>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveOverride()}
                className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setEditingInvoice(null)}
                className="px-4 py-2 border border-narra-border rounded-lg text-sm text-narra-muted hover:text-narra-dark transition-all">
                Cancel
              </button>
              <button onClick={saveOverride} disabled={!editName.trim()}
                className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
