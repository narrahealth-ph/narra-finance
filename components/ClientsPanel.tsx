'use client'
import { useState, useEffect, useCallback } from 'react'

type HoldingCompany = { id: number; name: string; notes: string }
type Client = {
  id: number
  name: string
  holding_company_id: number | null
  holding_company_name: string | null
  distributor: string | null
  billing_type: string
  contract_start: string | null
  contract_end: string | null
  notes: string | null
  active: boolean
  ltv: number
  invoice_count: number
  group_invoice_count: number
  group_ltv: number
  cash_received: number
}

const BILLING_TYPES = ['annual', 'quarterly', 'monthly', 'one-off']

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function renewalStatus(contractEnd: string | null): { label: string; color: string } | null {
  if (!contractEnd) return null
  const end = new Date(contractEnd)
  const now = new Date()
  const daysUntil = Math.ceil((end.getTime() - now.getTime()) / 86400000)
  if (daysUntil < 0)   return { label: 'Expired', color: 'bg-red-100 text-red-700' }
  if (daysUntil <= 30) return { label: `Renews in ${daysUntil}d`, color: 'bg-amber-100 text-amber-700' }
  if (daysUntil <= 90) return { label: `Renews in ${Math.ceil(daysUntil/30)}mo`, color: 'bg-blue-100 text-blue-700' }
  return null
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
}

export default function ClientsPanel() {
  const [clients,        setClients]        = useState<Client[]>([])
  const [holdingCos,     setHoldingCos]     = useState<HoldingCompany[]>([])
  const [unmatched,      setUnmatched]      = useState<{ name: string; total: number; count: number; last_date: string }[]>([])
  const [loading,        setLoading]        = useState(true)
  const [editingClient,  setEditingClient]  = useState<Partial<Client> | null>(null)
  const [editingHolding, setEditingHolding] = useState<Partial<HoldingCompany> | null>(null)
  const [showHolding,    setShowHolding]    = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [msg,            setMsg]            = useState('')
  const [search,         setSearch]         = useState('')
  const [filterActive,   setFilterActive]   = useState<'all' | 'active' | 'inactive'>('active')
  const [selectedIds,    setSelectedIds]    = useState<Set<number>>(new Set())
  const [bulkHoldingId,      setBulkHoldingId]      = useState<string>('')
  const [bulkSaving,         setBulkSaving]          = useState(false)
  const [sortCol,            setSortCol]             = useState<string>('name')
  const [sortDir,            setSortDir]             = useState<'asc' | 'desc'>('asc')
  const [bulkContractStart,  setBulkContractStart]   = useState<string>('')

  // Invoice viewer (read-only, matched from sheet)
  const [viewingClient,  setViewingClient]  = useState<Client | null>(null)
  const [clientInvoices, setClientInvoices] = useState<any[]>([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoiceSearch,  setInvoiceSearch]  = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/clients', { credentials: 'include' })
    const data = await res.json()
    setClients(data.clients || [])
    setHoldingCos(data.holdingCompanies || [])
    setUnmatched(data.unmatchedNames || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const activeCount    = clients.filter(c => c.active).length
  const churnCount     = clients.filter(c => !c.active).length
  const unmatchedTotal = unmatched.reduce((s, u) => s + Math.round(u.total), 0)
  const unmatchedCount = unmatched.reduce((s, u) => s + u.count, 0)
  const grandTotal     = clients.reduce((s, c) => s + (c.ltv || 0), 0) + unmatchedTotal

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const filtered = clients
    .filter(c => {
      const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.distributor || '').toLowerCase().includes(search.toLowerCase())
      const matchActive = filterActive === 'all' || (filterActive === 'active' ? c.active : !c.active)
      return matchSearch && matchActive
    })
    .sort((a, b) => {
      let av: any, bv: any
      switch (sortCol) {
        case 'name':           av = a.name; bv = b.name; break
        case 'holding':        av = a.holding_company_name || ''; bv = b.holding_company_name || ''; break
        case 'distributor':    av = a.distributor || ''; bv = b.distributor || ''; break
        case 'billing':        av = a.billing_type; bv = b.billing_type; break
        case 'contract_start': av = a.contract_start || ''; bv = b.contract_start || ''; break
        case 'contract_end':   av = a.contract_end || ''; bv = b.contract_end || ''; break
        case 'ltv':            av = a.ltv; bv = b.ltv; break
        case 'pct':            av = a.ltv; bv = b.ltv; break
        default:               av = a.name; bv = b.name
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  async function saveClient() {
    if (!editingClient?.name?.trim()) return
    setSaving(true)
    const method = editingClient.id ? 'PATCH' : 'POST'
    await fetch('/api/clients', {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editingClient, type: 'client' }),
    })
    setSaving(false)
    setEditingClient(null)
    setMsg('Client saved.')
    setTimeout(() => setMsg(''), 3000)
    load()
  }

  async function saveHolding() {
    if (!editingHolding?.name?.trim()) return
    setSaving(true)
    const method = editingHolding.id ? 'PATCH' : 'POST'
    const res = await fetch('/api/clients', {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editingHolding, type: 'holding_company' }),
    })
    const data = await res.json()
    setSaving(false)
    setEditingHolding(null)
    if (data.holdingCompany) {
      setHoldingCos(prev => {
        const existing = prev.findIndex(h => h.id === data.holdingCompany.id)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = data.holdingCompany
          return updated.sort((a, b) => a.name.localeCompare(b.name))
        }
        return [...prev, data.holdingCompany].sort((a, b) => a.name.localeCompare(b.name))
      })
    }
    setMsg('Holding company saved.')
    setTimeout(() => setMsg(''), 3000)
    load()
  }

  async function deleteClient(id: number) {
    if (!confirm('Delete this client?')) return
    await fetch(`/api/clients?id=${id}&type=client`, { method: 'DELETE', credentials: 'include' })
    load()
  }

  async function deleteHolding(id: number) {
    if (!confirm('Delete this holding company? Linked clients will be unlinked.')) return
    await fetch(`/api/clients?id=${id}&type=holding_company`, { method: 'DELETE', credentials: 'include' })
    load()
  }

  async function toggleActive(c: Client) {
    await fetch('/api/clients', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, name: c.name, holdingCompanyId: c.holding_company_id, distributor: c.distributor, billingType: c.billing_type, notes: c.notes, active: !c.active }),
    })
    load()
  }

  async function bulkAssignHolding() {
    if (!selectedIds.size) return
    setBulkSaving(true)
    const holdingId = bulkHoldingId ? parseInt(bulkHoldingId) : null
    await Promise.all(
      Array.from(selectedIds).map(id => {
        const c = clients.find(x => x.id === id)!
        return fetch('/api/clients', {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: c.id, name: c.name, holding_company_id: holdingId,
            distributor: c.distributor, billing_type: c.billing_type,
            notes: c.notes, active: c.active,
          }),
        })
      })
    )
    setBulkSaving(false)
    setSelectedIds(new Set())
    setBulkHoldingId('')
    const label = holdingId ? holdingCos.find(h => h.id === holdingId)?.name : 'no group'
    setMsg(`${selectedIds.size} client${selectedIds.size !== 1 ? 's' : ''} assigned to ${label}.`)
    setTimeout(() => setMsg(''), 4000)
    load()
  }

  function calcContractEnd(startDate: string, billingType: string): string {
    const [y, m, d] = startDate.split('-').map(Number)
    let endY = y, endM = m, endD = d
    if (billingType === 'quarterly') endM += 3
    else if (billingType === 'monthly') endM += 1
    else { endY += 1 }
    while (endM > 12) { endM -= 12; endY += 1 }
    const end = new Date(endY, endM - 1, endD - 1)
    return end.toISOString().split('T')[0]
  }

  async function bulkSetContractDates() {
    if (!selectedIds.size || !bulkContractStart) return
    setBulkSaving(true)
    await Promise.all(
      Array.from(selectedIds).map(id => {
        const c = clients.find(x => x.id === id)!
        const endDate = calcContractEnd(bulkContractStart, c.billing_type)
        return fetch('/api/clients', {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: c.id, name: c.name, holding_company_id: c.holding_company_id,
            distributor: c.distributor, billing_type: c.billing_type,
            notes: c.notes, active: c.active,
            contract_start: bulkContractStart,
            contract_end:   endDate,
          }),
        })
      })
    )
    setBulkSaving(false)
    setSelectedIds(new Set())
    setBulkContractStart('')
    setMsg(`Contract dates set for ${selectedIds.size} client${selectedIds.size !== 1 ? 's' : ''} starting ${bulkContractStart}.`)
    setTimeout(() => setMsg(''), 4000)
    load()
  }

  async function openInvoices(c: Client) {
    setViewingClient(c)
    setInvoiceSearch('')
    setInvoiceLoading(true)
    const res  = await fetch(`/api/clients/invoices?clientId=${c.id}`, { credentials: 'include' })
    const data = await res.json()
    setClientInvoices(data.invoices || [])
    setInvoiceLoading(false)
  }

  const billingColor = (bt: string) => {
    if (bt === 'annual')    return 'bg-blue-100 text-blue-700'
    if (bt === 'quarterly') return 'bg-purple-100 text-purple-700'
    if (bt === 'monthly')   return 'bg-green-100 text-green-700'
    return 'bg-gray-100 text-gray-600'
  }

  const statusColor = (s: string) => {
    const st = (s || '').toLowerCase()
    if (st === 'paid')   return 'text-green-600'
    if (st === 'sent' || st === 'invoiced') return 'text-blue-600'
    if (st === 'outstanding' || st === 'due') return 'text-amber-600'
    return 'text-narra-muted'
  }

  return (
    <>
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Client Registry</h2>
          <p className="text-sm text-narra-muted mt-0.5">
            {activeCount} active · {churnCount} inactive · Total invoiced ${(clients.reduce((s, c) => s + (c.ltv || 0), 0) + unmatchedTotal).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowHolding(v => !v)}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-muted hover:text-narra-dark hover:bg-narra-light transition-all">
            {showHolding ? 'Hide' : 'Manage'} Holding Companies
          </button>
          <button onClick={() => setEditingClient({ billing_type: 'annual', active: true })}
            className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all">
            + Add Client
          </button>
        </div>
      </div>

      {msg && <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">{msg}</div>}

      {/* Holding Companies Panel */}
      {showHolding && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-narra-light/40 border-b border-narra-border flex items-center justify-between">
            <h3 className="font-heading font-semibold text-narra-dark text-sm">Holding Companies</h3>
            <button onClick={() => setEditingHolding({ name: '', notes: '' })}
              className="text-xs text-narra-muted hover:text-narra-dark border border-dashed border-narra-border rounded-lg px-3 py-1.5 hover:border-narra-muted transition-all">
              + Add
            </button>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="bg-narra-dark text-white">
                {['Name', 'Notes', 'Clients', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-body font-normal text-xs tracking-widest uppercase text-white/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdingCos.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-narra-muted text-sm">No holding companies yet</td></tr>
              ) : holdingCos.map(hc => (
                <tr key={hc.id} className="border-t border-narra-border hover:bg-narra-surface">
                  <td className="px-4 py-2.5 font-medium text-narra-dark">{hc.name}</td>
                  <td className="px-4 py-2.5 text-narra-muted">{hc.notes || '—'}</td>
                  <td className="px-4 py-2.5 text-narra-muted text-xs max-w-[200px]">
                    <span className="break-words">{clients.filter(c => c.holding_company_id === hc.id).map(c => c.name).join(', ') || '—'}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingHolding({ id: hc.id, name: hc.name, notes: hc.notes })}
                        className="text-xs text-narra-muted hover:text-narra-dark">Edit</button>
                      <button onClick={() => deleteHolding(hc.id)}
                        className="text-xs text-red-400 hover:text-red-600">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <input
          placeholder="Search clients or distributors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 border border-narra-border rounded-lg px-3 py-2 text-sm text-narra-dark bg-white outline-none focus:ring-2 focus:ring-narra-green/30"
        />
        <div className="flex bg-narra-surface border border-narra-border rounded-lg overflow-hidden text-xs">
          {(['active', 'all', 'inactive'] as const).map(f => (
            <button key={f} onClick={() => setFilterActive(f)}
              className={`px-4 py-2 font-body capitalize transition-all ${filterActive === f ? 'bg-narra-dark text-narra-green' : 'text-narra-muted hover:text-narra-dark'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-indigo-800">{selectedIds.size} client{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-indigo-400 hover:text-indigo-700 ml-auto">Clear</button>
          </div>

          {/* Contract dates */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-indigo-700 font-medium shrink-0">Set contract start date:</span>
            <input
              type="date"
              value={bulkContractStart}
              onChange={e => setBulkContractStart(e.target.value)}
              className="border border-indigo-300 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {bulkContractStart && (
              <div className="text-xs text-indigo-500 w-full">
                <span className="shrink-0 block mb-1">End dates per billing type:</span>
                <div className="flex flex-wrap gap-1">
                  {Array.from(selectedIds).slice(0, 6).map(id => {
                    const c = clients.find(x => x.id === id)
                    if (!c) return null
                    return <span key={id} className="bg-white/70 px-1.5 py-0.5 rounded text-indigo-700 max-w-[180px] truncate">{c.name} → {calcContractEnd(bulkContractStart, c.billing_type)}</span>
                  })}
                  {selectedIds.size > 6 && <span className="text-indigo-400">+{selectedIds.size - 6} more</span>}
                </div>
              </div>
            )}
            <button onClick={bulkSetContractDates} disabled={bulkSaving || !bulkContractStart}
              className="px-4 py-1.5 bg-indigo-700 text-white rounded-lg text-sm font-body hover:bg-indigo-800 transition-all disabled:opacity-50 shrink-0">
              {bulkSaving ? 'Saving…' : 'Set Dates'}
            </button>
          </div>

          {/* Holding company */}
          <div className="flex items-center gap-3 flex-wrap border-t border-indigo-200 pt-3">
            <span className="text-sm text-indigo-700 font-medium shrink-0">Assign holding company:</span>
            <select value={bulkHoldingId} onChange={e => setBulkHoldingId(e.target.value)}
              className="border border-indigo-300 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-300">
              <option value="">— Remove from group —</option>
              {holdingCos.map(hc => <option key={hc.id} value={hc.id}>{hc.name}</option>)}
            </select>
            <button onClick={bulkAssignHolding} disabled={bulkSaving}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-body hover:bg-indigo-700 transition-all disabled:opacity-50">
              {bulkSaving ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </div>
      )}

      {/* Clients table */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-narra-dark text-white">
              <th className="px-4 py-3 w-8">
                <input type="checkbox"
                  checked={filtered.length > 0 && filtered.every(c => selectedIds.has(c.id))}
                  onChange={e => {
                    if (e.target.checked) setSelectedIds(new Set(filtered.map(c => c.id)))
                    else setSelectedIds(new Set())
                  }}
                  className="rounded accent-narra-green cursor-pointer"
                />
              </th>
              {([
                { label: 'Client',               col: 'name',           right: false },
                { label: 'Holding Group',         col: 'holding',        right: false },
                { label: 'Distributor / Payer',   col: 'distributor',    right: false },
                { label: 'Billing',               col: 'billing',        right: false },
                { label: 'Contract Start',        col: 'contract_start', right: false },
                { label: 'Contract End',          col: 'contract_end',   right: false },
                { label: 'Total Invoiced',        col: 'ltv',            right: true  },
                { label: '% of Total',            col: 'pct',            right: true  },
                { label: 'Notes',                 col: '',               right: false },
                { label: 'Status',                col: '',               right: false },
                { label: '',                      col: '',               right: false },
              ] as { label: string; col: string; right: boolean }[]).map(({ label, col, right }) => (
                <th key={label}
                  onClick={() => col && toggleSort(col)}
                  className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${right ? 'text-right' : 'text-left'} ${col ? 'cursor-pointer hover:text-white select-none' : ''}`}>
                  {label}
                  {col && sortCol === col && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="px-4 py-10 text-center text-narra-muted">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={13} className="px-4 py-10 text-center text-narra-muted">
                {clients.length === 0 ? 'No clients yet — add your first client above.' : 'No results match your filter.'}
              </td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} className={`border-t border-narra-border hover:bg-narra-surface transition-colors ${!c.active ? 'opacity-50' : ''} ${selectedIds.has(c.id) ? 'bg-indigo-50/60' : ''}`}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selectedIds.has(c.id)}
                    onChange={e => {
                      const next = new Set(selectedIds)
                      e.target.checked ? next.add(c.id) : next.delete(c.id)
                      setSelectedIds(next)
                    }}
                    className="rounded accent-narra-green cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-narra-dark">{c.name}</span>
                </td>
                <td className="px-4 py-3 text-narra-muted">
                  {c.holding_company_name
                    ? <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{c.holding_company_name}</span>
                    : <span className="text-narra-border">—</span>}
                </td>
                <td className="px-4 py-3">
                  {c.distributor
                    ? <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">{c.distributor}</span>
                    : <span className="text-narra-border text-xs">Direct</span>}
                </td>
                <td className="px-4 py-3">
                  <Badge label={c.billing_type} color={billingColor(c.billing_type)} />
                </td>
                <td className="px-4 py-3 text-narra-muted text-xs whitespace-nowrap">{fmtDate(c.contract_start)}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  {c.contract_end ? (
                    <span>
                      <span className="text-narra-muted">{fmtDate(c.contract_end)}</span>
                      {renewalStatus(c.contract_end) && (
                        <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-medium ${renewalStatus(c.contract_end)!.color}`}>
                          {renewalStatus(c.contract_end)!.label}
                        </span>
                      )}
                    </span>
                  ) : <span className="text-narra-border">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {c.ltv > 0 ? (
                    <div>
                      <div className="font-medium text-narra-dark">${c.ltv.toLocaleString()}</div>
                      <div className="text-narra-muted text-xs">{c.invoice_count} invoice{c.invoice_count !== 1 ? 's' : ''}</div>
                      {c.group_invoice_count > 0 && (
                        <div className="text-xs text-indigo-500 mt-0.5">
                          incl. {c.group_invoice_count} group split{c.group_invoice_count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  ) : <span className="text-narra-border">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {c.ltv > 0 && grandTotal > 0
                    ? <span className="text-sm text-narra-muted">{((c.ltv / grandTotal) * 100).toFixed(1)}%</span>
                    : <span className="text-narra-border">—</span>}
                </td>
                <td className="px-4 py-3 text-narra-muted text-xs max-w-[160px] truncate">{c.notes || '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(c)}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium transition-all ${c.active ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700' : 'bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-700'}`}
                    title={c.active ? 'Mark inactive (churned)' : 'Reactivate'}>
                    {c.active ? 'Active' : 'Churned'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => openInvoices(c)}
                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
                      {c.invoice_count > 0 ? `History (${c.invoice_count})` : 'History'}
                    </button>
                    <button onClick={() => setEditingClient({
                      id: c.id, name: c.name, holding_company_id: c.holding_company_id,
                      distributor: c.distributor || '', billing_type: c.billing_type,
                      contract_start: c.contract_start ? c.contract_start.split('T')[0] : '',
                      contract_end:   c.contract_end   ? c.contract_end.split('T')[0]   : '',
                      notes: c.notes || '', active: c.active,
                    })} className="text-xs text-narra-muted hover:text-narra-dark">Edit</button>
                    <button onClick={() => deleteClient(c.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                  </div>
                </td>
              </tr>
            ))}
            {unmatched.length > 0 && (
              <tr className="border-t-2 border-amber-200 bg-amber-50/60">
                <td className="px-4 py-3" />
                <td colSpan={6} className="px-4 py-3">
                  <span className="text-sm font-medium text-amber-800">Unmatched invoices</span>
                  <span className="text-xs text-amber-600 ml-2">
                    {unmatchedCount} invoice{unmatchedCount !== 1 ? 's' : ''} from {unmatched.length} unrecognized name{unmatched.length !== 1 ? 's' : ''} — not linked to any client
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="font-medium text-amber-800">${unmatchedTotal.toLocaleString()}</div>
                </td>
                <td colSpan={4} />
              </tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-narra-dark bg-narra-surface">
                <td colSpan={7} className="px-4 py-3 font-heading font-semibold text-narra-dark text-sm">
                  {filtered.length} client{filtered.length !== 1 ? 's' : ''}
                  {unmatched.length > 0 && <span className="font-normal text-amber-600"> + {unmatched.length} unmatched</span>}
                </td>
                <td className="px-4 py-3 text-right font-heading font-semibold text-narra-dark">
                  ${(filtered.reduce((s, c) => s + (c.ltv || 0), 0) + unmatchedTotal).toLocaleString()}
                </td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>

      {/* Unmatched invoice names */}
      {unmatched.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-200 flex items-center justify-between">
            <div>
              <h3 className="font-heading font-semibold text-amber-900 text-sm">
                {unmatched.length} unmatched name{unmatched.length !== 1 ? 's' : ''} in the invoice tracker
              </h3>
              <p className="text-xs text-amber-700 mt-0.5">
                These names appear in column I of the outgoing invoice tracker but don't match any client or holding company. Add them to start tracking their revenue.
              </p>
            </div>
          </div>
          <div className="divide-y divide-amber-100">
            {unmatched.map(u => (
              <div key={u.name} className="px-5 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-amber-900">{u.name}</span>
                  <span className="text-xs text-amber-600 ml-3">
                    {u.count} invoice{u.count !== 1 ? 's' : ''} · ${Math.round(u.total).toLocaleString()} total
                    {u.last_date && <span> · last {u.last_date}</span>}
                  </span>
                </div>
                <button
                  onClick={() => setEditingClient({ billing_type: 'annual', active: true, name: u.name })}
                  className="text-xs px-3 py-1.5 bg-amber-700 text-white rounded-lg hover:bg-amber-800 transition-all shrink-0">
                  + Add as client
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Churn insight */}
      {clients.filter(c => !c.active).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <p className="text-sm font-medium text-amber-800">
            {churnCount} client{churnCount !== 1 ? 's' : ''} marked inactive
            {holdingCos.length > 0 && ' — check holding companies to confirm this is churn and not an upsell to the holding group'}
          </p>
          <p className="text-xs text-amber-600 mt-1">
            Mark a client as "Churned" using the status button. If the holding company renewed instead, the client is an upsell — check if the holding group has an active contract.
          </p>
        </div>
      )}

    </div>{/* end animate-fade-up */}

      {/* Invoice Viewer Modal */}
      {viewingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewingClient(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

            <div className="px-6 py-4 border-b border-narra-border flex items-center justify-between">
              <div>
                <h3 className="font-heading font-semibold text-narra-dark text-lg">{viewingClient.name}</h3>
                <p className="text-xs text-narra-muted mt-0.5">Auto-matched from outgoing invoice tracker · accumulates over time</p>
              </div>
              <button onClick={() => setViewingClient(null)} className="text-narra-muted hover:text-narra-dark text-xl leading-none">✕</button>
            </div>

            <div className="px-6 py-4 border-b border-narra-border">
              <input
                placeholder="Search by invoice ID, date, or status…"
                value={invoiceSearch}
                onChange={e => setInvoiceSearch(e.target.value)}
                className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30"
              />
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">
              {invoiceLoading ? (
                <p className="text-sm text-narra-muted">Loading…</p>
              ) : (() => {
                const q = invoiceSearch.toLowerCase()
                const shown = clientInvoices.filter((inv: any) =>
                  !q ||
                  (inv.invoice_id || '').toLowerCase().includes(q) ||
                  (inv.issue_date || '').toLowerCase().includes(q) ||
                  (inv.status || '').toLowerCase().includes(q) ||
                  (inv.description || '').toLowerCase().includes(q)
                )
                if (shown.length === 0) return (
                  <p className="text-sm text-narra-muted italic">
                    {clientInvoices.length === 0
                      ? `No invoices found for "${viewingClient.name}" in the tracker. Make sure the Client Name column (col I) matches exactly.`
                      : 'No results match your search.'}
                  </p>
                )
                const total = shown.reduce((s: number, i: any) => s + parseFloat(i.amount_usd || 0), 0)
                return (
                  <div className="space-y-2">
                    <p className="text-xs text-narra-muted mb-3">
                      {shown.length} invoice{shown.length !== 1 ? 's' : ''} · Total{' '}
                      <span className="font-semibold text-narra-dark">${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </p>
                    {shown.map((inv: any) => (
                      <div key={inv.invoice_id} className="flex items-start gap-3 bg-narra-surface border border-narra-border rounded-lg px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-narra-dark">{inv.invoice_id}</span>
                            {inv.is_holding_split && (
                              <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-full">group split</span>
                            )}
                            <span className={`text-xs font-medium ${statusColor(inv.status)}`}>{inv.status}</span>
                          </div>
                          <div className="text-xs text-narra-muted mt-0.5 flex flex-wrap gap-x-2">
                            {inv.issue_date && <span>{inv.issue_date}</span>}
                            {inv.billing_type && <span>· {inv.billing_type}</span>}
                            {inv.description && <span className="truncate max-w-[240px]">· {inv.description}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-heading font-semibold text-narra-dark">
                            ${parseFloat(inv.amount_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </div>
                          {inv.is_holding_split && inv.original_amount_usd && (
                            <div className="text-xs text-narra-muted">of ${parseFloat(inv.original_amount_usd).toLocaleString()}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            <div className="px-6 py-4 border-t border-narra-border">
              <button onClick={() => setViewingClient(null)}
                className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Client Modal */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingClient(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-y-auto max-h-[90vh] p-6 space-y-4">
            <h3 className="font-heading font-semibold text-narra-dark text-lg">
              {editingClient.id ? 'Edit Client' : 'New Client'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Client Name *</label>
                <input value={editingClient.name || ''} onChange={e => setEditingClient(p => ({ ...p!, name: e.target.value }))}
                  className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30"
                  placeholder="Must match col I in the invoice tracker" />
                <p className="text-xs text-narra-muted mt-1">Must match exactly the Client Name (col I) in the outgoing invoice tracker.</p>
              </div>

              <div>
                <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Holding Company</label>
                <select value={editingClient.holding_company_id || ''} onChange={e => setEditingClient(p => ({ ...p!, holding_company_id: e.target.value ? parseInt(e.target.value) : null }))}
                  className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30 bg-white">
                  <option value="">— None —</option>
                  {holdingCos.map(hc => <option key={hc.id} value={hc.id}>{hc.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">
                  Distributor / Payer
                  <span className="text-narra-muted font-normal normal-case tracking-normal ml-1">— the bank name that sends us the payment</span>
                </label>
                <input value={editingClient.distributor || ''} onChange={e => setEditingClient(p => ({ ...p!, distributor: e.target.value }))}
                  className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30"
                  placeholder="e.g. LAWINA (leave blank if client pays directly)" />
              </div>

              <div>
                <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Billing Type</label>
                <select value={editingClient.billing_type || 'annual'} onChange={e => setEditingClient(p => ({ ...p!, billing_type: e.target.value }))}
                  className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30 bg-white">
                  {BILLING_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Contract Start</label>
                  <input type="date" value={editingClient.contract_start || ''} onChange={e => setEditingClient(p => ({ ...p!, contract_start: e.target.value || null }))}
                    className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30" />
                </div>
                <div>
                  <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Contract End</label>
                  <input type="date" value={editingClient.contract_end || ''} onChange={e => setEditingClient(p => ({ ...p!, contract_end: e.target.value || null }))}
                    className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30" />
                </div>
              </div>

              <div>
                <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Notes</label>
                <textarea value={editingClient.notes || ''} onChange={e => setEditingClient(p => ({ ...p!, notes: e.target.value }))}
                  className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30 resize-none"
                  rows={2} placeholder="Any additional context…" />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditingClient(null)}
                className="px-4 py-2 border border-narra-border rounded-lg text-sm text-narra-muted hover:text-narra-dark transition-all">
                Cancel
              </button>
              <button onClick={saveClient} disabled={saving || !editingClient.name?.trim()}
                className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Holding Company Modal */}
      {editingHolding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingHolding(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-y-auto max-h-[90vh] p-6 space-y-4">
            <h3 className="font-heading font-semibold text-narra-dark text-lg">
              {editingHolding.id ? 'Edit Holding Company' : 'New Holding Company'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Name *</label>
                <input value={editingHolding.name || ''} onChange={e => setEditingHolding(p => ({ ...p!, name: e.target.value }))}
                  className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30"
                  placeholder="e.g. Rayomar Group" />
              </div>
              <div>
                <label className="text-xs text-narra-muted uppercase tracking-widest font-body block mb-1">Notes</label>
                <input value={editingHolding.notes || ''} onChange={e => setEditingHolding(p => ({ ...p!, notes: e.target.value }))}
                  className="w-full border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30"
                  placeholder="Optional context" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditingHolding(null)}
                className="px-4 py-2 border border-narra-border rounded-lg text-sm text-narra-muted hover:text-narra-dark transition-all">
                Cancel
              </button>
              <button onClick={saveHolding} disabled={saving || !editingHolding.name?.trim()}
                className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
