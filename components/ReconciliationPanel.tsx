'use client'
import { useState, useEffect, useCallback } from 'react'
import { downloadCSV, toCSV } from '@/lib/csv'
import { AlertTriangle, Landmark, CheckCircle2 } from 'lucide-react'

interface MatchedPair {
  bankTxId: number
  invoiceId: number | null
  bankDate: string
  bankDescription: string
  bankAmount: number
  bankCurrency: string
  bankAccount: string
  invoiceVendor: string | null
  invoiceDate: string | null
  invoiceAmount: number | null
  invoiceFile: string | null
  accountCode: string
  status: 'matched' | 'proposed' | 'flagged' | 'unmatched'
  confidence: 'high' | 'medium' | 'low'
  discrepancyPct: number | null
}

const ACCOUNT_OPTIONS = [
  '411 - Professional Fees',
  '417 - Freight',
  '426 - Subscriptions',
  '427 - General Expenses',
  '452 - Bank Fees',
  '525 - FX Gains/Losses',
  'Payroll',
  'Uncategorized',
]

interface CostGroup {
  accountCode: string
  total: number
  items: {
    id: number
    invoiceId: number | null
    date: string
    description: string
    vendor: string
    amount: number
    currency: string
    status: string
    matchedInvoice: string | null
    accountCode: string
  }[]
}

export default function ReconciliationPanel({ periodId, data, onRefresh, selectedMonth }: {
  periodId: number
  data: any
  onRefresh: () => void
  selectedMonth?: string
}) {
  const [loading,        setLoading]        = useState(true)
  const [costGroups,     setCostGroups]     = useState<CostGroup[]>([])
  const [matches,        setMatches]        = useState<MatchedPair[]>([])
  const [unmatched,      setUnmatched]      = useState<any[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [totalExpenses,  setTotalExpenses]  = useState(0)
  const [totalRevenue,   setTotalRevenue]   = useState(0)
  const [activeTab,      setActiveTab]      = useState<'overview' | 'matches' | 'unmatched'>('overview')
  const [unmatching,      setUnmatching]      = useState<number | null>(null)
  const [deletingTx,      setDeletingTx]      = useState<number | null>(null)
  const [acknowledging,   setAcknowledging]   = useState<number | null>(null)
  const [acknowledged,    setAcknowledged]    = useState<any[]>([])
  const [showAcknowledged, setShowAcknowledged] = useState(false)
  const [allInvoices,     setAllInvoices]     = useState<any[]>([])
  const [linkingTx,       setLinkingTx]       = useState<number | null>(null)
  const [txCountByInvoice, setTxCountByInvoice] = useState<Record<number, number>>({})
  const [reassigning,     setReassigning]     = useState<number | null>(null)
  const [rerunning,       setRerunning]       = useState(false)
  const [rerunMsg,        setRerunMsg]        = useState('')
  const [splitTx,         setSplitTx]         = useState<any | null>(null)
  const [splitRows,       setSplitRows]       = useState<{ invoiceId: string; description: string; amount: string; invoiceAmount: number | null; lookingUp: boolean; lookupError: string }[]>([])
  const [splitting,       setSplitting]       = useState(false)
  const [splitError,      setSplitError]      = useState('')
  const [clients,         setClients]         = useState<{id: number; name: string}[]>([])
  const [taggingTx,       setTaggingTx]       = useState<number | null>(null)
  const [clientIdMap,     setClientIdMap]     = useState<Record<number, number[]>>({})
  const [acknowledgingAll, setAcknowledgingAll] = useState(false)
  const [invoiceInputs,   setInvoiceInputs]   = useState<Record<number, string>>({})
  const [invoiceLookups,  setInvoiceLookups]  = useState<Record<number, { clientName: string; amount: number; error?: string } | null>>({})
  const [lookingUpInv,    setLookingUpInv]    = useState<number | null>(null)
  const [yearView,        setYearView]        = useState(false)
  const [yearTxns,        setYearTxns]        = useState<any[]>([])
  const [yearLoading,     setYearLoading]     = useState(false)

  const selectedYear = selectedMonth ? selectedMonth.split('_')[1] : String(new Date().getFullYear())

  useEffect(() => {
    if (!periodId) return
    loadData()
  }, [periodId])

  useEffect(() => {
    if (!yearView) return
    loadYearData()
  }, [yearView, selectedYear])

  async function loadYearData() {
    setYearLoading(true)
    try {
      const [txRes, clientsRes] = await Promise.all([
        fetch(`/api/bank?action=year_all&year=${selectedYear}`, { credentials: 'include' }),
        fetch('/api/clients', { credentials: 'include' }),
      ])
      if (txRes.ok) {
        const data = await txRes.json()
        const txs = data.transactions || []
        setYearTxns(txs)
        const initMap: Record<number, number[]> = {}
        for (const tx of txs) {
          const ids = Array.isArray(tx.client_ids) && tx.client_ids.length > 0
            ? tx.client_ids.filter(Boolean)
            : tx.client_id ? [tx.client_id] : []
          if (ids.length > 0) initMap[tx.id] = ids
        }
        setClientIdMap(prev => ({ ...prev, ...initMap }))
      }
      if (clientsRes.ok) {
        const cd = await clientsRes.json()
        setClients((cd.clients || []).filter((c: any) => c.active).map((c: any) => ({ id: c.id, name: c.name })))
      }
    } catch (err) {
      console.error('Year data load error:', err)
    } finally {
      setYearLoading(false)
    }
  }

  async function loadData() {
    setLoading(true)
    try {
      // All fetches in parallel
      const [summaryRes, txRes, invRes, clientsRes] = await Promise.all([
        fetch(`/api/bank?action=summary&periodId=${periodId}`, { credentials: 'include' }),
        fetch(`/api/bank?periodId=${periodId}`, { credentials: 'include' }),
        fetch(`/api/invoices?periodId=${periodId}`, { credentials: 'include' }),
        fetch('/api/clients', { credentials: 'include' }),
      ])

      // Bank summary → cost groups
      if (summaryRes.ok) {
        const summary = await summaryRes.json()
        setTotalExpenses(summary.totalExpenses || 0)
        setTotalRevenue(summary.totalRevenue || 0)
        const groups: CostGroup[] = Object.entries(summary.byAccount || {}).map(([code, group]: any) => ({
          accountCode: code,
          total: group.total,
          items: group.items.map((item: any) => ({ ...item, accountCode: code })),
        })).sort((a, b) => b.total - a.total)
        setCostGroups(groups)
      }

      // Clients for revenue tagging
      if (clientsRes.ok) {
        const clientsData = await clientsRes.json()
        setClients((clientsData.clients || []).filter((c: any) => c.active).map((c: any) => ({ id: c.id, name: c.name })))
      }

      // Bank transactions + invoices → matches / unmatched
      if (txRes.ok) {
        const [txData, invData] = await Promise.all([
          txRes.json(),
          invRes.ok ? invRes.json() : Promise.resolve({ invoices: [] }),
        ])
        const txs         = txData.transactions || []
        const invoiceList = invData.invoices || []
        setAllInvoices(invoiceList)

        // Build invMap from bank txs' matched_invoice_id so multiple bank txs can share one invoice
        const invoiceById: Record<number, any> = {}
        for (const inv of invoiceList) invoiceById[inv.id] = inv
        const invMap: Record<number, any> = {}
        const counts: Record<number, number> = {}
        for (const tx of txs) {
          if (tx.matched_invoice_id) {
            invMap[tx.id] = invoiceById[tx.matched_invoice_id]
            counts[tx.matched_invoice_id] = (counts[tx.matched_invoice_id] || 0) + 1
          }
        }
        setTxCountByInvoice(counts)

        const matchedTxs      = txs.filter((t: any) => t.status === 'matched' || t.status === 'proposed' || t.status === 'flagged')
        const unmatchedTxs    = txs.filter((t: any) => t.status === 'unmatched' && (t.type === 'expense' || t.type === 'revenue'))
        const acknowledgedTxs = txs.filter((t: any) => t.status === 'acknowledged' && t.type === 'expense')
        setAcknowledged(acknowledgedTxs)

        const initMap: Record<number, number[]> = {}
        for (const tx of txs) {
          const ids = Array.isArray(tx.client_ids) && tx.client_ids.length > 0
            ? tx.client_ids.filter(Boolean)
            : tx.client_id ? [tx.client_id] : []
          if (ids.length > 0) initMap[tx.id] = ids
        }
        setClientIdMap(initMap)

        const pairs: MatchedPair[] = matchedTxs.map((tx: any) => {
          const inv = invMap[tx.id]
          return {
            bankTxId:        tx.id,
            invoiceId:       inv?.id || null,
            bankDate:        tx.date,
            bankDescription: tx.description,
            bankAmount:      parseFloat(tx.amount || 0),
            bankCurrency:    tx.currency || 'USD',
            bankAccount:     tx.account || '',
            invoiceVendor:   inv?.vendor || null,
            invoiceDate:     inv?.date || null,
            invoiceAmount:   inv ? parseFloat(inv.amount_usd || 0) : null,
            invoiceFile:     inv?.drive_file_name || null,
            accountCode:     inv?.account_name || tx.account || 'Uncategorized',
            status:          tx.status,
            confidence:      tx.status === 'matched' ? 'high' : tx.status === 'flagged' ? 'low' : 'medium',
            discrepancyPct:  tx.discrepancy_pct ? parseFloat(tx.discrepancy_pct) : null,
          }
        })

        setMatches(pairs)
        setUnmatched(unmatchedTxs)
      }
    } catch (err) {
      console.error('Reconciliation load error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function unmatch(pair: MatchedPair) {
    setUnmatching(pair.bankTxId)
    try {
      await fetch('/api/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'unmatch',
          bankTxId: pair.bankTxId,
          invoiceId: pair.invoiceId,
        }),
      })
      await loadData()
      onRefresh()
    } catch (err) {
      console.error('Unmatch error:', err)
    } finally {
      setUnmatching(null)
    }
  }

  async function approveMatch(pair: MatchedPair) {
    try {
      await fetch('/api/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'approve_match',
          bankTxId: pair.bankTxId,
          invoiceId: pair.invoiceId,
        }),
      })
      await loadData()
    } catch (err) {
      console.error('Approve match error:', err)
    }
  }

  async function updateAmount(txId: number, newAmount: number) {
    if (isNaN(newAmount) || newAmount <= 0) return
    await fetch('/api/bank', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'update_amount', bankTxId: txId, amount: newAmount }),
    })
    await loadData()
    onRefresh()
  }

  async function retagBankTx(bankTxId: number, account: string) {
    await fetch('/api/bank', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'retag', bankTxId, account }),
    })
    await loadData()
  }

  async function acknowledgeTx(txId: number) {
    setAcknowledging(txId)
    await fetch('/api/bank', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'acknowledge', bankTxId: txId }),
    })
    setAcknowledging(null)
    await loadData()
    onRefresh()
  }

  async function acknowledgeAll() {
    const expenseUnmatched = unmatched.filter((t: any) => t.type === 'expense')
    if (!expenseUnmatched.length) return
    setAcknowledgingAll(true)
    await Promise.all(expenseUnmatched.map((tx: any) =>
      fetch('/api/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'acknowledge', bankTxId: tx.id }),
      })
    ))
    setAcknowledgingAll(false)
    await loadData()
    onRefresh()
  }

  async function deleteBankTx(txId: number) {
    setDeletingTx(txId)
    await fetch(`/api/bank?txId=${txId}`, { method: 'DELETE', credentials: 'include' })
    setDeletingTx(null)
    await loadData()
    onRefresh()
  }

  async function reassignInvoice(bankTxId: number, currentInvoiceId: number | null, newInvoiceId: number) {
    setReassigning(bankTxId)
    try {
      await fetch('/api/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'reassign', bankTxId, invoiceId: currentInvoiceId, newInvoiceId }),
      })
      setLinkingTx(null)
      await loadData()
      onRefresh()
    } catch (err) {
      console.error('Reassign error:', err)
    } finally {
      setReassigning(null)
    }
  }

  async function rerunAutoMatch() {
    setRerunning(true)
    setRerunMsg('')
    try {
      await fetch('/api/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'rerun', periodId }),
      })
      await loadData()
      onRefresh()
      setRerunMsg('Auto-match complete.')
      setTimeout(() => setRerunMsg(''), 4000)
    } catch (err) {
      console.error('Rerun error:', err)
      setRerunMsg('Error running auto-match.')
    } finally {
      setRerunning(false)
    }
  }

  async function tagClient(txId: number, clientIds: number[], invoiceRef?: string) {
    setTaggingTx(txId)
    const body: any = { action: 'tag_client', bankTxId: txId, clientIds, clientId: clientIds[0] ?? null }
    if (invoiceRef !== undefined) body.invoiceRef = invoiceRef
    await fetch('/api/bank', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    setClientIdMap(prev => ({ ...prev, [txId]: clientIds }))
    setTaggingTx(null)
  }

  async function lookupRevenueInvoice(txId: number, invoiceId: string) {
    const id = invoiceId.trim()
    if (!id) return
    setLookingUpInv(txId)
    setInvoiceLookups(prev => ({ ...prev, [txId]: null }))
    try {
      const res  = await fetch(`/api/invoices?action=lookup&invoiceId=${encodeURIComponent(id)}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setInvoiceLookups(prev => ({ ...prev, [txId]: { clientName: '', amount: 0, error: data.error || 'Not found' } }))
      } else {
        setInvoiceLookups(prev => ({ ...prev, [txId]: { clientName: data.clientName, amount: data.amount } }))
        // Auto-add matched client to the list (without removing existing tags)
        const matched = clients.find(c => c.name.toLowerCase() === (data.clientName || '').toLowerCase())
        const current = clientIdMap[txId] || []
        const newIds = matched && !current.includes(matched.id) ? [...current, matched.id] : current
        await tagClient(txId, newIds, id)
      }
    } catch {
      setInvoiceLookups(prev => ({ ...prev, [txId]: { clientName: '', amount: 0, error: 'Lookup failed' } }))
    } finally {
      setLookingUpInv(null)
    }
  }

  function openSplit(tx: any) {
    setSplitTx(tx)
    setSplitError('')
    const half = (parseFloat(tx.amount || 0) / 2).toFixed(2)
    setSplitRows([
      { invoiceId: '', description: '', amount: half, invoiceAmount: null, lookingUp: false, lookupError: '' },
      { invoiceId: '', description: '', amount: half, invoiceAmount: null, lookingUp: false, lookupError: '' },
    ])
  }

  async function lookupInvoiceId(rowIndex: number, invoiceId: string) {
    const id = invoiceId.trim()
    if (!id) return
    setSplitRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, lookingUp: true, lookupError: '' } : r))
    try {
      const res = await fetch(`/api/invoices?action=lookup&invoiceId=${encodeURIComponent(id)}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setSplitRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, lookingUp: false, lookupError: data.error || 'Not found' } : r))
        return
      }
      setSplitRows(prev => prev.map((r, i) =>
        i === rowIndex
          ? { ...r, lookingUp: false, lookupError: '', description: data.clientName || r.description, amount: data.amount ? data.amount.toFixed(2) : r.amount, invoiceAmount: data.amount || null }
          : r
      ))
    } catch {
      setSplitRows(prev => prev.map((r, i) => i === rowIndex ? { ...r, lookingUp: false, lookupError: 'Lookup failed' } : r))
    }
  }

  async function executeSplit() {
    if (!splitTx) return
    setSplitError('')
    if (splitRows.some(r => !r.description.trim() || !(parseFloat(r.amount) > 0))) {
      setSplitError('All rows need a client / description and a positive amount.')
      return
    }
    setSplitting(true)
    try {
      const res = await fetch('/api/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'split',
          bankTxId: splitTx.id,
          splits: splitRows.map(r => ({ description: r.description, amount: parseFloat(r.amount) })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSplitError(data.error || 'Split failed'); return }
      setSplitTx(null)
      await loadData()
      onRefresh()
    } catch (e) {
      setSplitError('Network error')
    } finally {
      setSplitting(false)
    }
  }

  function toggleGroup(code: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  function exportCosts() {
    const rows = costGroups.flatMap(g =>
      g.items.map(item => ({
        'Account Code': g.accountCode,
        'Date': item.date,
        'Vendor': item.vendor,
        'Description': item.description,
        'Amount USD': item.amount,
        'Currency': item.currency,
        'Matched Invoice': item.matchedInvoice || '',
        'Status': item.status,
      }))
    )
    downloadCSV(toCSV(rows, ''), `Costs_${selectedMonth}.csv`)
  }

  const proposedMatches = matches.filter(m => m.status === 'proposed' || m.status === 'flagged')
  const confirmedMatches = matches.filter(m => m.status === 'matched')
  const netRevenue = totalRevenue - totalExpenses
  const matchRate = (costGroups.flatMap(g => g.items).filter(i => i.matchedInvoice).length /
    Math.max(costGroups.flatMap(g => g.items).length, 1) * 100).toFixed(0)

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-narra-muted animate-pulse-soft">
      Loading reconciliation…
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Reconciliation</h2>
          <p className="text-sm text-narra-muted mt-0.5">
            {yearView ? `${selectedYear} · All transactions` : `${selectedMonth?.replace('_', ' ')} · Bank vs Invoices`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Month / Year toggle */}
          <div className="flex rounded-lg border border-narra-border overflow-hidden text-sm font-body">
            <button
              onClick={() => setYearView(false)}
              className={`px-3 py-1.5 transition-all ${!yearView ? 'bg-narra-dark text-white' : 'text-narra-muted hover:bg-narra-light'}`}
            >
              Month
            </button>
            <button
              onClick={() => { setYearView(true) }}
              className={`px-3 py-1.5 transition-all ${yearView ? 'bg-narra-dark text-white' : 'text-narra-muted hover:bg-narra-light'}`}
            >
              Year
            </button>
          </div>
          {!yearView && (
            <>
              <button onClick={rerunAutoMatch} disabled={rerunning}
                className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
                {rerunning ? '↻ Matching…' : '↻ Run Auto-Match'}
              </button>
              <button onClick={() => { loadData(); onRefresh() }}
                className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">
                ↻ Refresh
              </button>
              <button onClick={exportCosts}
                className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">
                ↓ Export Costs CSV
              </button>
            </>
          )}
          {yearView && (
            <button onClick={loadYearData}
              className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">
              ↻ Refresh
            </button>
          )}
        </div>
      </div>

      {rerunMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">{rerunMsg}</div>
      )}

      {/* ── YEAR VIEW ── */}
      {yearView && (
        <div className="space-y-4">
          {yearLoading ? (
            <div className="flex items-center justify-center h-40 text-narra-muted animate-pulse text-sm">Loading {selectedYear} transactions…</div>
          ) : (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Revenue',  value: yearTxns.filter(t => t.type === 'revenue').reduce((s, t) => s + parseFloat(t.amount_usd || 0), 0), color: 'text-green-600' },
                  { label: 'Expenses', value: yearTxns.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount_usd || 0), 0), color: 'text-red-500' },
                  { label: 'Tagged',   value: yearTxns.filter(t => t.type === 'revenue' && t.client_id).length, color: 'text-narra-dark', isTxCount: true, total: yearTxns.filter(t => t.type === 'revenue').length },
                ].map(k => (
                  <div key={k.label} className="bg-white border border-narra-border rounded-xl p-4">
                    <div className="text-xs text-narra-muted uppercase tracking-widest mb-1 font-body">{k.label}</div>
                    <div className={`font-heading text-xl font-semibold ${k.color}`}>
                      {(k as any).isTxCount
                        ? `${k.value} / ${(k as any).total} txns`
                        : `$${(k.value as number).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                      }
                    </div>
                  </div>
                ))}
              </div>

              {/* Transaction table */}
              <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-narra-dark text-white">
                      {['Month', 'Date', 'Description', 'Amount', 'Type', 'Tag Client'].map(h => (
                        <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {yearTxns.map((tx: any, i) => {
                      const isRevenue = tx.type === 'revenue'
                      return (
                        <tr key={tx.id} className={`border-t hover:bg-narra-surface transition-colors ${isRevenue ? 'border-blue-100' : 'border-narra-border/40'}`}>
                          <td className="px-4 py-2.5 text-xs text-narra-muted whitespace-nowrap">{(tx.period_label || '').replace('_', ' ')}</td>
                          <td className="px-4 py-2.5 text-xs text-narra-muted whitespace-nowrap">{String(tx.date).split('T')[0]}</td>
                          <td className="px-4 py-2.5 text-narra-dark max-w-xs">
                            <div className="truncate">{tx.description}</div>
                          </td>
                          <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${isRevenue ? 'text-green-600' : 'text-red-500'}`}>
                            {tx.currency !== 'USD' && <span className="text-xs text-narra-muted mr-1">{tx.currency}</span>}
                            $<input
                              defaultValue={parseFloat(tx.amount_usd || tx.amount || 0).toFixed(2)}
                              onBlur={e => {
                                const val = parseFloat(e.target.value)
                                const cur = parseFloat(tx.amount_usd || tx.amount || 0)
                                if (!isNaN(val) && val > 0 && Math.abs(val - cur) > 0.001) updateAmount(tx.id, val)
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              className={`w-24 text-right bg-transparent border-b border-transparent hover:border-current focus:border-current outline-none ${isRevenue ? 'text-green-600' : 'text-red-500'}`}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isRevenue ? 'bg-blue-100 text-blue-700' : 'bg-red-50 text-red-600'}`}>
                              {isRevenue ? 'Revenue' : 'Expense'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {isRevenue && clients.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {(clientIdMap[tx.id] || []).length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {(clientIdMap[tx.id] || []).map(cid => {
                                      const cl = clients.find(c => c.id === cid)
                                      if (!cl) return null
                                      return (
                                        <span key={cid} className="flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                                          {cl.name}
                                          <button
                                            onClick={() => {
                                              const updated = (clientIdMap[tx.id] || []).filter(id => id !== cid)
                                              tagClient(tx.id, updated)
                                            }}
                                            className="text-blue-400 hover:text-blue-700 ml-0.5 leading-none"
                                          >×</button>
                                        </span>
                                      )
                                    })}
                                  </div>
                                )}
                                <select
                                  value=""
                                  onChange={async e => {
                                    if (!e.target.value) return
                                    const cid = parseInt(e.target.value)
                                    const select = e.currentTarget
                                    const current = clientIdMap[tx.id] || []
                                    if (!current.includes(cid)) await tagClient(tx.id, [...current, cid])
                                    select.value = ''
                                  }}
                                  disabled={taggingTx === tx.id}
                                  className="text-xs border border-blue-300 rounded-lg px-2 py-1 bg-white outline-none max-w-[200px] text-blue-800 disabled:opacity-50"
                                >
                                  <option value="">
                                    {(clientIdMap[tx.id] || []).length > 0 ? '+ Add client…' : 'Tag client…'}
                                  </option>
                                  {clients
                                    .filter(c => !(clientIdMap[tx.id] || []).includes(c.id))
                                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              </div>
                            ) : (
                              <span className="text-xs text-narra-muted">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {yearTxns.length === 0 && (
                  <div className="p-8 text-center text-narra-muted text-sm">No transactions found for {selectedYear}.</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* KPI tiles — month view only */}
      {!yearView && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Revenue',       value: `$${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,  color: 'text-green-600' },
          { label: 'Total Costs',   value: `$${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, color: 'text-red-500' },
          { label: 'Net',           value: `$${netRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,    color: netRevenue >= 0 ? 'text-green-600' : 'text-red-500' },
          { label: 'Invoice Match', value: `${matchRate}%`, color: parseInt(matchRate) >= 80 ? 'text-green-600' : 'text-amber-600',
            sub: `${confirmedMatches.length} matched · ${proposedMatches.length} need review` },
        ].map(t => (
          <div key={t.label} className="bg-white border border-narra-border rounded-xl p-5">
            <div className="text-xs text-narra-muted uppercase tracking-widest mb-2 font-body">{t.label}</div>
            <div className={`font-heading text-2xl font-semibold ${t.color}`}>{t.value}</div>
            {t.sub && <div className="text-xs text-narra-muted mt-1">{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* Proposed matches banner */}
      {proposedMatches.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0" />
            <div>
              <p className="font-heading font-semibold text-amber-800 text-sm">
                {proposedMatches.length} match{proposedMatches.length > 1 ? 'es' : ''} need your review
              </p>
              <p className="text-amber-600 text-xs mt-0.5">AI found possible matches but confidence was medium — approve or decline each one</p>
            </div>
          </div>
          <button onClick={() => setActiveTab('matches')}
            className="px-4 py-2 bg-amber-800 text-white rounded-lg text-xs font-body hover:bg-amber-900 transition-all">
            Review Now
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-narra-border">
        {[
          { id: 'overview',  label: 'Costs Breakdown' },
          { id: 'matches',   label: `Matches ${matches.length > 0 ? `(${confirmedMatches.length} confirmed${proposedMatches.length > 0 ? `, ${proposedMatches.length} pending` : ''})` : ''}` },
          { id: 'unmatched', label: `Unmatched${unmatched.length > 0 ? ` (${unmatched.length})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={`px-5 py-2.5 text-sm font-body transition-all border-b-2 -mb-px whitespace-nowrap
              ${activeTab === t.id ? 'text-narra-dark border-narra-dark font-medium' : 'text-narra-muted border-transparent hover:text-narra-dark'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── COSTS BREAKDOWN ── */}
      {activeTab === 'overview' && (
        <div className="space-y-3">
          <p className="text-xs text-narra-muted">
            Costs pulled from your uploaded bank statement · Grouped by account code · Click to expand
          </p>

          {costGroups.length === 0 ? (
            <div className="bg-narra-light/40 border border-narra-border rounded-xl p-8 text-center">
              <div className="mb-2 flex justify-center"><Landmark size={28} className="text-narra-muted" /></div>
              <p className="font-heading font-semibold text-narra-dark">No cost data yet</p>
              <p className="text-narra-muted text-sm mt-1">Upload your bank statement in the Bank Import tab first.</p>
            </div>
          ) : (
            <>
              {costGroups.map(group => (
                <div key={group.accountCode} className="bg-white border border-narra-border rounded-xl overflow-hidden">
                  {/* Group header — clickable to expand */}
                  <button
                    onClick={() => toggleGroup(group.accountCode)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-narra-surface transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-narra-muted text-sm transition-transform duration-200" style={{
                        display: 'inline-block',
                        transform: expandedGroups.has(group.accountCode) ? 'rotate(90deg)' : 'rotate(0deg)'
                      }}>▶</span>
                      <span className="font-heading font-semibold text-narra-dark text-sm">{group.accountCode}</span>
                      <span className="text-xs text-narra-muted bg-narra-light px-2 py-0.5 rounded-full">
                        {group.items.length} transaction{group.items.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-narra-muted">
                        {group.items.filter(i => i.matchedInvoice).length}/{group.items.length} invoices matched
                      </span>
                    </div>
                    <span className="font-heading font-semibold text-red-500">
                      ${group.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </button>

                  {/* Expanded detail rows */}
                  {expandedGroups.has(group.accountCode) && (
                    <div className="border-t border-narra-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-narra-surface">
                            {['Date', 'Vendor / Description', 'Amount', 'Invoice', 'Account', 'Status', ''].map(h => (
                              <th key={h} className={`px-4 py-2 text-xs font-body text-narra-muted uppercase tracking-wider ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item, i) => (
                            <tr key={i} className="border-t border-narra-border/40 hover:bg-narra-surface transition-colors">
                              <td className="px-4 py-2.5 text-narra-muted text-xs whitespace-nowrap">{item.date}</td>
                              <td className="px-4 py-2.5 text-narra-dark max-w-xs">
                                <div className="font-medium truncate">{item.vendor}</div>
                                {item.description !== item.vendor && (
                                  <div className="text-xs text-narra-muted truncate">{item.description}</div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium text-red-500 whitespace-nowrap">
                                <input
                                  defaultValue={item.amount.toFixed(2)}
                                  onBlur={e => {
                                    const val = parseFloat(e.target.value)
                                    if (!isNaN(val) && val > 0 && val !== item.amount) updateAmount(item.id, val)
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                  className="w-24 text-right bg-transparent border-b border-transparent hover:border-red-300 focus:border-red-400 outline-none text-red-500 font-medium"
                                />
                              </td>
                              <td className="px-4 py-2.5">
                                {item.matchedInvoice ? (
                                  <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                                    ✓ {item.matchedInvoice.length > 25 ? item.matchedInvoice.slice(0, 25) + '…' : item.matchedInvoice}
                                  </span>
                                ) : (
                                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                    ⚠ No invoice
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <select
                                  defaultValue={item.accountCode}
                                  onChange={e => retagBankTx(item.id, e.target.value)}
                                  className="text-xs bg-narra-light border border-narra-border rounded-lg px-2 py-1 outline-none cursor-pointer text-narra-dark hover:border-narra-muted transition-colors"
                                  title="Retag this expense's account category"
                                >
                                  {ACCOUNT_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                                  {!ACCOUNT_OPTIONS.includes(item.accountCode) && (
                                    <option value={item.accountCode}>{item.accountCode}</option>
                                  )}
                                </select>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  item.status === 'matched'   ? 'bg-green-50 text-green-700' :
                                  item.status === 'proposed'  ? 'bg-amber-50 text-amber-700' :
                                  'bg-narra-light text-narra-muted'
                                }`}>{item.status}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <button
                                  onClick={() => deleteBankTx(item.id)}
                                  disabled={deletingTx === item.id}
                                  title="Delete this transaction (removes duplicate)"
                                  className="w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs flex items-center justify-center disabled:opacity-30"
                                >
                                  {deletingTx === item.id ? '…' : '✕'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-narra-dark bg-narra-surface">
                            <td colSpan={2} className="px-4 py-2.5 font-heading font-semibold text-narra-dark text-sm">Subtotal</td>
                            <td className="px-4 py-2.5 text-right font-heading font-bold text-red-500">
                              ${group.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {/* Total */}
              <div className="bg-narra-dark text-white rounded-xl px-5 py-4 flex justify-between items-center">
                <span className="font-heading font-semibold">Total Expenses</span>
                <span className="font-heading text-2xl font-semibold text-narra-green">
                  ${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── MATCHES ── */}
      {activeTab === 'matches' && (
        <div className="space-y-4">
          {/* Proposed + Flagged — need review */}
          {proposedMatches.length > 0 && (
            <div>
              <h3 className="font-heading font-semibold text-amber-700 mb-3 flex items-center gap-2">
                <AlertTriangle size={16} /> Proposed Matches — Review Required
              </h3>
              <div className="space-y-2">
                {proposedMatches.map((pair, i) => (
                  <div key={i} className={`border rounded-xl overflow-hidden ${pair.status === 'flagged' ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-200'}`}>
                    {pair.status === 'flagged' && (
                      <div className="px-4 py-1.5 bg-red-100 border-b border-red-200 text-xs text-red-700 font-medium">
                        Amount discrepancy: {pair.discrepancyPct?.toFixed(1)}% — verify before approving
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-0 text-sm">
                      {/* Bank side */}
                      <div className={`px-4 py-3 border-r ${pair.status === 'flagged' ? 'border-red-200' : 'border-amber-200'}`}>
                        <div className={`text-xs uppercase tracking-wider mb-1 font-body ${pair.status === 'flagged' ? 'text-red-700' : 'text-amber-700'}`}>Bank Transaction</div>
                        <div className={`font-medium ${pair.status === 'flagged' ? 'text-red-900' : 'text-amber-900'}`}>{pair.bankDescription}</div>
                        <div className={`text-xs mt-0.5 ${pair.status === 'flagged' ? 'text-red-700' : 'text-amber-700'}`}>{pair.bankDate} · {pair.bankCurrency} ${pair.bankAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                        {pair.bankAccount && <div className="text-amber-600 text-xs">{pair.bankAccount}</div>}
                      </div>
                      {/* Invoice side */}
                      <div className="px-4 py-3">
                        <div className={`text-xs uppercase tracking-wider mb-1 font-body ${pair.status === 'flagged' ? 'text-red-700' : 'text-amber-700'}`}>Matched Invoice</div>
                        <div className={`font-medium ${pair.status === 'flagged' ? 'text-red-900' : 'text-amber-900'}`}>{pair.invoiceVendor || '—'}</div>
                        <div className={`text-xs mt-0.5 ${pair.status === 'flagged' ? 'text-red-700' : 'text-amber-700'}`}>
                          {pair.invoiceDate} · USD ${pair.invoiceAmount?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '—'}
                        </div>
                        {pair.invoiceFile && <div className="text-amber-600 text-xs truncate">{pair.invoiceFile}</div>}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className={`px-4 py-2.5 border-t flex items-center justify-between ${pair.status === 'flagged' ? 'border-red-200 bg-red-100/50' : 'border-amber-200 bg-amber-100/50'}`}>
                      <span className={`text-xs ${pair.status === 'flagged' ? 'text-red-700 font-medium' : 'text-amber-700'}`}>
                        Amount diff: ${Math.abs((pair.bankAmount || 0) - (pair.invoiceAmount || 0)).toFixed(2)}
                        {pair.discrepancyPct && pair.discrepancyPct > 5 ? ` (${pair.discrepancyPct.toFixed(1)}%)` : ''}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => unmatch(pair)}
                          disabled={unmatching === pair.bankTxId}
                          className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-body hover:bg-red-600 transition-all disabled:opacity-50 flex items-center gap-1"
                        >
                          ✕ Decline
                        </button>
                        <button
                          onClick={() => approveMatch(pair)}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-body hover:bg-green-700 transition-all flex items-center gap-1"
                        >
                          ✓ Approve
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirmed matches */}
          {confirmedMatches.length > 0 && (
            <div>
              <h3 className="font-heading font-semibold text-narra-dark mb-3 flex items-center gap-2">
                <span className="text-lg">✅</span> Confirmed Matches
                <span className="text-xs font-body text-narra-muted font-normal">— click ✕ to unmatch any</span>
              </h3>
              <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-narra-dark text-white">
                      {['Bank Transaction', 'Date', 'Amount', 'Invoice', 'Account', ''].map(h => (
                        <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {confirmedMatches.map((pair, i) => (
                      <tr key={i} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                        <td className="px-4 py-3 text-narra-dark max-w-xs">
                          <div className="font-medium truncate">{pair.bankDescription}</div>
                          <div className="text-xs text-narra-muted">{pair.bankAccount}</div>
                        </td>
                        <td className="px-4 py-3 text-narra-muted text-xs whitespace-nowrap">{pair.bankDate}</td>
                        <td className="px-4 py-3 text-right font-medium text-narra-dark whitespace-nowrap">
                          {pair.bankCurrency} $<input
                            defaultValue={pair.bankAmount.toFixed(2)}
                            onBlur={e => {
                              const val = parseFloat(e.target.value)
                              if (!isNaN(val) && val > 0 && Math.abs(val - pair.bankAmount) > 0.001) updateAmount(pair.bankTxId, val)
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="w-24 text-right bg-transparent border-b border-transparent hover:border-narra-muted focus:border-narra-dark outline-none text-narra-dark font-medium"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {pair.invoiceVendor ? (
                            <div>
                              <div className="text-narra-dark font-medium">{pair.invoiceVendor}</div>
                              {pair.invoiceFile && <div className="text-xs text-narra-muted truncate max-w-[160px]">{pair.invoiceFile}</div>}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-narra-muted text-xs italic">No invoice on file</span>
                              <button
                                onClick={() => acknowledgeTx(pair.bankTxId)}
                                disabled={acknowledging === pair.bankTxId}
                                title="I've verified this manually — dismiss the alert"
                                className="text-xs px-2 py-0.5 bg-narra-light text-narra-muted hover:bg-green-100 hover:text-green-700 rounded-full transition-all disabled:opacity-30"
                              >
                                {acknowledging === pair.bankTxId ? '…' : '✓ Dismiss'}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-narra-muted">{pair.accountCode}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => unmatch(pair)}
                            disabled={unmatching === pair.bankTxId}
                            title="Unmatch this pair"
                            className="w-6 h-6 rounded-full bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all text-xs flex items-center justify-center disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {matches.length === 0 && (
            <div className="bg-narra-light/40 border border-narra-border rounded-xl p-8 text-center">
              <div className="text-3xl mb-2">🔗</div>
              <p className="font-heading font-semibold text-narra-dark">No matches yet</p>
              <p className="text-narra-muted text-sm mt-1">Upload bank statement and sync invoices — auto-matching runs automatically.</p>
            </div>
          )}
        </div>
      )}

      {/* ── UNMATCHED ── */}
      {activeTab === 'unmatched' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <h3 className="font-heading font-semibold text-narra-dark">Unmatched Bank Transactions</h3>
            {unmatched.filter((t: any) => t.type === 'expense').length > 1 && (
              <button
                onClick={acknowledgeAll}
                disabled={acknowledgingAll}
                className="text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 transition-all disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {acknowledgingAll ? '…' : `✓ I see it all (${unmatched.filter((t: any) => t.type === 'expense').length} expenses)`}
              </button>
            )}
          </div>

          {/* How-to guide */}
          {unmatched.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-blue-800 uppercase tracking-wider">Revenue rows (blue)</p>
                <p className="text-xs text-blue-700">Money received in the bank. Use the <strong>Tag client</strong> dropdown to say which client this payment came from — this feeds the Clients page.</p>
                <p className="text-xs text-blue-600">If it's one payment covering multiple clients, use <strong>⊕ Split</strong> to divide it.</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Expense rows (amber)</p>
                <p className="text-xs text-amber-700">Money paid out. If you have an invoice for it, pick it from <strong>Match to invoice</strong>. If it covers multiple invoices, use <strong>⊕ Split</strong>.</p>
                <p className="text-xs text-amber-600">No invoice? Click <strong>✓ I see it</strong> to mark it as reviewed and clear it from this list.</p>
              </div>
            </div>
          )}

          {unmatched.length === 0 && acknowledged.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
              <div className="mb-2 flex justify-center"><CheckCircle2 size={28} className="text-green-600" /></div>
              <p className="font-heading font-semibold text-green-800">All transactions matched!</p>
            </div>
          ) : unmatched.length === 0 && acknowledged.length > 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="font-heading font-semibold text-green-800">All cleared — {acknowledged.length} manually verified</p>
            </div>
          ) : (
            <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
                <span className="text-sm font-medium text-amber-800">
                  <AlertTriangle size={14} className="inline mr-1" />{unmatched.length} unmatched · ${unmatched.reduce((s: number, t: any) => s + parseFloat(t.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} total
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-amber-800/10">
                    {['Type', 'Date', 'Description', 'Amount', 'Account', 'What to do'].map(h => (
                      <th key={h} className={`px-4 py-2.5 text-xs font-body text-amber-800/60 uppercase tracking-wider ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((tx: any, i) => {
                    const availableInvoices = allInvoices.filter(inv => inv.status === 'unmatched')
                    const isLinking = linkingTx === tx.id
                    const isRevenue = tx.type === 'revenue'
                    return (
                    <tr key={i} className={`border-t hover:bg-amber-50/50 ${isRevenue ? 'border-blue-100 bg-blue-50/30' : 'border-amber-100'}`}>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isRevenue ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isRevenue ? 'Revenue' : 'Expense'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-amber-700 text-xs whitespace-nowrap">{String(tx.date).split('T')[0]}</td>
                      <td className="px-4 py-3 text-amber-900 font-medium">{tx.description}</td>
                      <td className="px-4 py-3 text-right font-medium text-amber-900 whitespace-nowrap">
                        <span className="text-xs text-amber-600 mr-1">{tx.currency}</span>
                        <input
                          defaultValue={parseFloat(tx.amount || 0).toFixed(2)}
                          onBlur={e => {
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val) && val > 0 && val !== parseFloat(tx.amount)) updateAmount(tx.id, val)
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          className="w-24 text-right bg-transparent border-b border-transparent hover:border-amber-400 focus:border-amber-500 outline-none font-medium text-amber-900"
                        />
                      </td>
                      <td className="px-4 py-3 text-amber-600 text-xs">{tx.account || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          {isRevenue && (
                            <div className="flex flex-col gap-1">
                              {/* Tagged clients */}
                              {(clientIdMap[tx.id] || []).length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {(clientIdMap[tx.id] || []).map(cid => {
                                    const cl = clients.find(c => c.id === cid)
                                    if (!cl) return null
                                    return (
                                      <span key={cid} className="flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                                        {cl.name}
                                        <button
                                          onClick={() => {
                                            const updated = (clientIdMap[tx.id] || []).filter(id => id !== cid)
                                            tagClient(tx.id, updated, invoiceInputs[tx.id] ?? tx.invoice_ref)
                                          }}
                                          className="text-blue-400 hover:text-blue-700 ml-0.5 leading-none"
                                        >×</button>
                                      </span>
                                    )
                                  })}
                                </div>
                              )}
                              {/* Add client dropdown */}
                              {clients.length > 0 && (
                                <select
                                  value=""
                                  onChange={e => {
                                    if (!e.target.value) return
                                    const cid = parseInt(e.target.value)
                                    const select = e.currentTarget
                                    const current = clientIdMap[tx.id] || []
                                    if (!current.includes(cid)) {
                                      tagClient(tx.id, [...current, cid], invoiceInputs[tx.id] ?? tx.invoice_ref)
                                    }
                                    select.value = ''
                                  }}
                                  disabled={taggingTx === tx.id}
                                  className="text-xs border border-blue-300 rounded-lg px-2 py-1 bg-white outline-none max-w-[220px] text-blue-800 disabled:opacity-50"
                                >
                                  <option value="">
                                    {(clientIdMap[tx.id] || []).length > 0 ? '+ Add client…' : 'Tag client…'}
                                  </option>
                                  {clients
                                    .filter(c => !(clientIdMap[tx.id] || []).includes(c.id))
                                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              )}
                              {/* Invoice ID input */}
                              <div className="flex items-center gap-1">
                                <input
                                  value={invoiceInputs[tx.id] ?? (tx.invoice_ref || '')}
                                  onChange={e => setInvoiceInputs(prev => ({ ...prev, [tx.id]: e.target.value }))}
                                  onBlur={e => { if (e.target.value.trim()) lookupRevenueInvoice(tx.id, e.target.value) }}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupRevenueInvoice(tx.id, invoiceInputs[tx.id] ?? tx.invoice_ref ?? '') } }}
                                  placeholder="Invoice ID (e.g. INV-2025-001)"
                                  className="text-xs border border-blue-200 rounded-lg px-2 py-1 bg-white outline-none w-44 font-mono focus:ring-1 focus:ring-blue-300"
                                />
                                {lookingUpInv === tx.id && <span className="text-xs text-blue-400 animate-pulse-soft">…</span>}
                              </div>
                              {/* Lookup result */}
                              {invoiceLookups[tx.id] && (
                                invoiceLookups[tx.id]?.error
                                  ? <p className="text-xs text-red-500">{invoiceLookups[tx.id]?.error}</p>
                                  : <p className="text-xs text-green-700">✓ {invoiceLookups[tx.id]?.clientName} · ${invoiceLookups[tx.id]?.amount?.toLocaleString()}</p>
                              )}
                            </div>
                          )}
                          {!isRevenue && allInvoices.length > 0 ? (
                            /* Expense — show all invoices, already-linked ones show link count */
                            <div className="flex flex-col gap-1.5">
                              <select
                                className="text-xs border border-blue-300 rounded-lg px-2 py-1 bg-white outline-none max-w-[220px] text-blue-800"
                                defaultValue=""
                                disabled={reassigning === tx.id}
                                onChange={e => {
                                  if (e.target.value) reassignInvoice(tx.id, null, parseInt(e.target.value))
                                }}
                              >
                                <option value="">Match to invoice…</option>
                                {allInvoices.map(inv => {
                                  const linked = txCountByInvoice[inv.id] || 0
                                  return (
                                    <option key={inv.id} value={inv.id}>
                                      {inv.vendor} · ${parseFloat(inv.amount_usd || inv.amount || 0).toFixed(2)}{inv.currency !== 'USD' ? ` (${inv.currency})` : ''}{linked > 0 ? ` · ${linked} linked` : ''}
                                    </option>
                                  )
                                })}
                              </select>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  onClick={() => openSplit(tx)}
                                  title="Split this payment across multiple clients/invoices"
                                  className="text-xs px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full transition-all whitespace-nowrap"
                                >
                                  ⊕ Split
                                </button>
                                <select
                                  defaultValue=""
                                  onChange={async e => {
                                    if (!e.target.value) return
                                    await fetch('/api/bank', {
                                      method: 'PATCH', credentials: 'include',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'tag_transfer', bankTxId: tx.id, account: e.target.value }),
                                    })
                                    await loadData(); onRefresh()
                                  }}
                                  className="text-xs px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-full transition-all border border-amber-200 outline-none cursor-pointer whitespace-nowrap"
                                >
                                  <option value="">↳ Tag as transfer…</option>
                                  <option value="452 - Bank Fees">Bank Fee</option>
                                  <option value="525 - FX Gains/Losses">FX Transfer Cost</option>
                                </select>
                                <button
                                  onClick={() => acknowledgeTx(tx.id)}
                                  disabled={acknowledging === tx.id}
                                  title="I've verified this manually — dismiss the alert"
                                  className="text-xs px-2 py-1 bg-green-50 text-green-700 hover:bg-green-100 rounded-full transition-all disabled:opacity-30 whitespace-nowrap"
                                >
                                  {acknowledging === tx.id ? '…' : '✓ I see it'}
                                </button>
                                <button
                                  onClick={() => deleteBankTx(tx.id)}
                                  disabled={deletingTx === tx.id}
                                  title="Delete — use if this is a duplicate or error"
                                  className="w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs flex items-center justify-center disabled:opacity-30"
                                >
                                  {deletingTx === tx.id ? '…' : '✕'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                onClick={() => openSplit(tx)}
                                title="Split this payment across multiple clients/invoices"
                                className="text-xs px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full transition-all whitespace-nowrap"
                              >
                                ⊕ Split
                              </button>
                              <select
                                defaultValue=""
                                onChange={async e => {
                                  if (!e.target.value) return
                                  await fetch('/api/bank', {
                                    method: 'PATCH', credentials: 'include',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'tag_transfer', bankTxId: tx.id, account: e.target.value }),
                                  })
                                  await loadData(); onRefresh()
                                }}
                                className="text-xs px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-full transition-all border border-amber-200 outline-none cursor-pointer whitespace-nowrap"
                              >
                                <option value="">↳ Tag as transfer…</option>
                                <option value="452 - Bank Fees">Bank Fee</option>
                                <option value="525 - FX Gains/Losses">FX Transfer Cost</option>
                              </select>
                              <button
                                onClick={() => acknowledgeTx(tx.id)}
                                disabled={acknowledging === tx.id}
                                title="I've verified this manually — dismiss the alert"
                                className="text-xs px-2 py-1 bg-green-50 text-green-700 hover:bg-green-100 rounded-full transition-all disabled:opacity-30 whitespace-nowrap"
                              >
                                {acknowledging === tx.id ? '…' : '✓ I see it'}
                              </button>
                              <button
                                onClick={() => deleteBankTx(tx.id)}
                                disabled={deletingTx === tx.id}
                                title="Delete — use if this is a duplicate or error"
                                className="w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs flex items-center justify-center disabled:opacity-30"
                              >
                                {deletingTx === tx.id ? '…' : '✕'}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Acknowledged / manually verified */}
          {acknowledged.length > 0 && (
            <div>
              <button
                onClick={() => setShowAcknowledged(v => !v)}
                className="text-xs text-narra-muted hover:text-narra-dark flex items-center gap-1.5 transition-colors"
              >
                <span>{showAcknowledged ? '▼' : '▶'}</span>
                {acknowledged.length} manually verified (acknowledged)
              </button>
              {showAcknowledged && (
                <div className="mt-2 bg-white border border-narra-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {acknowledged.map((tx: any, i) => (
                        <tr key={i} className="border-t border-narra-border/40 hover:bg-narra-surface text-narra-muted">
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap">{String(tx.date).split('T')[0]}</td>
                          <td className="px-4 py-2.5">{tx.description}</td>
                          <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap">{tx.currency} ${parseFloat(tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-2.5 text-xs">{tx.account || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">Verified</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      </>)}

      {/* ── SPLIT MODAL ── */}
      {splitTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSplitTx(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5">
            <div>
              <h3 className="font-heading font-semibold text-narra-dark text-lg">Split Transaction</h3>
              <p className="text-xs text-narra-muted mt-1">
                {splitTx.description} · {splitTx.currency} ${parseFloat(splitTx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} · {String(splitTx.date).split('T')[0]}
              </p>
            </div>

            {/* Split rows */}
            <div className="space-y-3">
              {splitRows.map((row, i) => (
                <div key={i} className="border border-narra-border rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-narra-muted">Split {i + 1}</span>
                    {splitRows.length > 2 && (
                      <button
                        onClick={() => setSplitRows(prev => prev.filter((_, j) => j !== i))}
                        className="w-5 h-5 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs flex items-center justify-center"
                      >✕</button>
                    )}
                  </div>

                  {/* Invoice ID lookup row */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        value={row.invoiceId}
                        onChange={e => setSplitRows(prev => prev.map((r, j) => j === i ? { ...r, invoiceId: e.target.value, lookupError: '' } : r))}
                        onBlur={e => lookupInvoiceId(i, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupInvoiceId(i, row.invoiceId) } }}
                        placeholder="Invoice ID (e.g. INV-20250201-001)"
                        className="w-full border border-narra-border rounded-lg px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-purple-300 pr-8"
                      />
                      {row.lookingUp && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-purple-500 animate-pulse-soft">…</span>
                      )}
                    </div>
                    <button
                      onClick={() => lookupInvoiceId(i, row.invoiceId)}
                      disabled={row.lookingUp || !row.invoiceId.trim()}
                      className="text-xs px-2 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg transition-all disabled:opacity-30 whitespace-nowrap"
                    >
                      Look up
                    </button>
                  </div>

                  {row.lookupError && (
                    <p className="text-xs text-red-500">{row.lookupError}</p>
                  )}

                  {/* Client name + amount row */}
                  <div className="flex items-center gap-2">
                    <input
                      value={row.description}
                      onChange={e => setSplitRows(prev => prev.map((r, j) => j === i ? { ...r, description: e.target.value } : r))}
                      placeholder="Client / description"
                      className="flex-1 border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    <div className="flex items-center border border-narra-border rounded-lg overflow-hidden">
                      <span className="px-2 text-xs text-narra-muted bg-narra-surface">{splitTx.currency}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.amount}
                        onChange={e => setSplitRows(prev => prev.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                        className="w-28 px-2 py-2 text-sm outline-none text-right"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setSplitRows(prev => [...prev, { invoiceId: '', description: '', amount: '0', invoiceAmount: null, lookingUp: false, lookupError: '' }])}
              className="text-xs text-purple-700 hover:text-purple-900 flex items-center gap-1"
            >
              + Add another split
            </button>

            {/* Running total */}
            {(() => {
              const splitTotal   = splitRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
              const invoiceTotal = splitRows.reduce((s, r) => s + (r.invoiceAmount || 0), 0)
              const orig         = parseFloat(splitTx.amount || 0)
              const splitDiff    = Math.abs(splitTotal - orig)
              const splitOk      = splitDiff <= 0.02
              const hasLookups   = splitRows.some(r => r.invoiceAmount !== null)
              const invDiff      = invoiceTotal - orig
              return (
                <div className="space-y-2">
                  {hasLookups && (
                    <div className="rounded-lg px-4 py-2.5 text-xs bg-narra-surface border border-narra-border space-y-1">
                      <div className="flex justify-between">
                        <span className="text-narra-muted">Invoice total (from sheet)</span>
                        <span className="font-mono text-narra-dark">{splitTx.currency} ${invoiceTotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-narra-muted">Bank received</span>
                        <span className="font-mono text-narra-dark">{splitTx.currency} ${orig.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-narra-border pt-1 mt-1">
                        <span className="font-medium text-narra-dark">Difference</span>
                        <span className={`font-mono font-medium ${Math.abs(invDiff) <= 0.02 ? 'text-green-600' : invDiff > 0 ? 'text-orange-600' : 'text-red-600'}`}>
                          {Math.abs(invDiff) <= 0.02 ? '✓ Match' : `${invDiff > 0 ? '+' : ''}${splitTx.currency} $${invDiff.toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className={`rounded-lg px-4 py-2.5 text-sm flex justify-between items-center ${splitOk ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <span className={splitOk ? 'text-green-700' : 'text-red-700'}>
                      Split total: {splitTx.currency} ${splitTotal.toFixed(2)}
                    </span>
                    <span className={splitOk ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                      {splitOk ? '✓ Balanced' : `${splitTotal > orig ? '+' : '-'}$${splitDiff.toFixed(2)} off`}
                    </span>
                  </div>
                </div>
              )
            })()}

            {splitError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{splitError}</p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setSplitTx(null)}
                className="px-4 py-2 border border-narra-border rounded-lg text-sm text-narra-muted hover:text-narra-dark transition-all">
                Cancel
              </button>
              <button onClick={executeSplit} disabled={splitting}
                className="px-4 py-2 bg-purple-700 text-white rounded-lg text-sm font-body hover:bg-purple-800 transition-all disabled:opacity-50">
                {splitting ? 'Splitting…' : `Split into ${splitRows.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseCSV(text: string) {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''))
  return lines.slice(1).map(line => {
    const cols: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { cols.push(cur); cur = '' }
      else cur += ch
    }
    cols.push(cur)
    const get = (names: string[]) => {
      for (const n of names) {
        const idx = headers.findIndex(h => h.includes(n))
        if (idx >= 0) return cols[idx]?.trim().replace(/['",$]/g, '') || ''
      }
      return ''
    }
    return {
      date: get(['date']), description: get(['description', 'narration', 'memo']),
      amount: parseFloat(get(['amount', 'debit', 'credit'])) || 0,
      currency: get(['currency']) || 'USD', type: 'expense', account: '',
    }
  }).filter(r => r.amount > 0 && r.date)
}
