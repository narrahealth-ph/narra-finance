'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { downloadCSV } from '@/lib/csv'
import { fmt } from '@/lib/format'

const MONTHS_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

export default function AnnualReportPanel({
  selectedYear,
  currency = 'USD',
  sgdRate,
}: {
  selectedYear: string
  currency?: 'USD' | 'SGD'
  sgdRate?: number
}) {
  const [data,    setData]    = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [locking, setLocking] = useState(false)
  const [locked,  setLocked]  = useState(false)
  const [showRevenueBreakdown,  setShowRevenueBreakdown]  = useState(false)
  const [showExpenseBreakdown,  setShowExpenseBreakdown]  = useState(false)

  // Currency helpers — CSV exports always stay in USD, display only
  const rate = currency === 'SGD' ? (sgdRate || 0.74) : 1
  const cvt  = (n: number) => currency === 'SGD' ? (n || 0) / rate : (n || 0)
  const sym  = currency === 'SGD' ? 'S$' : '$'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/annual-report?year=${selectedYear}`, { credentials: 'include' })
      const json = await res.json()
      setData(json)
      setLocked(json.lockedCount === json.totalPeriods && json.totalPeriods > 0)
    } finally {
      setLoading(false)
    }
  }, [selectedYear])

  useEffect(() => { load() }, [load])

  async function lockYear() {
    if (!confirm(`Lock all ${selectedYear} months? This marks the year as closed.`)) return
    setLocking(true)
    await fetch('/api/annual-report', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: selectedYear }),
    })
    setLocking(false)
    load()
  }

  // Sort months chronologically
  const sortedMonths: any[] = data
    ? [...(data.months || [])].sort((a: any, b: any) =>
        MONTHS_ORDER.indexOf(a.label.split('_')[0]) - MONTHS_ORDER.indexOf(b.label.split('_')[0])
      )
    : []

  // Compute per-month cumulative cash balance + month-over-month revenue growth
  const openingCashYear = data?.totals?.openingCash || 0
  let runningCash = openingCashYear
  const sortedWithCash = sortedMonths.map((m: any, i: number) => {
    const opening     = runningCash
    runningCash      += m.net
    const prevRevenue = i > 0 ? sortedMonths[i - 1].revenue : null
    const momGrowth   = prevRevenue != null && prevRevenue > 0
      ? ((m.revenue - prevRevenue) / prevRevenue * 100).toFixed(1)
      : null
    return { ...m, openingCash: opening, closingCash: runningCash, momGrowth }
  })

  const closingCashYear = data?.totals?.closingCash || 0
  const totalNet        = data?.totals?.net         || 0
  const totalRevenue    = data?.totals?.revenue     || 0
  const totalExpenses   = data?.totals?.expenses    || 0
  const totalCapex      = data?.totals?.capex       || 0

  // Burn rate — only meaningful when net negative
  const avgMonthlyNet = sortedMonths.length > 0 ? totalNet / sortedMonths.length : 0
  const burnRate      = avgMonthlyNet < 0 ? Math.abs(avgMonthlyNet) : 0
  const runway        = burnRate > 0 && closingCashYear > 0 ? closingCashYear / burnRate : null

  // Chart data — grouped Revenue vs Expenses (shows both on loss months)
  const chartData = sortedWithCash.map((m: any) => ({
    name:     m.label.split('_')[0].slice(0, 3),
    Revenue:  Math.round(cvt(m.revenue)),
    Expenses: Math.round(cvt(m.expenses)),
  }))

  function exportPL() {
    if (!data) return
    const rows = [
      ['Annual Profit & Loss — ' + selectedYear],
      ['Source: Bank transactions (accountant-approved)'],
      [''],
      ['Month', 'Revenue (USD)', 'Expenses (USD)', 'Net (USD)', 'Opening Cash', 'Closing Cash', 'MoM Growth %'],
      ...sortedWithCash.map((m: any) => [
        m.label.replace('_', ' '),
        m.revenue.toFixed(2),
        m.expenses.toFixed(2),
        m.net.toFixed(2),
        m.openingCash.toFixed(2),
        m.closingCash.toFixed(2),
        m.momGrowth != null ? `${m.momGrowth}%` : '—',
      ]),
      [''],
      ['TOTAL', totalRevenue.toFixed(2), totalExpenses.toFixed(2), totalNet.toFixed(2), openingCashYear.toFixed(2), closingCashYear.toFixed(2), ''],
      ['Operating Margin', `${data.totals.operatingMargin}%`],
    ]
    downloadCSV(rows.map(r => r.join(',')).join('\n'), `Annual_PL_${selectedYear}.csv`)
  }

  function exportExpenses() {
    if (!data) return
    const rows = [
      ['Annual Expense Detail — ' + selectedYear],
      ['Description', 'Bank Account', 'Transactions', 'Total (USD)'],
      ...data.expensesByDescription.map((e: any) => [
        `"${(e.description || '').replace(/"/g, '""')}"`,
        e.account || '',
        e.txCount,
        e.total.toFixed(2),
      ]),
    ]
    downloadCSV(rows.map(r => r.join(',')).join('\n'), `Annual_Expenses_${selectedYear}.csv`)
  }

  return (
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">
            Annual P&amp;L — {selectedYear}
          </h2>
          <p className="text-sm text-narra-muted mt-0.5">
            Actual money in and out of your bank accounts
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <button onClick={exportPL} disabled={!data || loading}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-40">
            ↓ P&amp;L CSV
          </button>
          <button onClick={exportExpenses} disabled={!data || loading}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-40">
            ↓ Expenses CSV
          </button>
          {locked ? (
            <div className="px-4 py-2 bg-green-100 border border-green-300 rounded-lg text-sm text-green-800 font-body">
              ✓ Year Closed
            </div>
          ) : (
            <button onClick={lockYear} disabled={locking || !data || data.totalPeriods === 0}
              className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-40">
              {locking ? 'Locking…' : `Lock ${selectedYear}`}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-48 text-narra-muted text-sm">
          Loading {selectedYear} data…
        </div>
      )}

      {!loading && data && data.totalPeriods === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-700">
          No periods found for {selectedYear}. Make sure bank statements have been imported for this year.
        </div>
      )}

      {!loading && data && data.totalPeriods > 0 && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3 sm:gap-4">

            {/* Total Revenue — dark, clickable */}
            <button onClick={() => { setShowRevenueBreakdown(v => !v); setShowExpenseBreakdown(false) }}
              className="bg-narra-dark rounded-xl p-5 text-left group relative hover:bg-narra-mid transition-colors">
              <div className="text-[10px] text-white/40 uppercase tracking-widest mb-2 font-body">Total Revenue</div>
              <div className="font-heading text-xl font-semibold text-narra-green">{sym}{fmt(cvt(totalRevenue))}</div>
              <div className="text-xs text-white/40 mt-1 group-hover:text-white/60">Tap to see breakdown ↓</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-white border border-narra-border text-narra-dark text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                All client payments that landed in your bank this year.
              </div>
            </button>

            {/* Operating Expenses — dark, clickable */}
            <button onClick={() => { setShowExpenseBreakdown(v => !v); setShowRevenueBreakdown(false) }}
              className="bg-narra-dark rounded-xl p-5 text-left group relative hover:bg-narra-mid transition-colors">
              <div className="text-[10px] text-white/40 uppercase tracking-widest mb-2 font-body">Operating Expenses</div>
              <div className="font-heading text-xl font-semibold text-narra-green">{sym}{fmt(cvt(totalExpenses))}</div>
              <div className="text-xs text-white/40 mt-1 group-hover:text-white/60">Tap to see breakdown ↓</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-white border border-narra-border text-narra-dark text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Day-to-day running costs — salaries, software, marketing. Does not include product build (capex).
              </div>
            </button>

            {/* Product Capex */}
            <div className="bg-white border border-narra-border rounded-xl p-5 relative group">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Product Capex</div>
              <div className="font-heading text-xl font-semibold text-amber-600">{sym}{fmt(cvt(totalCapex))}</div>
              <div className="text-xs text-narra-muted mt-1">Investor-funded build</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Money spent building the product (Stella's GoLaunch work). Funded by investors — not counted in your operating margin.
              </div>
            </div>

            {/* Net Profit */}
            <div className="bg-white border border-narra-border rounded-xl p-5 relative group">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Net Profit</div>
              <div className={`font-heading text-xl font-semibold ${totalNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {totalNet < 0 ? `(${sym}${fmt(Math.abs(cvt(totalNet)))})` : `${sym}${fmt(cvt(totalNet))}`}
              </div>
              <div className="text-xs text-narra-muted mt-1">Revenue minus operating costs</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                What's left after paying all running costs. Product build spend is excluded — this shows your operating profitability.
              </div>
            </div>

            {/* Operating Margin */}
            <div className="bg-white border border-narra-border rounded-xl p-5 relative group">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Operating Margin</div>
              <div className={`font-heading text-xl font-semibold ${parseFloat(data.totals.operatingMargin) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {data.totals.operatingMargin}%
              </div>
              <div className="text-xs text-narra-muted mt-1">Net ÷ Revenue</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                For every dollar you earned, this is how much was profit. 40%+ is healthy for a SaaS business.
              </div>
            </div>

            {/* Opening Cash */}
            <div className="bg-white border border-narra-border rounded-xl p-5 relative group">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Opening Cash</div>
              <div className="font-heading text-xl font-semibold text-narra-dark">{sym}{fmt(cvt(openingCashYear))}</div>
              <div className="text-xs text-narra-muted mt-1">1 Jan {selectedYear}</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                How much money was in your bank at the start of this year, carried over from all previous activity.
              </div>
            </div>

            {/* Closing Cash */}
            <div className="bg-white border border-narra-border rounded-xl p-5 relative group">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">Closing Cash</div>
              <div className={`font-heading text-xl font-semibold ${closingCashYear >= 0 ? 'text-narra-dark' : 'text-red-600'}`}>
                {closingCashYear < 0 ? `(${sym}${fmt(Math.abs(cvt(closingCashYear)))})` : `${sym}${fmt(cvt(closingCashYear))}`}
              </div>
              <div className="text-xs text-narra-muted mt-1">End of {selectedYear}</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Money in your bank at year-end. Opening cash + revenue received + investor deposits − all costs paid.
              </div>
            </div>

          </div>

          {/* Revenue breakdown */}
          {showRevenueBreakdown && data.allTransactions?.filter((t: any) => t.type === 'revenue').length > 0 && (
            <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-narra-border bg-narra-dark flex items-center justify-between">
                <h3 className="font-heading font-semibold text-white text-sm">Revenue Breakdown — {selectedYear}</h3>
                <button onClick={() => setShowRevenueBreakdown(false)} className="text-white/40 hover:text-white text-xs">✕ Close</button>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-narra-light text-narra-muted">
                  {['Date','Description','Account','Amount'].map(h => <th key={h} className="text-left px-4 py-2 font-body font-normal text-xs tracking-widest uppercase">{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.allTransactions.filter((t: any) => t.type === 'revenue').map((t: any, i: number) => (
                    <tr key={i} className="border-t border-narra-border hover:bg-narra-surface">
                      <td className="px-4 py-2.5 font-body text-narra-muted text-xs">{String(t.date).substring(0,10)}</td>
                      <td className="px-4 py-2.5 font-body text-narra-dark max-w-xs truncate">{t.description}</td>
                      <td className="px-4 py-2.5 font-body text-narra-muted text-xs">{t.account || '—'}</td>
                      <td className="px-4 py-2.5 font-heading font-semibold text-green-700">{sym}{fmt(cvt(t.amount_usd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Expense breakdown */}
          {showExpenseBreakdown && data.expensesByDescription?.length > 0 && (
            <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-narra-border bg-narra-dark flex items-center justify-between">
                <h3 className="font-heading font-semibold text-white text-sm">Operating Expense Breakdown — {selectedYear}</h3>
                <button onClick={() => setShowExpenseBreakdown(false)} className="text-white/40 hover:text-white text-xs">✕ Close</button>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-narra-light text-narra-muted">
                  {['Description','Account','Transactions','Total'].map(h => <th key={h} className="text-left px-4 py-2 font-body font-normal text-xs tracking-widest uppercase">{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.expensesByDescription.filter((e: any) => e.total > 0).map((e: any, i: number) => (
                    <tr key={i} className="border-t border-narra-border hover:bg-narra-surface">
                      <td className="px-4 py-2.5 font-body text-narra-dark max-w-xs truncate">{e.description || '—'}</td>
                      <td className="px-4 py-2.5 font-body text-narra-muted text-xs">{e.account || '—'}</td>
                      <td className="px-4 py-2.5 font-body text-narra-muted">{e.txCount}</td>
                      <td className="px-4 py-2.5 font-heading font-semibold text-narra-dark">{sym}{fmt(cvt(e.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Burn rate / runway — only shown when net negative */}
          {burnRate > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-red-700">Avg Monthly Burn Rate</div>
                <div className="text-xs text-red-500 mt-0.5">Average net cash outflow for {selectedYear}</div>
              </div>
              <div className="text-right">
                <div className="font-heading text-2xl font-semibold text-red-600">
                  {sym}{fmt(cvt(burnRate))}/mo
                </div>
                {runway != null && (
                  <div className="text-xs text-red-500 mt-0.5">
                    ~{runway.toFixed(1)} months runway at current burn
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Month status pills */}
          <div className="flex flex-wrap gap-2">
            {sortedMonths.map((m: any) => (
              <div key={m.periodId}
                className={`text-xs px-3 py-1 rounded-full font-body border ${
                  m.locked
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}>
                {m.locked ? '✓' : '○'} {m.label.split('_')[0].slice(0, 3)}
              </div>
            ))}
            <div className="text-xs px-3 py-1 rounded-full bg-narra-light border border-narra-border text-narra-muted font-body">
              {data.lockedCount}/{data.totalPeriods} closed
            </div>
          </div>

          {/* Bar chart — grouped Revenue vs Expenses (shows both even on loss months) */}
          {chartData.length > 0 && (
            <div className="bg-white border border-narra-border rounded-xl p-5">
              <h3 className="font-heading font-semibold text-narra-dark mb-4 text-sm">
                Monthly Revenue vs Expenses
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barGap={2} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#d0e8b8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8aab6e' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#8aab6e' }}
                    tickFormatter={v => `${sym}${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number, name: string) => [`${sym}${fmt(v)}`, name]}
                    contentStyle={{
                      background: '#132a2e',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#c7e995', fontWeight: 600 }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Revenue"  fill="#4ade80" name="Revenue"  radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#ef4444" name="Expenses" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly breakdown table */}
          <div className="bg-white border border-narra-border rounded-xl overflow-hidden overflow-x-auto">
            <div className="px-5 py-3 border-b border-narra-border bg-narra-dark">
              <h3 className="font-heading font-semibold text-white text-sm">Monthly Breakdown</h3>
            </div>
            <table className="w-full text-sm min-w-[780px]">
              <thead>
                <tr className="bg-narra-light text-narra-muted">
                  {['Month', 'Revenue', 'Op. Expenses', 'Capex', 'Net', 'Opening Cash', 'Closing Cash', 'MoM', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-body font-normal text-xs tracking-widest uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedWithCash.map((m: any) => (
                  <tr key={m.periodId} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                    <td className="px-4 py-3 font-body text-narra-dark">{m.label.replace('_', ' ')}</td>
                    <td className="px-4 py-3 font-body text-narra-dark">{sym}{fmt(cvt(m.revenue))}</td>
                    <td className="px-4 py-3 font-body text-red-600">{sym}{fmt(cvt(m.expenses))}</td>
                    <td className="px-4 py-3 font-body text-amber-600">{m.capex > 0 ? `${sym}${fmt(cvt(m.capex))}` : '—'}</td>
                    <td className={`px-4 py-3 font-body font-medium ${m.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {m.net < 0 ? '(' : ''}{sym}{fmt(Math.abs(cvt(m.net)))}{m.net < 0 ? ')' : ''}
                    </td>
                    <td className="px-4 py-3 font-body text-narra-muted">{sym}{fmt(cvt(m.openingCash))}</td>
                    <td className={`px-4 py-3 font-body font-medium ${m.closingCash >= 0 ? 'text-narra-dark' : 'text-red-600'}`}>
                      {m.closingCash < 0 ? '(' : ''}{sym}{fmt(Math.abs(cvt(m.closingCash)))}{m.closingCash < 0 ? ')' : ''}
                    </td>
                    <td className="px-4 py-3 font-body text-xs">
                      {m.momGrowth != null ? (
                        <span className={parseFloat(m.momGrowth) >= 0 ? 'text-green-600' : 'text-red-500'}>
                          {parseFloat(m.momGrowth) >= 0 ? '+' : ''}{m.momGrowth}%
                        </span>
                      ) : (
                        <span className="text-narra-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-body ${
                        m.locked ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {m.locked ? 'Closed' : 'Open'}
                      </span>
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 border-narra-dark bg-narra-light font-semibold">
                  <td className="px-4 py-3 font-heading text-narra-dark">Total</td>
                  <td className="px-4 py-3 font-heading text-narra-dark">{sym}{fmt(cvt(totalRevenue))}</td>
                  <td className="px-4 py-3 font-heading text-red-600">{sym}{fmt(cvt(totalExpenses))}</td>
                  <td className="px-4 py-3 font-heading text-amber-600">{sym}{fmt(cvt(totalCapex))}</td>
                  <td className={`px-4 py-3 font-heading ${totalNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {totalNet < 0 ? '(' : ''}{sym}{fmt(Math.abs(cvt(totalNet)))}{totalNet < 0 ? ')' : ''}
                  </td>
                  <td className="px-4 py-3 font-heading text-narra-muted">{sym}{fmt(cvt(openingCashYear))}</td>
                  <td className={`px-4 py-3 font-heading ${closingCashYear >= 0 ? 'text-narra-dark' : 'text-red-600'}`}>
                    {closingCashYear < 0 ? '(' : ''}{sym}{fmt(Math.abs(cvt(closingCashYear)))}{closingCashYear < 0 ? ')' : ''}
                  </td>
                  <td colSpan={2} className="px-4 py-3 text-xs text-narra-muted font-body">
                    {data.totals.operatingMargin}% margin
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Expense breakdown */}
          {data.expensesByDescription.length > 0 && (
            <div className="bg-white border border-narra-border rounded-xl overflow-hidden overflow-x-auto">
              <div className="px-5 py-3 border-b border-narra-border bg-narra-dark flex items-center justify-between">
                <h3 className="font-heading font-semibold text-white text-sm">Expense Detail</h3>
                <span className="text-xs text-white/40 font-body">
                  {data.expensesByDescription.length} line items
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-narra-light text-narra-muted">
                    {['Description', 'Bank Account', 'Transactions', `Total (${currency})`].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 font-body font-normal text-xs tracking-widest uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.expensesByDescription.map((e: any, i: number) => (
                    <tr key={i} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                      <td className="px-4 py-2.5 font-body text-narra-dark max-w-[300px] truncate">{e.description || '—'}</td>
                      <td className="px-4 py-2.5 font-body text-narra-muted text-xs">{e.account || '—'}</td>
                      <td className="px-4 py-2.5 font-body text-narra-muted">{e.txCount}</td>
                      <td className="px-4 py-2.5 font-body text-narra-dark font-medium">{sym}{fmt(cvt(e.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
