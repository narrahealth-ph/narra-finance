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
  notes: string | null
  active: boolean
  ltv: number
}

const BILLING_TYPES = ['annual', 'quarterly', 'monthly', 'one-off']

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
}

export default function ClientsPanel() {
  const [clients,         setClients]         = useState<Client[]>([])
  const [holdingCos,      setHoldingCos]      = useState<HoldingCompany[]>([])
  const [loading,         setLoading]         = useState(true)
  const [editingClient,   setEditingClient]   = useState<Partial<Client> | null>(null)
  const [editingHolding,  setEditingHolding]  = useState<Partial<HoldingCompany> | null>(null)
  const [showHolding,     setShowHolding]     = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [msg,             setMsg]             = useState('')
  const [search,          setSearch]          = useState('')
  const [filterActive,    setFilterActive]    = useState<'all' | 'active' | 'inactive'>('active')

  const load = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/clients', { credentials: 'include' })
    const data = await res.json()
    setClients(data.clients || [])
    setHoldingCos(data.holdingCompanies || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const totalLtv    = clients.reduce((s, c) => s + (c.ltv || 0), 0)
  const activeCount = clients.filter(c => c.active).length
  const churnCount  = clients.filter(c => !c.active).length

  const filtered = clients.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.distributor || '').toLowerCase().includes(search.toLowerCase())
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? c.active : !c.active)
    return matchSearch && matchActive
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

    // Optimistically update local state so UI reflects change immediately
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

  const billingColor = (bt: string) => {
    if (bt === 'annual')    return 'bg-blue-100 text-blue-700'
    if (bt === 'quarterly') return 'bg-purple-100 text-purple-700'
    if (bt === 'monthly')   return 'bg-green-100 text-green-700'
    return 'bg-gray-100 text-gray-600'
  }

  return (
    <>
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Client Registry</h2>
          <p className="text-sm text-narra-muted mt-0.5">
            {activeCount} active · {churnCount} inactive · Total LTV ${totalLtv.toLocaleString()}
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
          <table className="w-full text-sm">
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
                  <td className="px-4 py-2.5 text-narra-muted text-xs">
                    {clients.filter(c => c.holding_company_id === hc.id).map(c => c.name).join(', ') || '—'}
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

      {/* Clients table */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-narra-dark text-white">
              {['Client', 'Holding Group', 'Distributor / Payer', 'Billing', 'LTV', 'Notes', 'Status', ''].map(h => (
                <th key={h} className={`px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60 ${h === 'LTV' ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-narra-muted">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-narra-muted">
                {clients.length === 0 ? 'No clients yet — add your first client above.' : 'No results match your filter.'}
              </td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} className={`border-t border-narra-border hover:bg-narra-surface transition-colors ${!c.active ? 'opacity-50' : ''}`}>
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
                <td className="px-4 py-3 text-right font-medium text-narra-dark">
                  {c.ltv > 0 ? `$${c.ltv.toLocaleString()}` : <span className="text-narra-border">—</span>}
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
                    <button onClick={() => setEditingClient({
                      id: c.id, name: c.name, holding_company_id: c.holding_company_id,
                      distributor: c.distributor || '', billing_type: c.billing_type,
                      notes: c.notes || '', active: c.active,
                    })} className="text-xs text-narra-muted hover:text-narra-dark">Edit</button>
                    <button onClick={() => deleteClient(c.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-narra-dark bg-narra-surface">
                <td colSpan={4} className="px-4 py-3 font-heading font-semibold text-narra-dark text-sm">
                  {filtered.length} client{filtered.length !== 1 ? 's' : ''}
                </td>
                <td className="px-4 py-3 text-right font-heading font-semibold text-narra-dark">
                  ${filtered.reduce((s, c) => s + (c.ltv || 0), 0).toLocaleString()}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

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
                  placeholder="e.g. OFII" />
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
