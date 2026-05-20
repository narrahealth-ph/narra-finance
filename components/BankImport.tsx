'use client'
import { useState, useRef, useCallback, useEffect } from 'react'

interface BankRow {
  date: string
  description: string
  amount: number
  currency: string
  type: 'expense' | 'revenue' | 'transfer' | 'fx'
  account: string
  source?: string
}

interface SavedTx {
  id: number
  date: string
  description: string
  amount: number
  amount_usd: number
  currency: string
  type: string
  account: string
  status: string
}

interface FileStatus {
  name: string
  status: 'processing' | 'done' | 'error'
  count: number
  error?: string
}

const CURRENCY_FLAGS: Record<string, string> = { USD: '🇺🇸', SGD: '🇸🇬', EUR: '🇪🇺', GBP: '🇬🇧', PHP: '🇵🇭' }

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function BankImport({ periodId, onImport, refreshKey = 0, selectedYear = '' }: {
  periodId: number
  onImport: () => void
  refreshKey?: number
  selectedYear?: string
}) {
  const [rows,       setRows]       = useState<BankRow[]>([])
  const [savedTxs,   setSavedTxs]   = useState<SavedTx[]>([])
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [error,      setError]      = useState('')
  const [dragging,   setDragging]   = useState(false)
  const [deleting,   setDeleting]   = useState<number | null>(null)
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([])
  const [coverage,   setCoverage]   = useState<Record<string, { txCount: number; revenue: number; expenses: number }>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadSaved() }, [periodId, refreshKey])

  useEffect(() => {
    fetch('/api/bank?action=coverage', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCoverage(d.coverage || {}))
      .catch(() => {})
  }, [refreshKey])

  async function loadSaved() {
    setLoadingSaved(true)
    const res = await fetch(`/api/bank?periodId=${periodId}`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      setSavedTxs(data.transactions || [])
    }
    setLoadingSaved(false)
  }

  async function deleteTx(id: number) {
    setDeleting(id)
    await fetch(`/api/bank?txId=${id}`, { method: 'DELETE', credentials: 'include' })
    setDeleting(null)
    await loadSaved()
    onImport()
  }

  // ── PayPal CSV parser ──────────────────────────────────────────────────────
  function isPayPalCSV(headers: string[]): boolean {
    return headers.some(h => h.includes('gross') || h.includes('transaction id') || h.includes('balance'))
      && headers.some(h => h.includes('name') || h.includes('type'))
  }

  function parsePayPalCSV(text: string, fileName: string): BankRow[] {
    const lines = text.trim().split('\n')
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''))

    const get = (row: string[], names: string[]) => {
      for (const n of names) {
        const idx = headers.findIndex(h => h.includes(n))
        if (idx >= 0) return row[idx]?.trim().replace(/['"]/g, '') || ''
      }
      return ''
    }

    const rows: BankRow[] = []
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue
      const cols: string[] = []
      let cur = '', inQ = false
      for (const ch of line) {
        if (ch === '"') inQ = !inQ
        else if (ch === ',' && !inQ) { cols.push(cur); cur = '' }
        else cur += ch
      }
      cols.push(cur)

      const status = get(cols, ['status']).toLowerCase()
      if (status === 'pending' || status === 'denied' || status === 'reversed') continue

      const grossStr = get(cols, ['gross']).replace(/[$,\s]/g, '')
      const gross    = parseFloat(grossStr) || 0
      if (gross === 0) continue

      const txType  = get(cols, ['type']).toLowerCase()
      const name    = get(cols, ['name'])
      const desc    = name || txType
      const currency = get(cols, ['currency']) || 'USD'
      const date    = get(cols, ['date'])

      // Positive gross = money in (revenue), negative = money out (expense)
      const type: BankRow['type'] = txType.includes('transfer') || txType.includes('withdrawal') ? 'transfer'
                                  : gross > 0 ? 'revenue' : 'expense'

      rows.push({
        date,
        description: desc,
        amount: Math.abs(gross),
        currency,
        type,
        account: 'PayPal',
        source: fileName,
      })
    }
    return rows
  }

  // ── Generic bank CSV parser ────────────────────────────────────────────────
  function parseCSV(text: string, fileName: string): BankRow[] {
    const lines = text.trim().split('\n')
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''))

    if (isPayPalCSV(headers)) return parsePayPalCSV(text, fileName)

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

      const amount    = parseFloat(get(['amount', 'debit', 'credit', 'value'])) || 0
      const desc      = get(['description', 'narration', 'details', 'memo', 'payee'])
      const descLower = desc.toLowerCase()
      const type: BankRow['type'] = descLower.includes('currency exchange') || descLower.includes('conversion')
        ? 'fx'
        : descLower.includes('lawina') || amount > 0
        ? 'revenue'
        : 'expense'

      return {
        date:        get(['date', 'transaction date', 'posting']),
        description: desc,
        amount:      Math.abs(amount),
        currency:    get(['currency', 'ccy']) || 'USD',
        type,
        account:     get(['account', 'bank']) || '',
        source:      fileName,
      }
    }).filter(r => r.amount > 0 && r.date)
  }

  // ── PDF / Image → Claude AI extraction ───────────────────────────────────
  async function parseWithAI(file: File): Promise<BankRow[]> {
    const base64 = await new Promise<string>((res, rej) => {
      const reader = new FileReader()
      reader.onload  = e => res((e.target?.result as string).split(',')[1])
      reader.onerror = () => rej(new Error('Could not read file'))
      reader.readAsDataURL(file)
    })
    const response = await fetch('/api/bank/parse-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, fileName: file.name, mimeType: file.type || 'application/pdf' }),
    })
    const data = await response.json()
    if (data.error) throw new Error(data.error)
    return (data.transactions || []).map((t: BankRow) => ({ ...t, source: file.name }))
  }

  // ── Process multiple files sequentially ───────────────────────────────────
  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    setError('')
    setSaved(false)

    // Add all files to status list as 'processing'
    setFileStatuses(prev => [
      ...prev,
      ...files.map(f => ({ name: f.name, status: 'processing' as const, count: 0 })),
    ])

    for (const file of files) {
      try {
        let newRows: BankRow[]
        const isAI = file.type === 'application/pdf'
                  || file.name.toLowerCase().endsWith('.pdf')
                  || file.type.startsWith('image/')
        if (isAI) {
          newRows = await parseWithAI(file)
        } else {
          const text = await file.text()
          newRows = parseCSV(text, file.name)
        }
        setRows(prev => [...prev, ...newRows])
        setFileStatuses(prev => prev.map(fs =>
          fs.name === file.name ? { ...fs, status: 'done', count: newRows.length } : fs
        ))
      } catch (err: any) {
        setFileStatuses(prev => prev.map(fs =>
          fs.name === file.name ? { ...fs, status: 'error', error: err.message } : fs
        ))
      }
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) handleFiles(e.target.files)
    e.target.value = ''
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(true)
  }, [])
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
  }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
  }, [])

  function updateRow(i: number, field: keyof BankRow, value: string) {
    setRows(prev => prev.map((r, idx) =>
      idx === i ? { ...r, [field]: field === 'amount' ? parseFloat(value) || 0 : value } : r
    ))
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  async function saveToDb() {
    setSaving(true)
    await fetch('/api/bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, transactions: rows }),
    })
    setSaved(true)
    setSaving(false)
    setRows([])
    setFileStatuses([])
    await loadSaved()
    // refresh coverage grid
    fetch('/api/bank?action=coverage', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCoverage(d.coverage || {}))
      .catch(() => {})
    onImport()
  }

  const isProcessing = fileStatuses.some(f => f.status === 'processing')

  const byCurrency = rows.reduce((acc, r) => {
    if (!acc[r.currency]) acc[r.currency] = { in: 0, out: 0 }
    if (r.type === 'revenue') acc[r.currency].in += r.amount
    else if (r.type === 'expense') acc[r.currency].out += r.amount
    return acc
  }, {} as Record<string, { in: number; out: number }>)

  const totalExpenses = rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0)
  const totalRevenue  = rows.filter(r => r.type === 'revenue').reduce((s, r) => s + r.amount, 0)

  const typeColor = (t: BankRow['type']) => ({
    expense:  'bg-red-50 text-red-600',
    revenue:  'bg-green-50 text-green-700',
    transfer: 'bg-blue-50 text-blue-600',
    fx:       'bg-purple-50 text-purple-600',
  }[t])

  // Group rows by source file for display
  const sources = Array.from(new Set(rows.map(r => r.source || 'Unknown')))

  // Which months for the selected year have bank data
  const yearMonthCoverage = MONTH_NAMES.map((name, i) => {
    const label = `${name}_${selectedYear}`
    const info  = coverage[label]
    return { name, short: MONTH_SHORT[i], label, info: info || null }
  })
  const hasCoverage = yearMonthCoverage.some(m => m.info)

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Bank Import</h2>
          <p className="text-sm text-narra-muted mt-0.5">Upload bank statements and PayPal exports — PDF or CSV. Supports multiple files.</p>
        </div>
        {rows.length > 0 && (
          <button onClick={saveToDb} disabled={saving || saved || isProcessing}
            className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
            {saving ? 'Saving…' : saved ? '✓ Saved' : `Save ${rows.length} transactions`}
          </button>
        )}
      </div>

      {/* Month coverage grid */}
      {selectedYear && (
        <div className="bg-white border border-narra-border rounded-xl p-4">
          <div className="text-xs text-narra-muted uppercase tracking-widest mb-3 font-body">
            {selectedYear} — Bank Statement Coverage
          </div>
          <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
            {yearMonthCoverage.map(({ short, info }) => (
              <div key={short} className={`rounded-lg p-2 text-center transition-all ${
                info
                  ? 'bg-narra-green/20 border border-narra-green/40'
                  : 'bg-narra-surface border border-narra-border'
              }`}>
                <div className={`text-xs font-medium ${info ? 'text-narra-dark' : 'text-narra-muted'}`}>{short}</div>
                {info ? (
                  <div className="text-[10px] text-narra-muted mt-0.5 leading-tight">
                    {info.txCount} tx
                  </div>
                ) : (
                  <div className="text-[10px] text-narra-border mt-0.5">—</div>
                )}
              </div>
            ))}
          </div>
          {!hasCoverage && (
            <p className="text-xs text-narra-muted mt-2">No bank statements uploaded for {selectedYear} yet.</p>
          )}
        </div>
      )}

      {/* Upload area */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isProcessing && fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-all select-none
          ${isProcessing
            ? 'border-narra-green bg-narra-light/20 cursor-wait'
            : dragging
            ? 'border-narra-dark bg-narra-light/40 cursor-copy'
            : 'border-narra-border cursor-pointer hover:border-narra-muted hover:bg-narra-light/30'
          }`}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf,.png,.jpg,.jpeg,.webp,application/pdf,text/csv,image/*"
          multiple
          className="hidden"
          onChange={onInputChange}
        />
        {isProcessing ? (
          <>
            <div className="text-4xl mb-3 animate-pulse">✨</div>
            <p className="font-heading font-medium text-narra-dark">Claude is reading your statements…</p>
            <p className="text-narra-muted text-sm mt-1">Extracting transactions from PDFs</p>
          </>
        ) : dragging ? (
          <>
            <div className="text-4xl mb-3">📂</div>
            <p className="font-heading font-medium text-narra-dark">Drop all files here!</p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">🏦</div>
            <p className="font-heading font-medium text-narra-dark">Drop your bank statements here</p>
            <p className="text-narra-muted text-sm mt-1">Multiple files supported · PDF, CSV, or images (PNG/JPG) · Sleek, PayPal, or any bank</p>
            <div className="flex justify-center gap-2 mt-3">
              {['PDF', 'CSV', 'PNG/JPG', 'PayPal', 'Multi-file'].map(f => (
                <span key={f} className="text-xs px-2 py-1 bg-narra-light rounded-md text-narra-muted font-mono">{f}</span>
              ))}
            </div>
          </>
        )}
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

      {/* Per-file processing status */}
      {fileStatuses.length > 0 && (
        <div className="space-y-1.5">
          {fileStatuses.map((fs, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm border ${
              fs.status === 'done'       ? 'bg-green-50 border-green-200 text-green-800' :
              fs.status === 'error'      ? 'bg-red-50 border-red-200 text-red-700' :
                                           'bg-narra-light border-narra-border text-narra-muted'
            }`}>
              <span className="font-mono text-base">
                {fs.status === 'processing' ? '⟳' : fs.status === 'done' ? '✓' : '✗'}
              </span>
              <span className="flex-1 truncate font-medium">{fs.name}</span>
              {fs.status === 'done'  && <span>{fs.count} transactions extracted</span>}
              {fs.status === 'error' && <span className="text-xs">{fs.error}</span>}
              {fs.status === 'processing' && <span className="text-xs animate-pulse">Processing…</span>}
            </div>
          ))}
        </div>
      )}

      {/* Currency summary */}
      {rows.length > 0 && Object.keys(byCurrency).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(byCurrency).map(([ccy, { in: inn, out }]) => (
            <div key={ccy} className="bg-white border border-narra-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{CURRENCY_FLAGS[ccy] || '💱'}</span>
                <span className="font-heading font-semibold text-narra-dark text-sm">{ccy}</span>
              </div>
              {inn > 0 && <div className="text-xs text-green-600">↑ {inn.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>}
              {out > 0 && <div className="text-xs text-red-500">↓ {out.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>}
            </div>
          ))}
          {sources.length > 1 && (
            <div className="bg-white border border-narra-border rounded-xl p-4">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-2">Sources</div>
              {sources.map(s => (
                <div key={s} className="text-xs text-narra-muted truncate">{s}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Saved transactions */}
      {loadingSaved ? (
        <div className="bg-white border border-narra-border rounded-xl px-4 py-3 text-sm text-narra-muted animate-pulse">
          Loading saved transactions…
        </div>
      ) : savedTxs.length === 0 ? (
        <div className="bg-white border border-narra-border rounded-xl px-4 py-3 text-sm text-narra-muted">
          No bank transactions saved for this period yet. Upload a statement above to get started.
        </div>
      ) : (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-dark/5 border-b border-narra-border flex items-center justify-between">
            <div>
              <span className="text-sm font-body font-medium text-narra-dark">
                {savedTxs.length} transactions saved for this period
              </span>
              <span className="ml-3 text-xs text-narra-muted">
                Rev: ${savedTxs.filter(t => t.type === 'revenue').reduce((s, t) => s + parseFloat(String(t.amount_usd || t.amount || 0)), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                {' · '}
                Exp: ${savedTxs.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(String(t.amount_usd || t.amount || 0)), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <span className="text-xs text-narra-muted">Click ✕ to delete a duplicate</span>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-narra-surface border-b border-narra-border">
                  {['Date', 'Description', 'Amount', 'CCY', 'Type', 'Account', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs text-narra-muted font-body uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {savedTxs.map(tx => (
                  <tr key={tx.id} className={`border-t border-narra-border/40 hover:bg-narra-surface ${tx.type === 'fx' ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 text-xs font-mono text-narra-muted whitespace-nowrap">{String(tx.date).split('T')[0]}</td>
                    <td className="px-3 py-2 text-narra-ink max-w-xs truncate">{tx.description}</td>
                    <td className="px-3 py-2 text-right font-medium text-sm whitespace-nowrap">
                      {parseFloat(String(tx.amount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-xs">{CURRENCY_FLAGS[tx.currency] || ''} {tx.currency}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        tx.type === 'revenue'  ? 'bg-green-50 text-green-700' :
                        tx.type === 'expense'  ? 'bg-red-50 text-red-600' :
                        tx.type === 'fx'       ? 'bg-purple-50 text-purple-600' :
                        'bg-blue-50 text-blue-600'
                      }`}>{tx.type}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-narra-muted">{tx.account}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => deleteTx(tx.id)}
                        disabled={deleting === tx.id}
                        className="w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs flex items-center justify-center disabled:opacity-30"
                      >
                        {deleting === tx.id ? '…' : '✕'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New transactions preview — only shown after savedTxs section */}
      {rows.length > 0 && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-light/50 border-b border-narra-border flex items-center justify-between">
            <span className="text-sm font-body text-narra-dark">
              {rows.length} transactions from {sources.length} file{sources.length !== 1 ? 's' : ''} · Review before saving
            </span>
            <div className="flex gap-4 text-xs">
              <span className="text-green-600">↑ ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              <span className="text-red-500">↓ ${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              <span className="text-narra-muted">{rows.filter(r => r.type === 'fx').length} FX</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-narra-dark text-white">
                  {['Date', 'Description', 'Amount', 'Currency', 'Type', 'Source', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 font-body font-normal text-xs tracking-widest uppercase text-white/60">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-t border-narra-border hover:bg-narra-surface ${row.type === 'fx' ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2">
                      <input value={row.date} onChange={e => updateRow(i, 'date', e.target.value)}
                        className="bg-transparent w-24 outline-none border-b border-transparent focus:border-narra-muted text-xs" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={row.description} onChange={e => updateRow(i, 'description', e.target.value)}
                        className="bg-transparent w-52 outline-none border-b border-transparent focus:border-narra-muted text-xs" />
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-sm">
                      <div className="flex items-center gap-1 justify-end">
                        <select value={row.currency} onChange={e => updateRow(i, 'currency', e.target.value)}
                          className="bg-transparent text-xs outline-none cursor-pointer text-narra-muted">
                          {['USD','SGD','PHP','EUR','GBP'].map(c => <option key={c}>{c}</option>)}
                        </select>
                        <span>{row.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">
                      <select value={row.type} onChange={e => updateRow(i, 'type', e.target.value as BankRow['type'])}
                        className={`text-xs px-2 py-0.5 rounded-full outline-none cursor-pointer ${typeColor(row.type)}`}>
                        {['expense','revenue','transfer','fx'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-narra-muted truncate max-w-[120px]" title={row.source}>
                      {row.source?.replace(/\.[^.]+$/, '') || ''}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => removeRow(i)}
                        className="w-5 h-5 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs flex items-center justify-center">
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
    </div>
  )
}
