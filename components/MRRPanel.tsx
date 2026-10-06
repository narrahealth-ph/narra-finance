'use client'
import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'
import { downloadCSV, toCSV } from '@/lib/csv'
import { fmt } from '@/lib/format'
import { AlertTriangle, ClipboardList, Target } from 'lucide-react'

type ProjectedBreakdown = { total: number; activeContracts: number; carryOver: number; autoRenewed: number; pipeline: number; activeClients: string[]; carryOverClients: string[]; autoRenewedClients: string[]; pipelineClients: string[]; expiredClients: string[]; newClients: string[] }
type HistoryPoint = { month: string; confirmed: number | null; pending: number; costs: number; net: number; bankCashIn?: number; projected?: number; projectedBreakdown?: ProjectedBreakdown; forecastedCost?: number }
type PendingInvoice = { invoiceId: string; clientName: string; amount: number; issueDate: string; daysOutstanding: number; billingType: string }
type PipelineInvoice = { invoiceId: string; clientName: string; amount: number; issueDate: string; billingType: string; notes?: string }
type Client = { invoiceId?: string; name: string; annualAmount: number; seats: number; billingType: string; issueDate?: string; isNew: boolean; isPending: boolean; isOneOff: boolean; isCarryover?: boolean; countedInMrr?: boolean }

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

const TOOLTIP_META: Record<string, { label: string; note?: string }> = {
  confirmed:      { label: 'Confirmed MRR',    note: 'Paid & partial/pending invoices' },
  projected:      { label: 'Projected MRR',    note: 'Renewals (100%) + pipeline (10%)' },
  pipeline:       { label: 'Pipeline MRR',     note: 'Sales-sent invoices at full value' },
  costs:          { label: 'Actual Costs',     note: 'From bank transactions' },
  forecastedCost: { label: 'Forecasted Costs', note: 'From Monthly Forecast P&L' },
}

function ClientList({ title, clients, max = 8 }: { title: string; clients: string[]; max?: number }) {
  if (!clients.length) return null
  const shown = clients.slice(0, max)
  const rest  = clients.length - shown.length
  return (
    <div className="mt-1">
      <p className="text-white/50 mb-0.5">{title} ({clients.length}):</p>
      {shown.map((c, i) => <p key={i} className="text-white/70 truncate">· {c}</p>)}
      {rest > 0 && <p className="text-white/40">+{rest} more</p>}
    </div>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((e: any) => e.value != null && e.value !== 0)
  if (!visible.length) return null
  const point     = payload[0]?.payload
  const breakdown = point?.projectedBreakdown as ProjectedBreakdown | undefined
  return (
    <div className="bg-narra-dark border border-white/20 rounded-xl p-3 text-xs shadow-xl min-w-[200px] max-w-[260px]">
      <p className="text-narra-green font-heading font-semibold mb-2">{label}</p>
      {visible.map((entry: any) => {
        const meta = TOOLTIP_META[entry.dataKey] || { label: entry.name }
        return (
          <div key={entry.dataKey} className="flex justify-between gap-4 mb-1">
            <span className="flex items-center gap-1.5 text-white">
              <span style={{ background: entry.color }} className="inline-block w-2 h-2 rounded-full flex-shrink-0" />
              {meta.label}
            </span>
            <span className="text-white font-medium">${Number(entry.value).toLocaleString()}</span>
          </div>
        )
      })}
      {breakdown && point?.projected != null && (
        <div className="mt-1.5 border-t border-white/10 pt-1.5 space-y-1.5">
          {breakdown.activeContracts > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Active contracts</span>
              <span className="text-white/80">${breakdown.activeContracts.toLocaleString()}</span>
            </div>
          )}
          {breakdown.carryOver > 0 && (
            <div>
              <div className="flex justify-between gap-4">
                <span className="text-white/60">Carrying over</span>
                <span className="text-white/80">${breakdown.carryOver.toLocaleString()}</span>
              </div>
              {breakdown.carryOverClients.map((c, i) => (
                <p key={i} className="text-white/40 truncate ml-2">· {c}</p>
              ))}
            </div>
          )}
          {breakdown.autoRenewed > 0 && (
            <div>
              <div className="flex justify-between gap-4">
                <span className="text-white/60">Renewals this month</span>
                <span className="text-white/80">${breakdown.autoRenewed.toLocaleString()}</span>
              </div>
              {breakdown.autoRenewedClients.map((c, i) => (
                <p key={i} className="text-white/40 truncate ml-2">· {c}</p>
              ))}
            </div>
          )}
          {breakdown.pipeline > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Pipeline (10%)</span>
              <span className="text-white/80">${breakdown.pipeline.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
      {breakdown && point?.projected == null && (breakdown.newClients.length > 0 || breakdown.expiredClients.length > 0) && (
        <div className="mt-1.5 border-t border-white/10 pt-1.5 space-y-0.5">
          <ClientList title="New this month"   clients={breakdown.newClients} />
          <ClientList title="Contracts ended"  clients={breakdown.expiredClients} />
        </div>
      )}
    </div>
  )
}

export default function MRRPanel({ periodId, data, onRefresh, selectedMonth, refreshKey, fxRates }: {
  periodId: number; data: any; onRefresh: () => void; selectedMonth?: string; refreshKey?: number; fxRates?: any[]
}) {
  const [history,         setHistory]         = useState<HistoryPoint[]>(FALLBACK_HISTORY)
  const [historyLoading,  setHistoryLoading]  = useState(true)
  const [clients,         setClients]         = useState<Client[]>([])
  const [pendingInvoices,  setPendingInvoices]  = useState<PendingInvoice[]>([])
  const [pipelineInvoices, setPipelineInvoices] = useState<PipelineInvoice[]>([])
  const [activeTab,        setActiveTab]        = useState<'outgoing' | 'incoming' | 'pending' | 'pipeline'>('outgoing')
  const [incomingInvoices, setIncomingInvoices] = useState<any[]>([])
  const [dbClients,        setDbClients]        = useState<any[]>([])
  const [overrides,        setOverrides]        = useState<Record<string, string>>({})
  const [editingInvoice,   setEditingInvoice]   = useState<{ invoiceId: string; currentName: string } | null>(null)
  const [editName,         setEditName]         = useState('')
  const [syncing,         setSyncing]         = useState(false)
  const [syncResult,      setSyncResult]      = useState<any>(null)
  const [chartView,    setChartView]    = useState<string>(new Date().getFullYear().toString())
  const [periodView,   setPeriodView]   = useState<'month' | 'year'>('year')
  const [yearTotals,   setYearTotals]   = useState<Record<number, { mrr: number; costs: number; net: number }>>({})
  const [totalInvoicedByYear,      setTotalInvoicedByYear]      = useState<Record<number, number>>({})
  const [totalWithPipelineByYear,  setTotalWithPipelineByYear]  = useState<Record<number, number>>({})
  const [bankReceivedByYear,   setBankReceivedByYear]   = useState<Record<number, number>>({})
  const [invoicedCostsByYear,  setInvoicedCostsByYear]  = useState<Record<number, number>>({})
  const [investmentByYear,     setInvestmentByYear]     = useState<Record<number, number>>({})
  const [openingCash,          setOpeningCash]          = useState<number>(0)
  const [sheetRefreshKey,      setSheetRefreshKey]      = useState(0)
  const [excludedCarryOver,    setExcludedCarryOver]    = useState<Set<string>>(new Set())
  const [showCashDetail,       setShowCashDetail]       = useState(false)
  const [cashDetailRows,       setCashDetailRows]       = useState<any[]>([])
  const [cashDetailLoading,    setCashDetailLoading]    = useState(false)
  const [displayCurrency,      setDisplayCurrency]      = useState<'USD' | 'SGD'>('USD')
  const [sortCol,              setSortCol]              = useState<string>('issueDate')
  const [sortDir,              setSortDir]              = useState<'asc' | 'desc'>('asc')
  const [annualData,           setAnnualData]           = useState<any>(null)
  const [showRevenueBreakdown, setShowRevenueBreakdown] = useState(false)
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false)
  const [projectedMrr,         setProjectedMrr]         = useState<number>(0)
  const selectedYear = selectedMonth?.split('_')[1] || '2026'

  // Currency conversion
  const sgdRate = fxRates?.find((r: any) => r.currency === 'SGD')?.rate || 0.74
  const cvt = (n: number) => displayCurrency === 'SGD' ? (n || 0) / sgdRate : (n || 0)
  const sym = displayCurrency === 'SGD' ? 'S$' : '$'

  // ── Load history + client breakdown from Google Sheet ──────────────────────
  useEffect(() => {
    setHistoryLoading(true)
    setClients([])
    const yearView = periodView === 'year'
    const excludeParam = excludedCarryOver.size > 0 ? `&excludeCarryOver=${encodeURIComponent([...excludedCarryOver].join(','))}` : ''
    fetch(`/api/mrr/history?month=${encodeURIComponent(selectedMonth || '')}&yearView=${yearView}${excludeParam}`, { credentials: 'include' })
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

        if (json.totalInvoicedByYear      !== undefined) setTotalInvoicedByYear(json.totalInvoicedByYear)
        if (json.totalWithPipelineByYear  !== undefined) setTotalWithPipelineByYear(json.totalWithPipelineByYear)
        if (json.bankReceivedByYear    !== undefined) setBankReceivedByYear(json.bankReceivedByYear)
        if (json.invoicedCostsByYear   !== undefined) setInvoicedCostsByYear(json.invoicedCostsByYear)
        if (json.investmentByYear      !== undefined) setInvestmentByYear(json.investmentByYear)
        if (json.openingCash           !== undefined) setOpeningCash(json.openingCash)
        if (json.pendingFromSheet)  setPendingInvoices(json.pendingFromSheet)
        if (json.pipelineFromSheet) setPipelineInvoices(json.pipelineFromSheet)
        if (json.projectedMrr != null) setProjectedMrr(json.projectedMrr)
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
    setChartView(new Date().getFullYear().toString()) // reset to current year when period changes
  }, [selectedMonth, refreshKey, sheetRefreshKey, periodView, excludedCarryOver]) // re-fetch when month/year-view/refresh/exclusions changes

  // Fetch annual-report data for the selected year (for P&L-style cards)
  useEffect(() => {
    if (!selectedYear) return
    setAnnualData(null)
    fetch(`/api/annual-report?year=${selectedYear}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setAnnualData(d) })
      .catch(() => {})
  }, [selectedYear])

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

  // Load carry-over exclusions from DB on mount
  useEffect(() => {
    fetch('/api/mrr/exclusions', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { exclusions: [] })
      .then(d => setExcludedCarryOver(new Set(d.exclusions || [])))
      .catch(() => {})
  }, [])

  function excludeClient(displayName: string) {
    const key = displayName.toLowerCase().trim()
    setExcludedCarryOver(prev => new Set([...prev, key]))
    fetch('/api/mrr/exclusions', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: key }),
    }).catch(() => {})
  }

  function restoreClient(key: string) {
    setExcludedCarryOver(prev => { const next = new Set(prev); next.delete(key); return next })
    fetch(`/api/mrr/exclusions?clientKey=${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'include' })
      .catch(() => {})
  }

  function resetAllExclusions() {
    const keys = [...excludedCarryOver]
    setExcludedCarryOver(new Set())
    keys.forEach(key =>
      fetch(`/api/mrr/exclusions?clientKey=${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    )
  }

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

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const sortedClients = useMemo(() => [...clients].sort((a, b) => {
    let av: any, bv: any
    const mrrA = a.isOneOff ? a.annualAmount : Math.round(a.annualAmount / 12)
    const mrrB = b.isOneOff ? b.annualAmount : Math.round(b.annualAmount / 12)
    switch (sortCol) {
      case 'name':        av = a.name; bv = b.name; break
      case 'issueDate':   av = a.issueDate || ''; bv = b.issueDate || ''; break
      case 'billing':     av = a.billingType; bv = b.billingType; break
      case 'invoiceAmt':  av = a.annualAmount; bv = b.annualAmount; break
      case 'mrr':         av = mrrA; bv = mrrB; break
      case 'pct':         av = mrrA; bv = mrrB; break
      case 'payment':     av = a.isPending ? 1 : 0; bv = b.isPending ? 1 : 0; break
      default:            av = a.issueDate || ''; bv = b.issueDate || ''
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  }), [clients, sortCol, sortDir])
  // Source costs for the selected month from history (bank_transactions) rather than any hardcoded sheet
  const selectedHistoryLabel = useMemo(() => {
    if (!selectedMonth) return ''
    const [name, yr] = selectedMonth.split('_')
    const SHORT: Record<string, string> = { January:'Jan', February:'Feb', March:'Mar', April:'Apr', May:'May', June:'Jun', July:'Jul', August:'Aug', September:'Sep', October:'Oct', November:'Nov', December:'Dec' }
    return `${SHORT[name] || name.slice(0, 3)} ${yr}`
  }, [selectedMonth])
  const totalCosts        = history.find(h => h.month === selectedHistoryLabel)?.costs || 0
  const netRevenue        = totalConfirmedMrr - totalCosts
  const opMargin          = totalConfirmedMrr > 0 ? ((netRevenue / totalConfirmedMrr) * 100).toFixed(1) : '0'
  const prevMrr           = history.filter(h => (h.confirmed ?? 0) > 0).slice(-2)[0]?.confirmed ?? 0
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

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const chartData = useMemo(() => {
    const base = chartView !== 'all' ? history.filter(h => h.month.includes(chartView)) : history
    const mapped = base.map(h => {
      const [monthShort, yearStr] = h.month.split(' ')
      const mIdx   = MONTH_SHORT.indexOf(monthShort)
      const yr     = parseInt(yearStr)
      const mStart = new Date(yr, mIdx, 1)
      const mEnd   = new Date(yr, mIdx + 1, 0)

      // Compute pipeline MRR for this month from sales-sent invoices
      let pipeline = 0
      for (const inv of pipelineInvoices) {
        const amount      = inv.amount || 0
        const billingType = (inv.billingType || 'annual').toLowerCase().trim()
        const d           = inv.issueDate ? new Date(inv.issueDate) : null
        if (!d || isNaN(d.getTime()) || !amount) continue
        const isOneOff = billingType === 'one-off' || billingType === 'oneoff' || billingType === 'one off'
        if (isOneOff) {
          if (d >= mStart && d <= mEnd) pipeline += amount
        } else {
          if (d > mEnd) continue
          const end = new Date(d)
          if (billingType === 'quarterly')    end.setMonth(end.getMonth() + 3)
          else if (billingType === 'monthly') end.setMonth(end.getMonth() + 1)
          else                               end.setMonth(end.getMonth() + 12)
          end.setDate(1)
          if (end <= mStart) continue
          const monthly = billingType === 'monthly' ? amount : billingType === 'quarterly' ? amount / 3 : amount / 12
          pipeline += Math.round(monthly)
        }
      }

      return { ...h, pipeline, projected: h.projected ?? null, projectedBreakdown: h.projectedBreakdown ?? null, forecastedCost: h.forecastedCost ?? null }
    })

    // Bridge confirmed → projected: last confirmed month also gets a projected value so
    // the dotted projected line connects seamlessly to the solid confirmed line.
    const lastConfirmedIdx = mapped.reduce((best, d, i) => (d.confirmed ?? 0) > 0 ? i : best, -1)
    if (lastConfirmedIdx !== -1) {
      const bridgeVal = mapped[lastConfirmedIdx].confirmed ?? 0
      mapped[lastConfirmedIdx] = { ...mapped[lastConfirmedIdx], projected: bridgeVal }
    }

    // Bridge actual costs → forecast costs: keep forecastedCost null for all months up to
    // (and including) the last month with actual bank costs, then set the bridge point so
    // the dotted forecast line continues seamlessly from the solid costs line.
    const lastActualCostIdx = mapped.reduce((best, d, i) => d.costs > 0 ? i : best, -1)
    for (let i = 0; i < mapped.length; i++) {
      if (i < lastActualCostIdx) {
        // Before bridge: no forecast line yet
        mapped[i] = { ...mapped[i], forecastedCost: null }
      } else if (i === lastActualCostIdx) {
        // Bridge point: both lines meet here
        mapped[i] = { ...mapped[i], forecastedCost: mapped[i].costs }
      } else {
        // After bridge: actual costs line stops, forecast line continues
        mapped[i] = { ...mapped[i], costs: null as any }
      }
    }

    return mapped
  }, [history, chartView, pipelineInvoices])

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
              ? 'Loading…'
              : periodView === 'year'
                ? `Full Year ${selectedYear}`
                : `${selectedMonth?.replace('_', ' ')} · ${history.length} months of history`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Currency toggle */}
          <div className="flex bg-narra-surface border border-narra-border rounded-lg overflow-hidden text-xs">
            <button onClick={() => setDisplayCurrency('USD')} className={`px-3 py-2 font-body transition-all ${displayCurrency === 'USD' ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>USD</button>
            <button onClick={() => setDisplayCurrency('SGD')} className={`px-3 py-2 font-body transition-all ${displayCurrency === 'SGD' ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>SGD</button>
          </div>
          {/* Month / Year view toggle */}
          <div className="flex bg-narra-surface border border-narra-border rounded-lg overflow-hidden text-xs">
            <button onClick={() => setPeriodView('month')}
              className={`px-3 py-2 font-body transition-all ${periodView === 'month' ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>
              Month
            </button>
            <button onClick={() => setPeriodView('year')}
              className={`px-3 py-2 font-body transition-all ${periodView === 'year' ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>
              Year
            </button>
          </div>
          <button
            onClick={() => setSheetRefreshKey(k => k + 1)}
            disabled={historyLoading}
            title="Re-fetch latest data from invoice tracker"
            className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all disabled:opacity-50">
            {historyLoading ? '⟳' : '↻ Refresh'}
          </button>
          <button onClick={syncInvoices} disabled={syncing || clients.length === 0 || !periodId}
            className="hidden sm:block px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-50"
            title={clients.length === 0 ? 'No clients loaded from invoice tracker yet' : 'Save active client MRR for this period so the P&L uses accrual revenue'}>
            {syncing ? '⟳ Syncing…' : '⟳ Sync Revenue'}
          </button>
          <button onClick={exportMRR}
            className="hidden sm:block px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-dark hover:bg-narra-light transition-all">
            ↓ CSV
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`border rounded-xl px-4 py-3 text-sm ${syncResult.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          {syncResult.error
            ? `✗ ${syncResult.error}`
            : `✓ Synced ${syncResult.saved} client${syncResult.saved !== 1 ? 's' : ''} · Total MRR $${(syncResult.totalMrr || 0).toLocaleString()} — P&L will now use accrual revenue`
          }
        </div>
      )}

      {/* KPI cards — matches P&L template + Total Invoiced + Cash Received */}
      {(() => {
        const yr = parseInt(selectedYear)
        const allYrs = Array.from(new Set([
          ...Object.keys(bankReceivedByYear).map(Number),
          ...Object.keys(yearTotals).map(Number),
          ...Object.keys(investmentByYear).map(Number),
        ])).filter(n => n >= 2025).sort((a, b) => a - b)
        const cashInBank = openingCash
          + allYrs.reduce((s, y) => s + (bankReceivedByYear[y] || 0) + (investmentByYear[y] || 0) - (yearTotals[y]?.costs || 0), 0)

        const at = annualData?.totals
        const totalRevenue   = at?.revenue   || 0
        const totalExpenses  = at?.expenses  || 0
        const totalCapex     = at?.capex     || 0
        const totalNet       = at?.net       || 0
        const opMarginStr    = at?.operatingMargin || '0.0'
        const openingCashYr  = at?.openingCash  || 0
        const closingCashYr  = at?.closingCash  || 0
        // Fall back to the most recent year with data if selected year has none
        const invoicedYr        = totalInvoicedByYear[yr]     != null ? yr : Math.max(...Object.keys(totalInvoicedByYear).map(Number).filter(y => y <= yr), 0)
        const pipelineYr        = totalWithPipelineByYear[yr] != null ? yr : Math.max(...Object.keys(totalWithPipelineByYear).map(Number).filter(y => y <= yr), 0)
        const totalInvoiced     = totalInvoicedByYear[invoicedYr]     || 0
        const totalWithPipeline = totalWithPipelineByYear[pipelineYr] || 0
        const invoicedLabel     = invoicedYr !== yr && invoicedYr > 0 ? String(invoicedYr) : selectedYear
        const pipelineLabel     = pipelineYr !== yr && pipelineYr > 0 ? String(pipelineYr) : selectedYear
        const cashReceived        = bankReceivedByYear[yr]      || 0

        return (
          <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-10 gap-3">

            {/* 1 — Total Revenue — dark, clickable */}
            <button onClick={() => { setShowRevenueBreakdown(v => !v); setShowExpenseBreakdown(false) }}
              className="bg-narra-dark rounded-xl p-4 text-left group relative hover:bg-narra-mid transition-colors">
              <div className="text-[10px] text-white/40 uppercase tracking-widest mb-2 font-body leading-tight">Total Revenue</div>
              <div className="font-heading text-lg sm:text-xl font-semibold text-narra-green">{sym}{fmt(cvt(totalRevenue))}</div>
              <div className="text-xs mt-1 text-white/40 group-hover:text-white/60">Tap to see breakdown ↓</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-white border border-narra-border text-narra-dark text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                All client payments that landed in your bank this year.
              </div>
            </button>

            {/* 2 — Operating Expenses — dark, clickable */}
            <button onClick={() => { setShowExpenseBreakdown(v => !v); setShowRevenueBreakdown(false) }}
              className="bg-narra-dark rounded-xl p-4 text-left group relative hover:bg-narra-mid transition-colors">
              <div className="text-[10px] text-white/40 uppercase tracking-widest mb-2 font-body leading-tight">Operating Expenses</div>
              <div className="font-heading text-lg sm:text-xl font-semibold text-narra-green">{sym}{fmt(cvt(totalExpenses))}</div>
              <div className="text-xs mt-1 text-white/40 group-hover:text-white/60">Tap to see breakdown ↓</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-white border border-narra-border text-narra-dark text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Day-to-day running costs — salaries, software, marketing. Excludes product build (capex).
              </div>
            </button>

            {/* 3 — Product Capex */}
            <div className="bg-white border border-narra-border rounded-xl p-4 relative group">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Product Capex</div>
              <div className="font-heading text-lg sm:text-xl font-semibold text-amber-600">{sym}{fmt(cvt(totalCapex))}</div>
              <div className="text-xs mt-1 text-narra-muted">Investor-funded build</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Money spent building the product. Funded by investors — not counted in operating margin.
              </div>
            </div>

            {/* 4 — Net Profit */}
            <div className="bg-white border border-narra-border rounded-xl p-4 relative group">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Net Profit</div>
              <div className={`font-heading text-lg sm:text-xl font-semibold ${totalNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {totalNet < 0 ? `(${sym}${fmt(Math.abs(cvt(totalNet)))})` : `${sym}${fmt(cvt(totalNet))}`}
              </div>
              <div className="text-xs mt-1 text-narra-muted">Revenue minus operating costs</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                What's left after paying all running costs. Product build spend excluded.
              </div>
            </div>

            {/* 5 — Operating Margin */}
            <div className="bg-white border border-narra-border rounded-xl p-4 relative group">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Operating Margin</div>
              <div className={`font-heading text-lg sm:text-xl font-semibold ${parseFloat(opMarginStr) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {opMarginStr}%
              </div>
              <div className="text-xs mt-1 text-narra-muted">Net ÷ Revenue</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                For every dollar you earned, this is how much was profit. 40%+ is healthy for a SaaS business.
              </div>
            </div>

            {/* 6 — Opening Cash */}
            <div className="bg-white border border-narra-border rounded-xl p-4 relative group">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Opening Cash</div>
              <div className="font-heading text-lg sm:text-xl font-semibold text-narra-dark">{sym}{fmt(cvt(openingCashYr))}</div>
              <div className="text-xs mt-1 text-narra-muted">1 Jan {selectedYear}</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                How much money was in your bank at the start of this year.
              </div>
            </div>

            {/* 7 — Closing Cash */}
            <div className="bg-white border border-narra-border rounded-xl p-4 relative group">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Closing Cash</div>
              <div className={`font-heading text-lg sm:text-xl font-semibold ${closingCashYr >= 0 ? 'text-narra-dark' : 'text-red-600'}`}>
                {closingCashYr < 0 ? `(${sym}${fmt(Math.abs(cvt(closingCashYr)))})` : `${sym}${fmt(cvt(closingCashYr))}`}
              </div>
              <div className="text-xs mt-1 text-narra-muted">End of {selectedYear}</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Money in your bank at year-end: opening + revenue + investments − all costs.
              </div>
            </div>

            {/* 8 — Total Invoiced */}
            <div className="bg-white border border-narra-border rounded-xl p-4 relative group">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Total Invoiced</div>
              <div className="font-heading text-lg sm:text-xl font-semibold text-narra-dark">{sym}{fmt(cvt(totalInvoiced))}</div>
              <div className="text-xs mt-1 text-narra-muted">Paid + partial {invoicedLabel}</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Sum of invoices sent in {invoicedLabel} with status Fully Paid, Partial Payment, or Pending Payment.
              </div>
            </div>

            {/* 9 — Total Invoiced + Pipeline */}
            <div className="bg-white border border-narra-border rounded-xl p-4 relative group">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Invoiced + Pipeline</div>
              <div className="font-heading text-lg sm:text-xl font-semibold text-narra-dark">{sym}{fmt(cvt(totalWithPipeline))}</div>
              <div className="text-xs mt-1 text-narra-muted">incl. Sales - Sent {pipelineLabel}</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Total Invoiced plus Sales - Sent invoices issued in {pipelineLabel}.
              </div>
            </div>

            {/* 10 — Cash Received */}
            <button onClick={openCashDetail}
              className="bg-white border border-narra-border rounded-xl p-4 text-left group relative hover:bg-narra-surface transition-colors">
              <div className="text-[10px] text-narra-muted uppercase tracking-widest mb-2 font-body leading-tight">Cash Received</div>
              <div className="font-heading text-lg sm:text-xl font-semibold text-narra-dark">{sym}{fmt(cvt(cashReceived))}</div>
              <div className="text-xs mt-1 text-narra-muted group-hover:text-narra-dark">Tap for breakdown ↓</div>
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-narra-dark text-white text-xs rounded-xl p-3 z-50 shadow-xl leading-relaxed pointer-events-none">
                Actual client payments that landed in your bank this year — may differ from invoiced if clients pay late or annually.
              </div>
            </button>

          </div>

          {/* Projected ARR banner — only shown when viewing a future year */}
          {yr > new Date().getFullYear() && projectedMrr > 0 && (
            <div className="flex items-center gap-4 border border-indigo-200 border-dashed bg-indigo-50/60 rounded-xl px-5 py-4">
              <div className="flex-1">
                <div className="text-[10px] text-indigo-400 uppercase tracking-widest font-body">Contracted {yr} ARR</div>
                <div className="font-heading text-xl font-semibold text-indigo-700 mt-1">
                  {sym}{fmt(cvt(projectedMrr * 12))}
                  <span className="text-sm font-normal text-indigo-400 ml-2">/ yr</span>
                </div>
                <div className="text-xs text-indigo-400 mt-1">{sym}{fmt(cvt(projectedMrr))} / mo · based on all active contracts auto-renewing</div>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-indigo-400">
                <svg width="32" height="12"><line x1="0" y1="6" x2="32" y2="6" stroke="#6366f1" strokeWidth="2" strokeDasharray="6 4"/></svg>
                dotted line on chart
              </div>
            </div>
          )}

          {/* Revenue breakdown */}
          {showRevenueBreakdown && annualData?.allTransactions?.filter((t: any) => t.type === 'revenue').length > 0 && (
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
                  {annualData.allTransactions.filter((t: any) => t.type === 'revenue').map((t: any, i: number) => (
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
          {showExpenseBreakdown && annualData?.expensesByDescription?.length > 0 && (
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
                  {annualData.expensesByDescription.filter((e: any) => e.total > 0).map((e: any, i: number) => (
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
          </>
        )
      })()}

      {/* Chart */}
      <div className="bg-white border border-narra-border rounded-xl p-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark">Monthly Recurring Revenue</h3>
            <p className="text-xs text-narra-muted mt-0.5">Hover any point to see exact values</p>
            {/* Legend */}
            <div className="flex gap-5 mt-3 flex-wrap">
              {[
                { color: '#16a34a', dash: false, label: 'Confirmed MRR', desc: 'fully paid revenue' },
                { color: '#f59e0b', dash: true,  label: 'Pipeline MRR',  desc: 'sales-sent, not yet invoiced' },
                { color: '#ef4444', dash: true,  label: 'Costs',         desc: 'monthly operating costs' },
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
            {(['all', selectedYear] as const).map(v => (
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
                <Line type="monotone" dataKey="confirmed" stroke="#16a34a" strokeWidth={2.5}
                  dot={{ fill: '#16a34a', r: 3, strokeWidth: 0 }} activeDot={{ r: 6, fill: '#16a34a' }} name="Confirmed MRR" />
                <Line type="monotone" dataKey="projected" stroke="#16a34a" strokeWidth={2.5} strokeDasharray="6 4"
                  dot={false} activeDot={{ r: 5, fill: '#16a34a' }} name="Projected MRR" connectNulls={false} />
                <Line type="monotone" dataKey="pipeline" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3"
                  dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }} activeDot={{ r: 6, fill: '#f59e0b' }} name="Pipeline MRR" />
                <Line type="monotone" dataKey="costs" stroke="#ef4444" strokeWidth={1.5}
                  dot={false} activeDot={{ r: 4, fill: '#ef4444' }} name="Costs" />
                <Line type="monotone" dataKey="forecastedCost" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3"
                  dot={false} activeDot={{ r: 4, fill: '#ef4444' }} name="Forecasted Costs" connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="text-xs text-narra-muted mt-1">← Scroll to see all months</p>
      </div>

      {/* Carry-over exclusion manager — shown when there are any carry-over clients in projected months */}
      {(() => {
        const allCarryOver = Array.from(new Set(
          history.flatMap(h => h.projectedBreakdown?.carryOverClients ?? [])
        ))
        if (allCarryOver.length === 0 && excludedCarryOver.size === 0) return null
        return (
          <div className="border border-narra-border rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-heading font-medium text-narra-dark">Carry-over clients</p>
                <p className="text-xs text-narra-muted mt-0.5">Clients whose prior contract is being carried into projected months. Click × to exclude from projected MRR.</p>
              </div>
              {excludedCarryOver.size > 0 && (
                <button
                  onClick={resetAllExclusions}
                  className="text-xs text-narra-muted hover:text-red-500 transition-colors flex-shrink-0"
                >
                  Reset all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allCarryOver.map((c, i) => {
                const key = c.toLowerCase().trim()
                const excluded = excludedCarryOver.has(key)
                return (
                  <div key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${excluded ? 'bg-red-50 border-red-200 text-red-400 line-through' : 'bg-narra-surface border-narra-border text-narra-dark'}`}>
                    <span>{c}</span>
                    {excluded ? (
                      <button
                        onClick={() => restoreClient(key)}
                        className="text-red-300 hover:text-red-600 ml-1"
                        title="Restore to carry-over"
                      >↩</button>
                    ) : (
                      <button
                        onClick={() => excludeClient(c)}
                        className="text-narra-muted hover:text-red-500 ml-1"
                        title="Exclude from projected MRR"
                      >×</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-narra-border overflow-x-auto scrollbar-none">
        {[
          { id: 'outgoing',  label: `Outgoing · ${clients.length} client${clients.length !== 1 ? 's' : ''}` },
          { id: 'incoming',  label: `Incoming · ${incomingInvoices.length} invoice${incomingInvoices.length !== 1 ? 's' : ''}` },
          { id: 'pending',   label: `Pending${pendingInvoices.length > 0 ? ` (${pendingInvoices.length})` : ''}` },
          { id: 'pipeline',  label: `Pipeline${pipelineInvoices.length > 0 ? ` (${pipelineInvoices.length})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={`px-4 py-2.5 text-sm font-body transition-all border-b-2 -mb-px whitespace-nowrap flex-shrink-0
              ${activeTab === t.id ? 'text-narra-dark border-narra-dark font-medium' : 'text-narra-muted border-transparent hover:text-narra-dark'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Outgoing invoices (revenue / client MRR) */}
      {activeTab === 'outgoing' && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-light/40 border-b border-narra-border">
            <span className="text-sm font-heading font-medium text-narra-dark">
              {periodView === 'year' ? `All active clients · ${selectedYear}` : `Active clients · ${selectedMonth?.replace('_', ' ')}`}
            </span>
            <p className="text-xs text-narra-muted mt-0.5">From outgoing invoice tracker · billing type determines MRR contribution</p>
            <span className="hidden sm:inline text-xs text-narra-muted">Annual÷12 · Quarterly÷3 · Monthly=full · One-off excluded</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-narra-dark text-white">
                <th className="hidden sm:table-cell px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 text-left">Invoice #</th>
                {([
                  { label: 'Client',      col: 'name',       right: false, hidden: false },
                  { label: 'Distributor', col: '',            right: false, hidden: true  },
                  { label: 'Issued',      col: 'issueDate',  right: false, hidden: true  },
                  { label: 'Billing',     col: 'billing',    right: false, hidden: false },
                  { label: 'Invoice Amt', col: 'invoiceAmt', right: true,  hidden: false },
                  { label: 'MRR',         col: 'mrr',        right: true,  hidden: false },
                  { label: 'LTV',         col: 'ltv',        right: true,  hidden: true  },
                  { label: 'Payment',     col: 'payment',    right: false, hidden: false },
                  { label: '% of MRR',   col: 'pct',        right: true,  hidden: true  },
                ] as { label: string; col: string; right: boolean; hidden: boolean }[]).map(({ label, col, right, hidden }) => (
                  <th key={label}
                    onClick={() => col && toggleSort(col)}
                    className={`${hidden ? 'hidden sm:table-cell' : ''} px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${right ? 'text-right' : 'text-left'} ${col ? 'cursor-pointer hover:text-white select-none' : ''}`}>
                    {label}{col && sortCol === col && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-narra-muted text-sm">
                  Loading from outgoing invoice tracker…
                </td></tr>
              ) : sortedClients.map((c, i) => {
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
                    <td className="hidden sm:table-cell px-4 py-2.5 font-mono text-xs text-narra-muted whitespace-nowrap">{c.invoiceId || '—'}</td>
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
                    <td className="hidden sm:table-cell px-4 py-2.5">
                      {dbClient?.distributor
                        ? <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">{dbClient.distributor}</span>
                        : <span className="text-xs text-narra-border">Direct</span>}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-narra-muted text-xs">
                      {c.issueDate ? new Date(c.issueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.isOneOff ? 'bg-purple-100 text-purple-700' : 'bg-narra-light text-narra-muted'}`}>{billingLabel}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-narra-dark">{sym}{Math.round(cvt(invoiceAmt)).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-narra-dark">
                      {c.isOneOff ? <span className="text-purple-700">{sym}{Math.round(cvt(mrr)).toLocaleString()} this month</span> : `${sym}${Math.round(cvt(mrr)).toLocaleString()}/mo`}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right text-narra-dark">
                      {dbClient?.ltv ? `${sym}${Math.round(cvt(dbClient.ltv)).toLocaleString()}` : <span className="text-narra-border">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.isPending ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {c.isPending ? 'Sent' : 'Paid'}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right">
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
                      <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">{sym}{Math.round(cvt(totalConfirmedMrr)).toLocaleString()}/mo</td>
                      <td colSpan={2} />
                    </tr>
                    {confirmedOneOffTotal > 0 && (
                      <tr className="border-t border-purple-200 bg-purple-50">
                        <td className="px-4 py-3 font-medium text-purple-800" colSpan={4}>
                          + One-off revenue this month ({confirmedOneOff.length} payment{confirmedOneOff.length !== 1 ? 's' : ''}, Paid)
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-purple-800">{sym}{Math.round(cvt(confirmedOneOffTotal)).toLocaleString()}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    {pendingMrr > 0 && (
                      <tr className="border-t border-amber-200 bg-amber-50">
                        <td className="px-4 py-3 font-medium text-amber-700" colSpan={4}>
                          + Pending recurring · {pendingRecurring.length} invoice{pendingRecurring.length !== 1 ? 's' : ''} sent, not yet paid
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-amber-700">{sym}{Math.round(cvt(pendingMrr)).toLocaleString()}/mo</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    {pendingOneOffTotal > 0 && (
                      <tr className="border-t border-amber-100 bg-amber-50/50">
                        <td className="px-4 py-3 font-medium text-amber-600" colSpan={4}>
                          + Pending one-off · {pendingOneOff.length} invoice{pendingOneOff.length !== 1 ? 's' : ''} sent, not yet paid
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-amber-600">{sym}{Math.round(cvt(pendingOneOffTotal)).toLocaleString()}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                  </>
                )
              })()}
            </tbody>
          </table>
          </div>
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
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
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
            </div>
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
                  <AlertTriangle size={14} className="inline mr-1" />{pendingInvoices.length} outstanding · {sym}{Math.round(cvt(pendingInvoices.reduce((s, i) => s + i.amount, 0))).toLocaleString()} total
                </span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
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
                      <td className="px-4 py-3 text-right font-medium text-amber-900">{sym}{cvt(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
            </div>
          )}
        </div>
      )}

      {/* Sales Pipeline */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Pipeline Deals', value: pipelineInvoices.length.toString(), sub: 'Not yet contracted' },
              { label: 'Potential ARR',  value: `${sym}${Math.round(cvt(pipelineInvoices.reduce((s, i) => s + i.amount, 0))).toLocaleString()}`, sub: 'If all deals close' },
              { label: 'Potential MRR',  value: `${sym}${Math.round(cvt(pipelineInvoices.reduce((s, i) => s + i.amount, 0) / 12)).toLocaleString()}`, sub: 'Annual ÷ 12' },
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
                Status "sales-sent" in invoice tracker — proposal sent, not yet contracted.
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
              <div className="mb-2 flex justify-center"><ClipboardList size={28} className="text-narra-muted" /></div>
              <p className="font-heading font-semibold text-narra-dark">No pipeline deals</p>
              <p className="text-narra-muted text-sm mt-1">Mark invoices as "Sales" in your invoice tracker to see them here.</p>
            </div>
          ) : (
            <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-narra-light/40 border-b border-narra-border">
                <span className="text-sm font-medium text-narra-dark">
                  <Target size={14} className="inline mr-1" />{pipelineInvoices.length} deal(s) · {sym}{Math.round(cvt(pipelineInvoices.reduce((s, i) => s + i.amount, 0))).toLocaleString()} potential ARR
                </span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
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
                      <td className="px-4 py-3 text-right font-medium text-narra-dark">{sym}{cvt(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs bg-narra-light text-narra-muted px-2 py-0.5 rounded-full">
                          {sym}{Math.round(cvt(inv.amount / 12)).toLocaleString()}/mo
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
                    <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">{sym}{Math.round(cvt(pipelineInvoices.reduce((s, i) => s + i.amount, 0))).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-heading font-bold text-narra-dark">{sym}{Math.round(cvt(pipelineInvoices.reduce((s, i) => s + i.amount, 0) / 12)).toLocaleString()}/mo</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
              </div>
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
                <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
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
                </div>
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
