'use client'
import { useState, useEffect } from 'react'

interface Entry {
  account_code: string
  account_name: string
  section: string
  value: number
  notes: string
}

interface Schedule {
  id: number
  service_name: string
  total_amount: number | string
  start_date: string
  months: number
  currency: string
  notes: string
}

function fmt(n: number) {
  return Math.abs(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-6 py-3 bg-narra-light/50 border-b border-narra-border">
      <h3 className="font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider">{title}</h3>
      {subtitle && <p className="text-xs text-narra-muted mt-0.5">{subtitle}</p>}
    </div>
  )
}

function FieldRow({
  code, label, localValues, saving, saved,
  onChange, onSave,
}: {
  code: string
  label: string
  localValues: Record<string, { value: string; notes: string }>
  saving: Record<string, boolean>
  saved: Record<string, boolean>
  onChange: (code: string, field: 'value' | 'notes', val: string) => void
  onSave: (code: string) => void
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-narra-border/50 last:border-0">
      <label className="flex-1 text-sm text-narra-ink">{label}</label>
      <div className="flex items-center gap-2">
        <span className="text-narra-muted text-xs">USD</span>
        <input
          type="number"
          step="0.01"
          value={localValues[code]?.value ?? '0'}
          onChange={e => onChange(code, 'value', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSave(code)}
          className="w-36 text-right border border-narra-border rounded-lg px-3 py-1.5 text-sm font-mono outline-none focus:border-narra-dark"
        />
        <button
          onClick={() => onSave(code)}
          disabled={saving[code]}
          className={`px-3 py-1.5 rounded-lg text-xs font-body transition-all w-14 text-center ${
            saved[code]
              ? 'bg-green-100 text-green-700'
              : 'bg-narra-dark text-narra-green hover:bg-narra-mid'
          } disabled:opacity-50`}
        >
          {saving[code] ? '…' : saved[code] ? '✓' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function ManualEntriesPanel({
  periodId,
  reportData,
  onRefresh,
}: {
  periodId: number
  reportData: any
  onRefresh: () => void
}) {
  const [entries,      setEntries]      = useState<Entry[]>([])
  const [schedules,    setSchedules]    = useState<Schedule[]>([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState<Record<string, boolean>>({})
  const [savedKeys,    setSavedKeys]    = useState<Record<string, boolean>>({})
  const [localValues,  setLocalValues]  = useState<Record<string, { value: string; notes: string }>>({})

  const [newSched, setNewSched] = useState({
    serviceName: '', totalAmount: '', startDate: '', months: '12', currency: 'USD', notes: '',
  })
  const [addingSchedule,    setAddingSchedule]    = useState(false)
  const [converting,        setConverting]        = useState(false)
  const [showConvertConfirm, setShowConvertConfirm] = useState(false)

  useEffect(() => { loadData() }, [periodId])

  async function loadData() {
    setLoading(true)
    const [eRes, sRes] = await Promise.all([
      fetch(`/api/manual-entries?periodId=${periodId}`, { credentials: 'include' }),
      fetch(`/api/manual-entries?action=schedules`,     { credentials: 'include' }),
    ])
    const eData = await eRes.json()
    const sData = await sRes.json()

    const ents: Entry[] = eData.entries || []
    setEntries(ents)
    setSchedules(sData.schedules || [])

    const vals: Record<string, { value: string; notes: string }> = {}
    for (const e of ents) {
      vals[e.account_code] = { value: String(e.value ?? 0), notes: e.notes ?? '' }
    }
    setLocalValues(vals)
    setLoading(false)
  }

  function updateLocal(code: string, field: 'value' | 'notes', val: string) {
    setLocalValues(prev => ({ ...prev, [code]: { ...prev[code], [field]: val } }))
    setSavedKeys(prev => ({ ...prev, [code]: false }))
  }

  async function saveEntry(code: string) {
    setSaving(prev => ({ ...prev, [code]: true }))
    const local = localValues[code]
    await fetch('/api/manual-entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        periodId,
        accountCode: code,
        value: parseFloat(local?.value || '0'),
        notes: local?.notes || '',
      }),
    })
    setSaving(prev => ({ ...prev, [code]: false }))
    setSavedKeys(prev => ({ ...prev, [code]: true }))
    setTimeout(() => setSavedKeys(prev => ({ ...prev, [code]: false })), 2000)
    onRefresh()
  }

  async function addSchedule() {
    if (!newSched.serviceName || !newSched.totalAmount || !newSched.startDate) return
    setAddingSchedule(true)
    await fetch('/api/manual-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'add_schedule',
        serviceName:  newSched.serviceName,
        totalAmount:  parseFloat(newSched.totalAmount),
        startDate:    newSched.startDate,
        months:       parseInt(newSched.months),
        currency:     newSched.currency,
        notes:        newSched.notes,
      }),
    })
    setNewSched({ serviceName: '', totalAmount: '', startDate: '', months: '12', currency: 'USD', notes: '' })
    setAddingSchedule(false)
    await loadData()
    onRefresh()
  }

  async function deleteSchedule(id: number) {
    await fetch('/api/manual-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'delete_schedule', id }),
    })
    await loadData()
    onRefresh()
  }

  async function convertToEquity() {
    setConverting(true)
    setShowConvertConfirm(false)
    await fetch('/api/manual-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'convert_to_equity', periodId }),
    })
    setConverting(false)
    await loadData()
    onRefresh()
  }

  const dir835 = parseFloat(localValues['835']?.value  || '0') || 0
  const dir840 = parseFloat(localValues['840']?.value  || '0') || 0
  const dir842 = parseFloat(localValues['842']?.value  || '0') || 0
  const directorTotal = dir835 + dir840 + dir842

  const inv852 = parseFloat(localValues['852']?.value || '0') || 0
  const inv853 = parseFloat(localValues['853']?.value || '0') || 0
  const investmentTotal = inv852 + inv853

  const [showInvConvertConfirm, setShowInvConvertConfirm] = useState(false)
  const [convertingInv, setConvertingInv] = useState(false)

  async function convertInvestmentsToEquity() {
    setConvertingInv(true)
    setShowInvConvertConfirm(false)
    await fetch('/api/manual-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'convert_investments_to_equity', periodId }),
    })
    setConvertingInv(false)
    await loadData()
    onRefresh()
  }

  const calculatedPrepayments = reportData?.bs?.prepayments ?? 0

  const fieldProps = { localValues, saving, saved: savedKeys, onChange: updateLocal, onSave: saveEntry }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-narra-muted animate-pulse-soft">Loading adjustments…</div>
  )

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h2 className="font-heading text-xl font-semibold text-narra-dark">Manual Adjustments</h2>
        <p className="text-sm text-narra-muted mt-0.5">
          Editable fields for items that can't be calculated from transaction data.
          Calculated fields (cash, AR, AP, deferred revenue, retained earnings) are read-only.
        </p>
      </div>

      {/* ── PREPAYMENTS ── */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <SectionHeader
          title="610 — Prepayments (Auto-calculated)"
          subtitle="Add annual service fee payments below. The remaining balance is amortized monthly into the Balance Sheet."
        />
        <div className="px-6 py-4 flex items-center justify-between border-b border-narra-border/50 bg-narra-light/20">
          <span className="text-sm text-narra-muted">Calculated prepayment balance this period:</span>
          <span className="font-heading font-semibold text-narra-dark text-lg">
            ${fmt(calculatedPrepayments)}
          </span>
        </div>

        {schedules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-narra-border bg-narra-surface">
                  {['Service', 'Total Paid', 'Start Date', 'Months', 'Currency', 'Notes', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => (
                  <tr key={s.id} className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-4 py-3 text-narra-ink font-medium">{s.service_name}</td>
                    <td className="px-4 py-3 font-mono text-narra-dark">{fmt(parseFloat(String(s.total_amount)))}</td>
                    <td className="px-4 py-3 text-narra-muted font-mono text-xs">{String(s.start_date).split('T')[0]}</td>
                    <td className="px-4 py-3 text-narra-muted">{s.months}</td>
                    <td className="px-4 py-3 text-narra-muted">{s.currency}</td>
                    <td className="px-4 py-3 text-narra-muted text-xs">{s.notes}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteSchedule(s.id)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-6 py-4 border-t border-narra-border/50">
          <p className="text-xs font-body text-narra-muted mb-3 font-medium">Add a prepaid service fee</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <input
              placeholder="Service name (e.g. Accounting fees)"
              value={newSched.serviceName}
              onChange={e => setNewSched(p => ({ ...p, serviceName: e.target.value }))}
              className="border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:border-narra-dark"
            />
            <input
              type="number"
              placeholder="Total amount paid"
              value={newSched.totalAmount}
              onChange={e => setNewSched(p => ({ ...p, totalAmount: e.target.value }))}
              className="border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:border-narra-dark"
            />
            <input
              type="date"
              value={newSched.startDate}
              onChange={e => setNewSched(p => ({ ...p, startDate: e.target.value }))}
              className="border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:border-narra-dark text-narra-muted"
            />
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Months"
                value={newSched.months}
                onChange={e => setNewSched(p => ({ ...p, months: e.target.value }))}
                className="border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:border-narra-dark w-24"
              />
              <select
                value={newSched.currency}
                onChange={e => setNewSched(p => ({ ...p, currency: e.target.value }))}
                className="border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:border-narra-dark"
              >
                {['USD', 'SGD', 'EUR', 'GBP', 'PHP'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <input
              placeholder="Notes (optional)"
              value={newSched.notes}
              onChange={e => setNewSched(p => ({ ...p, notes: e.target.value }))}
              className="border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:border-narra-dark"
            />
            <button
              onClick={addSchedule}
              disabled={addingSchedule || !newSched.serviceName || !newSched.totalAmount || !newSched.startDate}
              className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50"
            >
              {addingSchedule ? 'Adding…' : '+ Add Schedule'}
            </button>
          </div>
        </div>
      </div>

      {/* ── NON-CURRENT ASSETS ── */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <SectionHeader title="Non-current Assets" subtitle="Update when values change — not calculated from transactions" />
        <div className="px-6">
          <FieldRow code="fixed_assets" label="Fixed Assets" {...fieldProps} />
          <FieldRow code="670" label="670 — Intangible Assets (Capitalized Software Development Costs)" {...fieldProps} />
        </div>
      </div>

      {/* ── DIRECTOR ACCOUNTS ── */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <SectionHeader
          title="Director Current Accounts (Current Liabilities)"
          subtitle="Amounts the company owes to founders. Can be converted to equity (share capital) when the time comes."
        />
        <div className="px-6">
          <FieldRow code="835" label="835 — Director Current Account" {...fieldProps} />
          <FieldRow code="840" label="840 — Director Current Account" {...fieldProps} />
          <FieldRow code="842" label="842 — Director Current Account" {...fieldProps} />
        </div>
        <div className="px-6 py-4 bg-narra-light/30 border-t border-narra-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-narra-dark">
              Total director amounts owed:{' '}
              <span className="font-heading font-semibold">${fmt(directorTotal)}</span>
            </div>
            <p className="text-xs text-narra-muted mt-0.5">
              Converting adds this amount to Share Capital (900) and zeros these accounts.
            </p>
          </div>
          {!showConvertConfirm ? (
            <button
              onClick={() => setShowConvertConfirm(true)}
              disabled={directorTotal <= 0}
              className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Convert to Equity
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-red-600 font-medium">
                Convert ${fmt(directorTotal)} to share capital?
              </span>
              <button
                onClick={convertToEquity}
                disabled={converting}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-body hover:bg-red-700 transition-all disabled:opacity-50"
              >
                {converting ? 'Converting…' : 'Yes, convert'}
              </button>
              <button
                onClick={() => setShowConvertConfirm(false)}
                className="px-3 py-1.5 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light transition-all"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── OTHER CURRENT LIABILITIES ── */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <SectionHeader title="Other Current Liabilities" />
        <div className="px-6">
          <FieldRow code="860" label="860 — Income Tax Payable" {...fieldProps} />
          <FieldRow code="gst" label="GST Payable" {...fieldProps} />
        </div>
      </div>

      {/* ── NON-CURRENT LIABILITIES ── */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <SectionHeader title="Non-current Liabilities" subtitle="Founder investments recorded as loans. Convert to equity when ready to make it permanent." />
        <div className="px-6">
          <FieldRow code="851" label="851 — Loans" {...fieldProps} />
          <FieldRow code="852" label="852 — Founder Investment" {...fieldProps} />
          <FieldRow code="853" label="853 — Founder Investment" {...fieldProps} />
        </div>
        <div className="px-6 py-4 bg-narra-light/30 border-t border-narra-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-narra-dark">
              Total founder investments:{' '}
              <span className="font-heading font-semibold">${fmt(investmentTotal)}</span>
            </div>
            <p className="text-xs text-narra-muted mt-0.5">
              Converting moves this amount to Share Capital (900) and zeros these accounts.
            </p>
          </div>
          {!showInvConvertConfirm ? (
            <button
              onClick={() => setShowInvConvertConfirm(true)}
              disabled={investmentTotal <= 0}
              className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Convert to Equity
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-red-600 font-medium">
                Convert ${fmt(investmentTotal)} to share capital?
              </span>
              <button
                onClick={convertInvestmentsToEquity}
                disabled={convertingInv}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-body hover:bg-red-700 transition-all disabled:opacity-50"
              >
                {convertingInv ? 'Converting…' : 'Yes, convert'}
              </button>
              <button
                onClick={() => setShowInvConvertConfirm(false)}
                className="px-3 py-1.5 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light transition-all"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── EQUITY ── */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <SectionHeader title="Equity" />
        <div className="px-6">
          <FieldRow code="900" label="900 — Share Capital" {...fieldProps} />
        </div>
        <div className="px-6 py-3 bg-narra-light/20 border-t border-narra-border/50">
          <p className="text-xs text-narra-muted">
            920 — Retained Earnings is auto-calculated from cumulative net P&L across all prior periods.
          </p>
        </div>
      </div>
    </div>
  )
}
