'use client'
import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { fmt, shortLabel } from '@/lib/format'
import { downloadCSV } from '@/lib/csv'

// totalInvested comes from the API (sum of all 'investment' bank transactions)

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

/** Properly escape a CSV cell: wrap in quotes if it contains comma, quote, or newline */
function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '')
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function csvRow(...cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

async function handleExport() {
  const res  = await fetch('/api/investor-export', { credentials: 'include' })
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  const d    = await res.json()

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  // 1 — Summary KPIs (values are plain numbers so Excel formats them; notes quoted if needed)
  const s = d.summary
  const summaryRows = [
    csvRow('Metric', 'Value (USD)', 'Notes'),
    csvRow('Current MRR',           Math.round(s.currentMrr),  'Accrual MRR from invoice tracker (current month)'),
    csvRow('Avg Monthly Revenue (3mo)', Math.round(s.avgRevenue), 'Average accrual MRR over last 3 months'),
    csvRow('Avg Monthly Burn',      Math.round(s.avgBurn),      'Average operating expenses over last 3 months'),
    csvRow('Runway (months)',        s.runway ?? 'N/A',          'Cash ÷ avg monthly burn'),
    csvRow('Cash Position',          Math.round(s.cashPosition), 'Opening balance + all revenue + investment - all costs'),
    csvRow('Total Revenue Earned',   Math.round(s.totalRevenue), 'All cash received since inception'),
    csvRow('Total Raised',           Math.round(s.totalRaised),  'Founder investments (Rene + Mike)'),
    csvRow('Active Clients',         s.activeClients,            'From client registry'),
  ].join('\n')
  downloadCSV(summaryRows, '1_Summary_KPIs.csv')
  await delay(150)

  // 2 — MRR History
  const mrrLines = [
    csvRow('Month', 'Accrual MRR (USD)', 'Cash Revenue (USD)', 'Operating Burn (USD)', 'Net (USD)'),
    ...d.mrrHistory.map((m: any) =>
      csvRow(m.month, m.mrr, m.cashRevenue, m.burn, m.net)
    ),
  ].join('\n')
  downloadCSV(mrrLines, '2_MRR_History.csv')
  await delay(150)

  // 3 — Client Breakdown
  const totalMrr = d.clientBreakdown.reduce((s: number, c: any) => s + c.mrr, 0)
  const clientLines = [
    csvRow('Client', 'Monthly MRR (USD)', '% of Total MRR'),
    ...d.clientBreakdown.map((c: any) => csvRow(c.name, c.mrr, `${c.pct}%`)),
    csvRow('Total', totalMrr, '100%'),
  ].join('\n')
  downloadCSV(clientLines, '3_Client_Breakdown.csv')
  await delay(150)

  // 4 — Cash Flow
  const cfLines = [
    csvRow('Year', 'Month', 'Cash Revenue', 'Operating Expenses', 'Capex', 'Founder Investment', 'Net Operating', 'Opening Cash', 'Closing Cash'),
    ...d.cashFlow.map((r: any) =>
      csvRow(r.year, r.month, r.revenue, r.expenses, r.capex, r.investment, r.netOperating, r.openingCash, r.closingCash)
    ),
  ].join('\n')
  downloadCSV(cfLines, '4_Cash_Flow.csv')
  await delay(150)

  // 5 — Expenses by Category (sorted by category then total desc)
  const CATEGORY_ORDER = [
    'Contractor Salaries',
    'Product Capex',
    'SaaS & Subscriptions',
    'Admin & Company Secretary',
    'Team Healthcare',
    'Bank & Transfer Fees',
    'Team & Events',
    'Other',
  ]
  const sortedExpenses = [...d.expensesByCategory].sort((a: any, b: any) => {
    const ci = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    if (ci !== 0) return ci
    return b.total - a.total
  })
  const expLines = [
    csvRow('Category', 'Description', 'Account', 'Total (USD)', 'Transactions'),
    ...sortedExpenses.map((e: any) =>
      csvRow(e.category, e.description, e.account, e.total, e.txCount)
    ),
  ].join('\n')
  downloadCSV(expLines, '5_Expenses_by_Category.csv')
  await delay(150)

  // 6 — Pipeline
  const pipeLines = [
    csvRow('Client', 'Invoice Amount', 'Billing Type', 'Potential ARR', 'Potential MRR', 'Notes'),
    ...d.pipeline.map((p: any) =>
      csvRow(p.client, p.amount, p.billingType, p.potentialArr, p.potentialMrr, p.notes)
    ),
  ].join('\n')
  downloadCSV(pipeLines, '6_Pipeline.csv')
}

export default function InvestorPanel({ currency = 'USD' }: { currency?: 'USD' | 'SGD' }) {
  const [data,        setData]        = useState<any>(null)
  const [loading,     setLoading]     = useState(true)
  const [exporting,   setExporting]   = useState(false)
  const [sheetClients, setSheetClients] = useState<any[]>([])
  const [sheetUnmatched, setSheetUnmatched] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/investor-summary', { credentials: 'include' })
      .then(r => r.ok ? r.json() : r.json().catch(() => null))
      .then(d => { if (d && !d.error) setData(d) })
      .catch(err => console.error('investor-summary fetch error:', err))
      .finally(() => setLoading(false))
    fetch('/api/clients', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setSheetClients(d.clients || [])
        setSheetUnmatched(d.unmatchedNames || [])
      })
  }, [])

  const months         = data?.months         || []
  const clients        = data?.clients        || []
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
  // Accrual MRR avg — last 3 months from invoice sheet
  const last3Mrr   = months.slice(-3)
  const avgMrr     = last3Mrr.length > 0
    ? Math.round(last3Mrr.reduce((s: number, m: any) => s + (m.mrr || 0), 0) / last3Mrr.length)
    : 0
  const arr        = avgMrr * 12
  const mrrMonths  = last3Mrr.map((m: any) => m.label)

  const totalInvested      = data?.totalInvested      || 0
  const investmentTotals   = data?.investmentTotals   || { rene: 0, mike: 0, total: 0 }
  const sheetTotalRaised   = investmentTotals.total   || totalInvested

  // Currency conversion
  const sgdRate = data?.sgdRate || 0.74
  const cvt = (n: number) => currency === 'SGD' ? (n || 0) / sgdRate : (n || 0)
  const sym = currency === 'SGD' ? 'S$' : '$'

  // Sheet-based client breakdown (replaces mrr_entries paying clients)
  const activeSheetClients = sheetClients
    .filter(c => c.ltv > 0 && c.active)
    .sort((a: any, b: any) => b.ltv - a.ltv)
  const unmatchedTotal = sheetUnmatched.reduce((s: number, u: any) => s + Math.round(u.total), 0)
  const sheetGrandTotal = activeSheetClients.reduce((s: number, c: any) => s + c.ltv, 0) + unmatchedTotal

  const revenueVsInvested = totalInvested > 0
    ? Math.min(100, Math.round((totalRevenue / totalInvested) * 100))
    : 0

  const chartData = months.map((m: any) => ({
    name:       shortLabel(m.label),
    MRR:        Math.round(m.mrr),        // accrual revenue — use this as primary
    'Cash In':  Math.round(m.cashRevenue), // actual bank deposits (may be $0 for annual billing months)
    Burn:       Math.round(m.burn),
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Business Overview</h2>
          <p className="text-narra-muted text-sm mt-0.5">Live data · Narra Health PTE. LTD.</p>
        </div>
        <button
          disabled={exporting}
          onClick={async () => {
            setExporting(true)
            try { await handleExport() }
            catch (err) { console.error('investor export error:', err) }
            finally { setExporting(false) }
          }}
          className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-40 whitespace-nowrap shrink-0"
        >
          {exporting ? 'Exporting…' : '↓ Investor Export'}
        </button>
      </div>

      {/* Data coverage banner */}
      <div className={`rounded-xl px-5 py-4 border text-sm font-body ${missingMonths.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-6">
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
          <div className="font-heading text-2xl sm:text-3xl font-light text-white">{sym}{fmt(cvt(sheetTotalRaised))}</div>
          <div className="text-white/30 text-xs font-body">Invested by founders across both rounds</div>
          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/40 font-body space-y-1">
            <div className="flex justify-between"><span>Rene</span><span className="text-white/60">{sym}{fmt(cvt(investmentTotals.rene))}</span></div>
            <div className="flex justify-between"><span>Mike</span><span className="text-white/60">{sym}{fmt(cvt(investmentTotals.mike))}</span></div>
          </div>
        </div>

        {/* Revenue earned back */}
        <div className="bg-narra-dark border border-white/10 rounded-2xl p-6 flex flex-col gap-2">
          <div className="text-white/40 text-xs uppercase tracking-widest font-body">Total Revenue Earned</div>
          <div className="font-heading text-2xl sm:text-3xl font-light text-narra-green">{sym}{fmt(cvt(totalRevenue))}</div>
          <div className="text-white/30 text-xs font-body">
            All cash received from clients
            {earliestBank && latestBank && (
              <span> · {fmtDate(earliestBank)} – {fmtDate(latestBank)}</span>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/40 font-body space-y-1">
            <div className="flex justify-between"><span>Cash in bank</span><span className="text-narra-green">{sym}{fmt(cvt(cashPosition))}</span></div>
            <div className="flex justify-between"><span>Runway</span><span className="text-white/60">{runway !== null ? `${runway} months` : '—'}</span></div>
          </div>
        </div>

        {/* What was built */}
        <div className="bg-narra-dark border border-white/10 rounded-2xl p-6 flex flex-col gap-2">
          <div className="text-white/40 text-xs uppercase tracking-widest font-body">What Was Built</div>
          <div className="font-heading text-xl sm:text-2xl font-light text-white leading-tight">A working product with paying clients</div>
          <div className="mt-auto pt-3 border-t border-white/10 text-xs text-white/40 font-body space-y-1">
            <div className="flex justify-between"><span>Active clients</span><span className="text-white/60">{activeClients}</span></div>
            <div className="flex justify-between"><span>Monthly recurring</span><span className="text-narra-green">{sym}{fmt(cvt(data?.currentMrr || 0))}/mo</span></div>
          </div>
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-narra-border rounded-2xl p-5">
          <div className="text-narra-muted text-xs uppercase tracking-widest font-body mb-2 flex items-center">
            Avg Monthly Revenue
            <KpiTooltip text="Accrual MRR averaged over the last 3 months, calculated from the invoice sheet. Spreads annual/quarterly contracts into monthly amounts — more stable than cash deposits." />
          </div>
          <div className="font-heading text-2xl font-semibold text-narra-green">{sym}{fmt(cvt(avgMrr))}</div>
          <div className="text-narra-muted text-xs mt-1 font-body">
            {mrrMonths.length > 0
              ? `Accrual MRR · avg of ${mrrMonths.map(fmtMonth).join(', ')}`
              : 'No MRR data yet'}
          </div>
        </div>

        <div className="bg-white border border-narra-border rounded-2xl p-5">
          <div className="text-narra-muted text-xs uppercase tracking-widest font-body mb-2 flex items-center">
            Annual Run Rate
            <KpiTooltip text="Your average monthly revenue multiplied by 12. This projects your current pace over a full year — it is not actual annual revenue." />
          </div>
          <div className="font-heading text-2xl font-semibold text-narra-dark">{sym}{fmt(cvt(arr))}</div>
          <div className="text-narra-muted text-xs mt-1 font-body">Accrual MRR × 12</div>
        </div>

        <div className="bg-white border border-narra-border rounded-2xl p-5">
          <div className="text-narra-muted text-xs uppercase tracking-widest font-body mb-2 flex items-center">
            Avg Monthly Spend
            <KpiTooltip text="Average amount spent per month based on your last 3 months of bank outflows. Includes all company expenses paid from the bank." />
          </div>
          <div className="font-heading text-2xl font-semibold text-red-500">{sym}{fmt(cvt(avgBurn))}</div>
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
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} tickFormatter={v => `${sym}${(cvt(v)/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number, name: string) => [`${sym}${fmt(cvt(v))}`, name]}
                contentStyle={{ background: '#0d2b30', border: '1px solid rgba(199,233,149,0.2)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#c7e995' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }} />
              <Bar dataKey="MRR"     fill="#c7e995" radius={[3,3,0,0]} />
              <Bar dataKey="Burn"   fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}


      {/* Client breakdown — from outgoing invoice sheet */}
      {activeSheetClients.length > 0 && (
        <div className="bg-white border border-narra-border rounded-2xl p-6">
          <h3 className="font-heading text-lg font-semibold text-narra-dark mb-1">Client Revenue</h3>
          <p className="text-narra-muted text-xs mb-5 font-body">
            All-time total invoiced per client · sent &amp; paid invoices only
          </p>
          <div className="space-y-3">
            {activeSheetClients.map((c: any) => {
              const pct = sheetGrandTotal > 0 ? (c.ltv / sheetGrandTotal) * 100 : 0
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="text-narra-dark text-sm font-body w-28 sm:w-40 truncate shrink-0">{c.name}</span>
                  <div className="flex-1 h-1.5 bg-narra-border rounded-full overflow-hidden min-w-0">
                    <div className="h-full bg-narra-green rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-narra-muted text-xs w-10 text-right shrink-0">{pct.toFixed(1)}%</span>
                  <span className="text-narra-dark font-body text-sm w-20 sm:w-24 text-right shrink-0">{sym}{fmt(cvt(c.ltv))}</span>
                </div>
              )
            })}
            {unmatchedTotal > 0 && (
              <div className="flex items-center gap-3 opacity-50">
                <span className="text-amber-700 text-sm font-body w-28 sm:w-40 truncate shrink-0 italic">Unmatched</span>
                <div className="flex-1 h-1.5 bg-amber-200 rounded-full overflow-hidden min-w-0">
                  <div className="h-full bg-amber-400 rounded-full" style={{ width: `${sheetGrandTotal > 0 ? (unmatchedTotal / sheetGrandTotal) * 100 : 0}%` }} />
                </div>
                <span className="text-narra-muted text-xs w-10 text-right shrink-0">{sheetGrandTotal > 0 ? ((unmatchedTotal / sheetGrandTotal) * 100).toFixed(1) : 0}%</span>
                <span className="text-amber-700 font-body text-sm w-20 sm:w-24 text-right shrink-0">{sym}{fmt(cvt(unmatchedTotal))}</span>
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-narra-border flex justify-between">
            <span className="text-narra-muted text-sm font-body">Total invoiced (all time)</span>
            <span className="text-narra-dark font-heading font-semibold">{sym}{fmt(cvt(sheetGrandTotal))}</span>
          </div>
        </div>
      )}

      {/* Cash position */}
      <div className="bg-white border border-narra-border rounded-2xl p-6">
        <h3 className="font-heading text-lg font-semibold text-narra-dark mb-1">Cash Position</h3>
        <p className="text-narra-muted text-xs mb-5 font-body">
          Total in company bank accounts · all time (opening balance + revenue + investments − expenses)
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className={`font-heading text-2xl sm:text-3xl lg:text-4xl font-light ${cashPosition >= 0 ? 'text-narra-dark' : 'text-red-500'}`}>
            {cashPosition < 0 ? '(' : ''}{sym}{fmt(Math.abs(cvt(cashPosition)))}{cashPosition < 0 ? ')' : ''}
          </div>
          {runway !== null && (
            <div className="text-narra-muted text-sm pb-1 font-body">
              · {runway} months runway at current spend
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
