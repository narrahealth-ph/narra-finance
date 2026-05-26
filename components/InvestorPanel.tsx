'use client'
import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { fmt, shortLabel } from '@/lib/format'

const TOTAL_INVESTED_USD = 60000 // $30k Mike + $30k Rene

function KpiTooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-block ml-1.5 align-middle">
      <span className="text-narra-muted/50 text-xs cursor-help select-none border border-narra-border rounded-full w-4 h-4 inline-flex items-center justify-center leading-none">?</span>
      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-narra-dark" />
      </div>
    </div>
  )
}

function fmtMonth(label: string) {
  if (!label) return ''
  const [month, year] = label.split('_')
  return `${month.slice(0, 3)} ${year}`
}

function fmtDate(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function InvestorPanel() {
  const [data,    setData]    = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/investor-summary', { credentials: 'include' })
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  const months         = data?.months         || []
  const clients        = data?.clients        || []
  const avgRevenue     = data?.avgRevenue     || 0
  const arr            = data?.arr            || 0
  const avgBurn        = data?.avgBurn        || 0
  const cashPosition   = data?.cashPosition   || 0
  const runway         = data?.runway
  const totalRevenue   = data?.totalRevenue   || 0
  const activeClients  = data?.activeClients  || 0
  const totalClientMrr = clients.reduce((s: number, c: any) => s + c.mrr, 0)
  const missingMonths  = data?.missingMonths  || []
  const earliestBank   = data?.earliestBank   || null
  const latestBank     = data?.latestBank     || null
  const mrrMonth       = data?.mrrMonth       || null
  const revenueMonths  = data?.revenueMonths  || []
  const burnMonths     = data?.burnMonths     || []

  const revenueVsInvested = TOTAL_INVESTED_USD > 0
    ? Math.min(100, Math.round((totalRevenue / TOTAL_INVESTED_USD) * 100))
    : 0

  const chartData = months.map((m: any) => ({
    name:    shortLabel(m.label),
    MRR:     Math.round(m.mrr),
    Revenue: Math.round(m.cashRevenue),
    Burn:    Math.round(m.burn),
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-narra-muted text-sm animate-pulse">
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">

      {/* Title */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-heading text-2xl font-light text-narra-dark">Business Overview</h2>
          <p className="text-narra-muted text-sm mt-1">Live data · Narra Health PTE. LTD. · Confidential</p>
        </div>
      </div>

      {/* Data coverage banner */}
      <div className={`rounded-xl px-5 py-4 border text-sm font-body ${missingMonths.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
        <div className="flex items-start justify-between gap-6">
          <div>
            <span className={`font-medium ${missingMonths.length > 0 ? 'text-amber-800' : 'text-green-800'}`}>
              {missingMonths.length > 0 ? '⚠ Bank statements may be incomplete' : '✓ Bank data looks up to date'}
            </span>
            {earliestBank && latestBank && (
              <span className={`ml-2 ${missingMonths.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                · Imported data covers {fmtDate(earliestBank)} – {fmtDate(latestBank)}
              </span>
            )}
            {missingMonths.length > 0 && (
              <div className="mt-1 text-amber-700 text-xs">
                No bank transactions found for: <strong>{missingMonths.join(', ')}</strong>. Go to Bank Import to upload these statements.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The Story — 3 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Invested */}
        <div className="bg-narra-dark border border-white/10 rounded-2xl p-6 flex flex-col gap-2">
          <div className="text-white/40 text-xs uppercase tracking-widest font-body">Total Raised</div>
          <div className="font-heading text-3xl font-light text-white">${fmt(TOTAL_INVESTED_USD)}</div>
          <div className="text-white/30 text-xs font-body">Invested by founders to build the product</div>
          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/40 font-body space-y-1">
            <div className="flex justify-between"><span>Mike</span><span className="text-white/60">$30,000</span></div>
            <div className="flex justify-between"><span>Rene</span><span className="text-white/60">$30,000</span></div>
          </div>
        </div>

        {/* Revenue earned back */}
        <div className="bg-narra-dark border border-white/10 rounded-2xl p-6 flex flex-col gap-2">
          <div className="text-white/40 text-xs uppercase tracking-widest font-body">Total Revenue Earned</div>
          <div className="font-heading text-3xl font-light text-narra-green">${fmt(totalRevenue)}</div>
          <div className="text-white/30 text-xs font-body">
            All cash received from clients
            {earliestBank && latestBank && (
              <span> · {fmtDate(earliestBank)} – {fmtDate(latestBank)}</span>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-white/40">Recovered</span>
              <span className="text-narra-green">{revenueVsInvested}% of investment</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-narra-green rounded-full transition-all" style={{ width: `${revenueVsInvested}%` }} />
            </div>
          </div>
        </div>

        {/* What was built */}
        <div className="bg-narra-dark border border-white/10 rounded-2xl p-6 flex flex-col gap-2">
          <div className="text-white/40 text-xs uppercase tracking-widest font-body">What Was Built</div>
          <div className="font-heading text-2xl font-light text-white leading-tight">A working product with paying clients</div>
          <div className="mt-auto pt-3 border-t border-white/10 text-xs text-white/40 font-body space-y-1">
            <div className="flex justify-between"><span>Active clients</span><span className="text-white/60">{activeClients}</span></div>
            <div className="flex justify-between"><span>Monthly recurring</span><span className="text-narra-green">${fmt(avgRevenue)}/mo</span></div>
          </div>
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-narra-border rounded-2xl p-5">
          <div className="text-narra-muted text-xs uppercase tracking-widest font-body mb-2 flex items-center">
            Avg Monthly Revenue
            <KpiTooltip text="Average cash actually received from clients per month, based on your last 3 months of bank deposits." />
          </div>
          <div className="font-heading text-2xl font-semibold text-narra-green">${fmt(avgRevenue)}</div>
          <div className="text-narra-muted text-xs mt-1 font-body">
            {revenueMonths.length > 0
              ? `Avg of ${revenueMonths.map(fmtMonth).join(', ')}`
              : 'No bank revenue data yet'}
          </div>
        </div>

        <div className="bg-white border border-narra-border rounded-2xl p-5">
          <div className="text-narra-muted text-xs uppercase tracking-widest font-body mb-2 flex items-center">
            Annual Run Rate
            <KpiTooltip text="Your average monthly revenue multiplied by 12. This projects your current pace over a full year — it is not actual annual revenue." />
          </div>
          <div className="font-heading text-2xl font-semibold text-narra-dark">${fmt(arr)}</div>
          <div className="text-narra-muted text-xs mt-1 font-body">Avg monthly revenue × 12</div>
        </div>

        <div className="bg-white border border-narra-border rounded-2xl p-5">
          <div className="text-narra-muted text-xs uppercase tracking-widest font-body mb-2 flex items-center">
            Avg Monthly Spend
            <KpiTooltip text="Average amount spent per month based on your last 3 months of bank outflows. Includes all company expenses paid from the bank." />
          </div>
          <div className="font-heading text-2xl font-semibold text-red-500">${fmt(avgBurn)}</div>
          <div className="text-narra-muted text-xs mt-1 font-body">
            {burnMonths.length > 0
              ? `Avg of ${burnMonths.map(fmtMonth).join(', ')}`
              : 'No expense data — upload bank statements'}
          </div>
        </div>

        <div className="bg-white border border-narra-border rounded-2xl p-5">
          <div className="text-narra-muted text-xs uppercase tracking-widest font-body mb-2 flex items-center">
            Runway
            <KpiTooltip text="How many months the company can keep operating before running out of money, at the current spending rate. Calculated as: cash in bank ÷ average monthly spend." />
          </div>
          <div className={`font-heading text-2xl font-semibold ${runway !== null && runway < 6 ? 'text-red-500' : 'text-narra-dark'}`}>
            {runway !== null ? `${runway} months` : '—'}
          </div>
          <div className="text-narra-muted text-xs mt-1 font-body">
            {runway !== null ? 'Cash in bank ÷ monthly spend' : 'Upload bank statements to calculate'}
          </div>
        </div>
      </div>

      {/* Revenue & Burn chart */}
      {chartData.length > 0 && (
        <div className="bg-narra-dark border border-white/10 rounded-2xl p-6">
          <h3 className="font-heading text-lg font-light text-white mb-1">Revenue vs Monthly Spend</h3>
          <p className="text-white/30 text-xs mb-5 font-body">
            Actual cash in and out · {earliestBank && latestBank ? `${fmtDate(earliestBank)} – ${fmtDate(latestBank)}` : 'Last 18 months'}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number, name: string) => [`$${fmt(v)}`, name]}
                contentStyle={{ background: '#0d2b30', border: '1px solid rgba(199,233,149,0.2)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#c7e995' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }} />
              <Bar dataKey="Revenue" fill="#c7e995" radius={[3,3,0,0]} />
              <Bar dataKey="Burn"    fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* MRR growth line */}
      {chartData.some((d: any) => d.MRR > 0) && (
        <div className="bg-narra-dark border border-white/10 rounded-2xl p-6">
          <h3 className="font-heading text-lg font-light text-white mb-1">Contracted Revenue Growth</h3>
          <p className="text-white/30 text-xs mb-5 font-body">Monthly recurring revenue from signed client contracts</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} tickFormatter={v => `$${(v/1000).toFixed(1)}k`} />
              <Tooltip
                formatter={(v: number) => [`$${fmt(v)}`, 'MRR']}
                contentStyle={{ background: '#0d2b30', border: '1px solid rgba(199,233,149,0.2)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#c7e995' }}
              />
              <Line type="monotone" dataKey="MRR" stroke="#c7e995" strokeWidth={2.5} dot={{ fill: '#c7e995', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Client breakdown */}
      {clients.length > 0 && (
        <div className="bg-white border border-narra-border rounded-2xl p-6">
          <h3 className="font-heading text-lg font-semibold text-narra-dark mb-1">Paying Clients</h3>
          <p className="text-narra-muted text-xs mb-5 font-body">
            Revenue share · {mrrMonth ? fmtMonth(mrrMonth) : 'latest month with data'}
          </p>
          <div className="space-y-3">
            {clients.map((c: any) => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="text-narra-dark text-sm font-body w-28 sm:w-40 truncate shrink-0">{c.name}</span>
                <div className="flex-1 h-1.5 bg-narra-border rounded-full overflow-hidden min-w-0">
                  <div className="h-full bg-narra-green rounded-full" style={{ width: `${c.pct}%` }} />
                </div>
                <span className="text-narra-muted text-xs w-8 text-right shrink-0">{c.pct}%</span>
                <span className="text-narra-dark font-body text-sm w-16 sm:w-20 text-right shrink-0">${fmt(c.mrr)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-narra-border flex justify-between">
            <span className="text-narra-muted text-sm font-body">Total monthly recurring</span>
            <span className="text-narra-green font-heading font-semibold">${fmt(totalClientMrr)}</span>
          </div>
        </div>
      )}

      {/* Cash position */}
      <div className="bg-white border border-narra-border rounded-2xl p-6">
        <h3 className="font-heading text-lg font-semibold text-narra-dark mb-1">Cash Position</h3>
        <p className="text-narra-muted text-xs mb-5 font-body">
          Total in company bank accounts · all time (opening balance + revenue − expenses)
        </p>
        <div className="flex items-end gap-4">
          <div className={`font-heading text-4xl font-light ${cashPosition >= 0 ? 'text-narra-dark' : 'text-red-500'}`}>
            {cashPosition < 0 ? '(' : ''}${fmt(Math.abs(cashPosition))}{cashPosition < 0 ? ')' : ''}
          </div>
          {runway !== null && (
            <div className="text-narra-muted text-sm pb-1 font-body">
              · {runway} months runway at current spend
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-narra-muted text-xs pb-6 font-body">
        This information is confidential and intended solely for Narra Health investors. Do not distribute.
      </p>
    </div>
  )
}
