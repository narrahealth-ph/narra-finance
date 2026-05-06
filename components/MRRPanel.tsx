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
type Client = { name: string; annualAmount: number; seats: number; type: string; isNew: boolean }
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
  { month: 'Jan 2026', confirmed: 8185, pending: 0, costs: 4974,  net: 3210  },
  { month: 'Feb 2026', confirmed: 7682, pending: 0, costs: 3982,  net: 3700  },
  { month: 'Mar 2026', confirmed: 7776, pending: 0, costs: 6208,  net: 1568  },
]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-narra-dark border border-white/20 rounded-xl p-3 text-xs shadow-xl min-w-[180px]">
      <p className="text-narra-green font-heading font-semibold mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex justify-between gap-4 py-0.5">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="text-white font-medium">${Number(entry.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export default function MRRPanel({ periodId, data, onRefresh, selectedMonth }: {
  periodId: number; data: any; onRefresh: () => void; selectedMonth?: string
}) {
  const [history,         setHistory]         = useState<HistoryPoint[]>(FALLBACK_HISTORY)
  const [historyLoading,  setHistoryLoading]  = useState(true)
  const [clients,         setClients]         = useState<Client[]>([])
  const [costs,           setCosts]           = useState<Cost[]>(DEFAULT_COSTS)
  const [pendingInvoices,  setPendingInvoices]  = useState<PendingInvoice[]>([])
  const [pipelineInvoices, setPipelineInvoices] = useState<PipelineInvoice[]>([])
  const [activeTab,        setActiveTab]        = useState<'revenue' | 'costs' | 'pending' | 'pipeline'>('revenue')
  const [pushing,         setPushing]         = useState(false)
  const [pushMsg,         setPushMsg]         = useState('')
  const [syncing,         setSyncing]         = useState(false)
  const [syncResult,      setSyncResult]      = useState<any>(null)
  const [chartView,    setChartView]    = useState<'all' | '2025' | '2026'>('all')
  const [periodView,   setPeriodView]   = useState<'month' | 'year'>('month')
  const [yearTotals,   setYearTotals]   = useState<Record<number, { mrr: number; costs: number; net: number }>>({})
  const [cumulativeCash, setCumulativeCash] = useState<number | null>(null)
  const [closing2025,    setClosing2025]    = useState<number>(0)
  const selectedYear = selectedMonth?.split('_')[1] || '2026'

  // ── Load history + client breakdown from Google Sheet ──────────────────────
  useEffect(() => {
    setHistoryLoading(true)
    fetch(`/api/mrr/history?month=${encodeURIComponent(selectedMonth || '')}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { history: [], clientBreakdown: [], yearTotals: {} })
      .then(json => {
        // History
        if (json.history?.length > 0) setHistory(json.history)

        // Client breakdown from Sheet — this is cumulative (all active contracts)
        if (json.clientBreakdown?.length > 0) {
          setClients(json.clientBreakdown.map((c: any) => ({
            name:         c.name,
            annualAmount: c.annualAmount,
            seats:        0,
            type:         'direct',
            isNew:        c.isNew,
          })))
        }

        // Year totals for annual view
        if (json.yearTotals) setYearTotals(json.yearTotals)

        // Cumulative cash position (S37 + 2026 net to date)
        if (json.cumulativeCash !== undefined) setCumulativeCash(json.cumulativeCash)
        if (json.closing2025   !== undefined) setClosing2025(json.closing2025)
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [selectedMonth]) // re-fetch when month changes so client table updates

  useEffect(() => {
    if (!periodId) return
    fetch(`/api/mrr/pending?periodId=${periodId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { pending: [] })
      .then(d => setPendingInvoices(d.pending || []))
      .catch(() => {})
  }, [periodId])

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

  const totalConfirmedMrr = useMemo(() => clients.reduce((s, c) => s + Math.round(c.annualAmount / 12), 0), [clients])
  const totalPendingMrr   = useMemo(() => pendingInvoices.reduce((s, i) => s + calcMonthly(i.amount, i.billingType), 0), [pendingInvoices])
  const totalCosts        = costs.reduce((s, c) => s + c.amount, 0)
  const netRevenue        = totalConfirmedMrr - totalCosts
  const opMargin          = totalConfirmedMrr > 0 ? ((netRevenue / totalConfirmedMrr) * 100).toFixed(1) : '0'
  const prevMrr           = history.filter(h => h.confirmed > 0).slice(-2)[0]?.confirmed || 0
  const mrrGrowth         = prevMrr > 0 ? ((totalConfirmedMrr - prevMrr) / prevMrr * 100).toFixed(1) : '0'
  const last3             = history.slice(-3).map(d => d.costs)
  const avgBurn           = last3.length > 0 ? last3.reduce((s, c) => s + c, 0) / last3.length : 1
  const cumNet            = history.reduce((s, d) => s + d.net, 0)
  const runway            = avgBurn > 0 ? Math.floor(cumNet / avgBurn) : 999

  const chartData = useMemo(() => {
    if (chartView === '2025') return history.filter(h => h.month.includes('2025'))
    if (chartView === '2026') return history.filter(h => h.month.includes('2026'))
    return history
  }, [history, chartView])

  async function syncInvoices() {
    setSyncing(true); setSyncResult(null)
    const year = selectedMonth?.split('_')[1] || '2026'
    const res = await fetch('/api/invoice-revenue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year }),
    })
    setSyncResult(await res.json()); setSyncing(false); onRefresh()
  }

  async function pushToSheet() {
    setPushing(true); setPushMsg('')
    const year = selectedMonth?.split('_')[1] || '2026'
    const res = await fetch('/api/sheets-sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year, month: selectedMonth,
        clients: clients.map(c => ({ name: c.name, monthlyMrr: Math.round(c.annualAmount / 12), isNew: c.isNew })),
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
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Monthly Recurring Revenue</h2>
          <p className="text-sm text-narra-muted mt-0.5">
            {historyLoading ? 'Loading from Google Sheet…' : `${history.length} months · ${selectedMonth?.replace('_', ' ')}`}
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
          <button onClick={syncInvoices} disabled={syncing}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-50">
            {syncing ? '⟳ Syncing…' : '⟳ Sync Invoices'}
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
        <div className="bg-narra-light/60 border border-narra-border rounded-xl px-4 py-3 text-sm text-narra-dark">
          ✓ Synced {syncResult.invoicesProcessed} invoices —{' '}
          <span className="text-green-700">{syncResult.fullyPaid?.count} fully paid (${syncResult.fullyPaid?.total?.toLocaleString()})</span>
          {syncResult.sent?.count > 0 && <span className="text-amber-600 ml-2">· {syncResult.sent?.count} pending</span>}
        </div>
      )}

      {/* KPI tiles — switches between month and year view */}
      {periodView === 'year' && yearTotals[parseInt(selectedYear)] ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-narra-dark text-white rounded-xl p-5">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-2 font-body">Total Revenue {selectedYear}</div>
            <div className="font-heading text-2xl font-semibold text-narra-green">${yearTotals[parseInt(selectedYear)].mrr.toLocaleString()}</div>
            <div className="text-xs mt-1 text-white/40">Confirmed annual revenue</div>
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
            <div className="text-xs mt-1 text-narra-muted">Revenue minus costs</div>
          </div>
          {/* Cumulative cash — the real picture */}
          <div className={`rounded-xl p-5 border ${cumulativeCash !== null && cumulativeCash >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Cash Position</div>
            <div className={`font-heading text-2xl font-semibold ${cumulativeCash !== null && cumulativeCash >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {cumulativeCash !== null ? `$${Math.abs(cumulativeCash).toLocaleString()}` : '—'}
            </div>
            <div className="text-xs mt-1 text-narra-muted">
              ${closing2025.toLocaleString()} carried forward + {selectedYear} net
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Confirmed MRR',  value: `$${totalConfirmedMrr.toLocaleString()}`,           sub: `${parseFloat(mrrGrowth) >= 0 ? '+' : ''}${mrrGrowth}% vs prev month`, vc: 'text-narra-dark',   sc: parseFloat(mrrGrowth) >= 0 ? 'text-green-600' : 'text-red-500' },
            { label: 'Pending MRR',    value: `$${Math.round(totalPendingMrr).toLocaleString()}`,  sub: `${pendingInvoices.length} invoice(s) awaiting payment`,              vc: 'text-amber-600',   sc: 'text-amber-500' },
            { label: 'Net Revenue',    value: `$${netRevenue.toLocaleString()}`,                   sub: `${opMargin}% operating margin`,                                       vc: netRevenue >= 0 ? 'text-green-600' : 'text-red-500', sc: 'text-narra-muted' },
            { label: 'Cash Runway',    value: runway >= 999 ? '∞' : `${runway} months`,           sub: `$${Math.round(avgBurn).toLocaleString()} avg monthly burn`,            vc: runway < 3 ? 'text-red-500' : runway < 6 ? 'text-amber-600' : 'text-narra-dark', sc: 'text-narra-muted' },
          ].map(t => (
            <div key={t.label} className="bg-white border border-narra-border rounded-xl p-5">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">{t.label}</div>
              <div className={`font-heading text-2xl font-semibold ${t.vc}`}>{t.value}</div>
              <div className={`text-xs mt-1 ${t.sc}`}>{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="bg-white border border-narra-border rounded-xl p-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark">MRR History</h3>
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
            {(['all', '2025', '2026'] as const).map(v => (
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
          { id: 'revenue',  label: 'Client MRR' },
          { id: 'costs',    label: 'Costs' },
          { id: 'pending',  label: `Pending Collection${pendingInvoices.length > 0 ? ` (${pendingInvoices.length})` : ''}` },
          { id: 'pipeline', label: `Sales Pipeline${pipelineInvoices.length > 0 ? ` (${pipelineInvoices.length})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={`px-5 py-2.5 text-sm font-body transition-all border-b-2 -mb-px whitespace-nowrap
              ${activeTab === t.id ? 'text-narra-dark border-narra-dark font-medium' : 'text-narra-muted border-transparent hover:text-narra-dark'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Client MRR */}
      {activeTab === 'revenue' && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-light/40 border-b border-narra-border flex justify-between items-center">
            <div>
              <span className="text-sm font-heading font-medium text-narra-dark">
                {periodView === 'year' ? `All active clients · ${selectedYear}` : `Active clients · ${selectedMonth?.replace('_', ' ')}`}
              </span>
              <p className="text-xs text-narra-muted mt-0.5">Pulled live from Google Sheet · 🆕 = new contract this month · ✓ = existing subscription</p>
            </div>
            <span className="text-xs text-narra-muted">Edit inline · Annual ÷ 12 = monthly</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-narra-dark text-white">
                {['Client', 'Annual (USD)', 'MRR (÷12)', 'Status', '% of MRR'].map(h => (
                  <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'Client' || h === 'Status' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-narra-muted text-sm">
                  Loading from Google Sheet… if this persists, make sure the sheet is shared with the service account.
                </td></tr>
              ) : clients.map((c, i) => {
                const mrr = Math.round(c.annualAmount / 12)
                const pct = totalConfirmedMrr > 0 ? (mrr / totalConfirmedMrr * 100).toFixed(0) : '0'
                return (
                  <tr key={i} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                    <td className="px-4 py-2.5">
                      <input value={c.name} onChange={e => setClients(p => p.map((cl, idx) => idx === i ? { ...cl, name: e.target.value } : cl))}
                        className="bg-transparent outline-none border-b border-transparent focus:border-narra-muted w-36 font-medium text-narra-dark" />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-narra-muted text-xs mr-1">$</span>
                      <input type="number" value={c.annualAmount} onChange={e => setClients(p => p.map((cl, idx) => idx === i ? { ...cl, annualAmount: parseFloat(e.target.value) || 0 } : cl))}
                        className="bg-transparent outline-none text-right border-b border-transparent focus:border-narra-muted w-24 font-medium text-narra-dark" />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-narra-dark">${mrr.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.isNew ? 'bg-green-100 text-green-700' : 'bg-narra-light text-narra-muted'}`}>
                        {c.isNew ? '🆕 New' : '✓ Retained'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-14 h-1.5 bg-narra-light rounded-full overflow-hidden">
                          <div className="h-full bg-narra-dark rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-narra-muted text-xs w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {clients.length > 0 && (
                <tr className="border-t-2 border-narra-dark bg-narra-surface">
                  <td className="px-4 py-3 font-heading font-bold text-narra-dark">Total Confirmed</td>
                  <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">${clients.reduce((s, c) => s + c.annualAmount, 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">${totalConfirmedMrr.toLocaleString()}</td>
                  <td /><td />
                </tr>
              )}
              {totalPendingMrr > 0 && (
                <tr className="border-t border-amber-200 bg-amber-50">
                  <td className="px-4 py-3 font-medium text-amber-700">+ Pending (sent, not collected)</td>
                  <td className="px-4 py-3 text-right text-amber-700">${Math.round(totalPendingMrr * 12).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-medium text-amber-700">${Math.round(totalPendingMrr).toLocaleString()}</td>
                  <td /><td className="px-4 py-3 text-right text-amber-700 text-xs italic">Not in Sheet yet</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-narra-border">
            <button onClick={() => setClients(p => [...p, { name: 'New Client', annualAmount: 0, seats: 0, type: 'direct', isNew: true }])}
              className="text-sm text-narra-muted hover:text-narra-dark border border-dashed border-narra-border rounded-lg px-3 py-1.5 transition-all hover:border-narra-muted">
              + Add client manually
            </button>
          </div>
        </div>
      )}

      {/* Costs */}
      {activeTab === 'costs' && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-narra-dark text-white">
                {['Cost Item', 'Monthly (USD)', 'Annual (USD)', '% of MRR'].map(h => (
                  <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'Cost Item' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {costs.map((c, i) => (
                <tr key={i} className="border-t border-narra-border hover:bg-narra-surface">
                  <td className="px-4 py-2.5">
                    <input value={c.name} onChange={e => setCosts(p => p.map((co, idx) => idx === i ? { ...co, name: e.target.value } : co))}
                      className="bg-transparent outline-none border-b border-transparent focus:border-narra-muted w-40 font-medium text-narra-dark" />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-narra-muted text-xs mr-1">$</span>
                    <input type="number" value={c.amount} onChange={e => setCosts(p => p.map((co, idx) => idx === i ? { ...co, amount: parseFloat(e.target.value) || 0 } : co))}
                      className="bg-transparent outline-none text-right border-b border-transparent focus:border-narra-muted w-24 font-medium text-red-500" />
                  </td>
                  <td className="px-4 py-2.5 text-right text-narra-muted">${(c.amount * 12).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-red-400">{totalConfirmedMrr > 0 ? (c.amount / totalConfirmedMrr * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
              <tr className="border-t-2 border-narra-dark bg-narra-surface">
                <td className="px-4 py-3 font-heading font-bold text-narra-dark">Total Costs</td>
                <td className="px-4 py-3 text-right font-heading font-bold text-red-500">${totalCosts.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-heading font-bold text-red-500">${(totalCosts * 12).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-heading font-bold text-red-500">{totalConfirmedMrr > 0 ? (totalCosts / totalConfirmedMrr * 100).toFixed(1) : 0}%</td>
              </tr>
              <tr className="border-t border-narra-border bg-narra-light/30">
                <td className="px-4 py-3 font-heading font-semibold text-narra-dark">Net Revenue</td>
                <td className={`px-4 py-3 text-right font-heading font-bold ${netRevenue >= 0 ? 'text-green-600' : 'text-red-500'}`}>${netRevenue.toLocaleString()}</td>
                <td className={`px-4 py-3 text-right font-heading font-bold ${netRevenue >= 0 ? 'text-green-600' : 'text-red-500'}`}>${(netRevenue * 12).toLocaleString()}</td>
                <td className={`px-4 py-3 text-right font-heading font-bold ${netRevenue >= 0 ? 'text-green-600' : 'text-red-500'}`}>{opMargin}% margin</td>
              </tr>
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-narra-border">
            <button onClick={() => setCosts(p => [...p, { name: 'New Cost', amount: 0 }])}
              className="text-sm text-narra-muted hover:text-narra-dark border border-dashed border-narra-border rounded-lg px-3 py-1.5 transition-all hover:border-narra-muted">
              + Add cost item
            </button>
          </div>
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
  )
}
