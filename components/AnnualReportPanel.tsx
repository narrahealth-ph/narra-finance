'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { downloadCSV } from '@/lib/csv'
import { fmt, fmtSigned } from '@/lib/format'

const MONTHS_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

export default function AnnualReportPanel({ selectedYear }: { selectedYear: string }) {
  const [data,    setData]    = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [locking, setLocking] = useState(false)
  const [locked,  setLocked]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/annual-report?year=${selectedYear}`, { credentials: 'include' })
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

  function exportPL() {
    if (!data) return
    const rows = [
      ['Annual Profit & Loss — ' + selectedYear, '', ''],
      ['Source: Bank transactions (accountant-approved)', '', ''],
      ['', '', ''],
      ['Month', 'Revenue (USD)', 'Expenses (USD)', 'Net (USD)'],
      ...sortedMonths.map((m: any) => [
        m.label.replace('_', ' '),
        m.revenue.toFixed(2),
        m.expenses.toFixed(2),
        m.net.toFixed(2),
      ]),
      ['', '', '', ''],
      ['TOTAL', data.totals.revenue.toFixed(2), data.totals.expenses.toFixed(2), data.totals.net.toFixed(2)],
      ['Operating Margin', `${data.totals.operatingMargin}%`, '', ''],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    downloadCSV(csv, `Annual_PL_${selectedYear}.csv`)
  }

  function exportExpenses() {
    if (!data) return
    const rows = [
      ['Annual Expense Detail — ' + selectedYear, '', ''],
      ['Description', 'Bank Account', 'Transactions', 'Total (USD)'],
      ...data.expensesByDescription.map((e: any) => [
        `"${(e.description || '').replace(/"/g, '""')}"`,
        e.account || '',
        e.txCount,
        e.total.toFixed(2),
      ]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    downloadCSV(csv, `Annual_Expenses_${selectedYear}.csv`)
  }

  const sortedMonths = data
    ? [...(data.months || [])].sort((a: any, b: any) => {
        const ai = MONTHS_ORDER.indexOf(a.label.split('_')[0])
        const bi = MONTHS_ORDER.indexOf(b.label.split('_')[0])
        return ai - bi
      })
    : []

  const chartData = sortedMonths.map((m: any) => ({
    name:  m.label.split('_')[0].slice(0, 3),
    Costs: Math.round(m.expenses),
    Net:   Math.max(0, Math.round(m.net)), // green only when profitable; 0 hides it on loss months
  }))

  return (
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">
            Cash Flow — {selectedYear}
          </h2>
          <p className="text-sm text-narra-muted mt-0.5">
            Actual money in and out of your bank accounts
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <button
            onClick={exportPL}
            disabled={!data || loading}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-40"
          >
            ↓ P&amp;L CSV
          </button>
          <button
            onClick={exportExpenses}
            disabled={!data || loading}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-40"
          >
            ↓ Expenses CSV
          </button>
          {locked ? (
            <div className="px-4 py-2 bg-green-100 border border-green-300 rounded-lg text-sm text-green-800 font-body">
              ✓ Year Closed
            </div>
          ) : (
            <button
              onClick={lockYear}
              disabled={locking || !data || data.totalPeriods === 0}
              className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-40"
            >
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[
              { label: 'Total Revenue',   value: `$${fmt(data.totals.revenue)}`,   sub: 'Bank receipts',           color: 'text-narra-dark' },
              { label: 'Total Expenses',  value: `$${fmt(data.totals.expenses)}`,  sub: 'Bank payments',           color: 'text-red-600'   },
              { label: 'Net Profit',      value: fmtSigned(data.totals.net),       sub: 'Revenue minus expenses',  color: data.totals.net >= 0 ? 'text-green-700' : 'text-red-600' },
              { label: 'Operating Margin',value: `${data.totals.operatingMargin}%`,sub: 'Net / Revenue',           color: parseFloat(data.totals.operatingMargin) >= 0 ? 'text-green-700' : 'text-red-600' },
            ].map(card => (
              <div key={card.label} className="bg-white border border-narra-border rounded-xl p-5">
                <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">{card.label}</div>
                <div className={`font-heading text-2xl font-semibold ${card.color}`}>{card.value}</div>
                <div className="text-xs text-narra-muted mt-1">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Month status pills */}
          <div className="flex flex-wrap gap-2">
            {sortedMonths.map((m: any) => (
              <div
                key={m.periodId}
                className={`text-xs px-3 py-1 rounded-full font-body border ${
                  m.locked
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
              >
                {m.locked ? '✓' : '○'} {m.label.split('_')[0].slice(0, 3)}
              </div>
            ))}
            <div className="text-xs px-3 py-1 rounded-full bg-narra-light border border-narra-border text-narra-muted font-body">
              {data.lockedCount}/{data.totalPeriods} closed
            </div>
          </div>

          {/* Bar chart */}
          {chartData.length > 0 && (
            <div className="bg-white border border-narra-border rounded-xl p-5">
              <h3 className="font-heading font-semibold text-narra-dark mb-4 text-sm">Monthly Overview</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d0e8b8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8aab6e' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#8aab6e' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number, name: string) => [`$${fmt(v)}`, name]}
                    contentStyle={{ background: '#132a2e', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: '#c7e995', fontWeight: 600 }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {/* Stacked: Costs (red) + Net (green) = Gross Revenue */}
                  <Bar dataKey="Costs" stackId="a" fill="#ef4444" name="Costs" />
                  <Bar dataKey="Net"   stackId="a" fill="#4ade80" name="Net Revenue" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly breakdown table */}
          <div className="bg-white border border-narra-border rounded-xl overflow-hidden overflow-x-auto">
            <div className="px-5 py-3 border-b border-narra-border bg-narra-dark">
              <h3 className="font-heading font-semibold text-white text-sm">Monthly Breakdown</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-narra-light text-narra-muted">
                  {['Month', 'Revenue', 'Expenses', 'Net', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-body font-normal text-xs tracking-widest uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedMonths.map((m: any) => (
                  <tr key={m.periodId} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                    <td className="px-4 py-3 font-body text-narra-dark">{m.label.replace('_', ' ')}</td>
                    <td className="px-4 py-3 font-body text-narra-dark">${fmt(m.revenue)}</td>
                    <td className="px-4 py-3 font-body text-red-600">${fmt(m.expenses)}</td>
                    <td className={`px-4 py-3 font-body font-medium ${m.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {fmtSigned(m.net)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-body ${
                        m.locked
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {m.locked ? 'Closed' : 'Open'}
                      </span>
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 border-narra-dark bg-narra-light font-semibold">
                  <td className="px-4 py-3 font-heading text-narra-dark">Total</td>
                  <td className="px-4 py-3 font-heading text-narra-dark">${fmt(data.totals.revenue)}</td>
                  <td className="px-4 py-3 font-heading text-red-600">${fmt(data.totals.expenses)}</td>
                  <td className={`px-4 py-3 font-heading ${data.totals.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {fmtSigned(data.totals.net)}
                  </td>
                  <td className="px-4 py-3 text-xs text-narra-muted font-body">{data.totals.operatingMargin}% margin</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Expense breakdown */}
          {data.expensesByDescription.length > 0 && (
            <div className="bg-white border border-narra-border rounded-xl overflow-hidden overflow-x-auto">
              <div className="px-5 py-3 border-b border-narra-border bg-narra-dark flex items-center justify-between">
                <h3 className="font-heading font-semibold text-white text-sm">Expense Detail</h3>
                <span className="text-xs text-white/40 font-body">{data.expensesByDescription.length} line items</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-narra-light text-narra-muted">
                    {['Description', 'Bank Account', 'Transactions', 'Total (USD)'].map(h => (
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
                      <td className="px-4 py-2.5 font-body text-narra-dark font-medium">${fmt(e.total)}</td>
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
