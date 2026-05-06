'use client'
import { useState, useRef, useCallback } from 'react'

interface BankRow {
  date: string
  description: string
  amount: number
  currency: string
  type: 'expense' | 'revenue' | 'transfer' | 'fx'
  account: string
}

const CURRENCY_FLAGS: Record<string, string> = { USD: '🇺🇸', SGD: '🇸🇬', EUR: '🇪🇺', GBP: '🇬🇧', PHP: '🇵🇭' }

export default function BankImport({ periodId, onImport }: { periodId: number; onImport: () => void }) {
  const [rows,     setRows]     = useState<BankRow[]>([])
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [error,    setError]    = useState('')
  const [parsing,  setParsing]  = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── PDF → Claude AI extraction ─────────────────────────────────────────────
  async function parsePDF(file: File) {
    setParsing(true)
    setError('')
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload  = e => res((e.target?.result as string).split(',')[1])
        reader.onerror = () => rej(new Error('Could not read file'))
        reader.readAsDataURL(file)
      })

      const response = await fetch('/api/bank/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName: file.name }),
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error)
      setRows(data.transactions || [])
      setSaved(false)
    } catch (err: any) {
      setError(err.message || 'Failed to parse PDF')
    } finally {
      setParsing(false)
    }
  }

  // ── CSV parsing ────────────────────────────────────────────────────────────
  function parseCSV(text: string): BankRow[] {
    const lines = text.trim().split('\n')
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''))

    return lines.slice(1).map((line): BankRow => {
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

      const amount = parseFloat(get(['amount', 'debit', 'credit', 'value'])) || 0
      const desc = get(['description', 'narration', 'details', 'memo', 'payee'])
      const descLower = desc.toLowerCase()
      const type = (descLower.includes('currency exchange') || descLower.includes('conversion')
        ? 'fx'
        : descLower.includes('lawina') || amount > 0
        ? 'revenue'
        : 'expense'

      return {
        date: get(['date', 'transaction date', 'posting']),
        description: desc,
        amount: Math.abs(amount),
        currency: get(['currency', 'ccy']) || 'USD',
        type: type as BankRow['type'],
        account: get(['account', 'bank']) || '',
      }
    }) as BankRow[]).filter(r => r.amount > 0 && r.date)
  }

  // ── File handler ───────────────────────────────────────────────────────────
  function handleFile(file: File) {
    setError('')
    setRows([])
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      parsePDF(file)
    } else {
      const reader = new FileReader()
      reader.onload = ev => {
        try {
          setRows(parseCSV(ev.target?.result as string))
          setSaved(false)
        } catch {
          setError('Could not parse CSV. Make sure it has headers: Date, Description, Amount, Currency.')
        }
      }
      reader.readAsText(file)
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  // ── Drag and drop handlers ─────────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [])

  function updateRow(i: number, field: keyof BankRow, value: string) {
    setRows(prev => prev.map((r, idx) =>
      idx === i ? { ...r, [field]: field === 'amount' ? parseFloat(value) || 0 : value } : r
    ))
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
    onImport()
  }

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

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Bank Import</h2>
          <p className="text-sm text-narra-muted mt-0.5">Upload your Sleek bank statement — PDF or CSV. Claude AI extracts all transactions.</p>
        </div>
        {rows.length > 0 && (
          <button onClick={saveToDb} disabled={saving || saved}
            className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
            {saving ? 'Saving…' : saved ? '✓ Saved & Matched' : `Save ${rows.length} transactions`}
          </button>
        )}
      </div>

      {/* Upload area */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !parsing && fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all select-none
          ${parsing
            ? 'border-narra-green bg-narra-light/20 cursor-wait'
            : dragging
            ? 'border-narra-dark bg-narra-light/40 cursor-copy'
            : 'border-narra-border cursor-pointer hover:border-narra-muted hover:bg-narra-light/30'
          }`}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf,application/pdf,text/csv"
          className="hidden"
          onChange={onInputChange}
        />
        {parsing ? (
          <>
            <div className="text-4xl mb-3 animate-pulse">✨</div>
            <p className="font-heading font-medium text-narra-dark">Claude is reading your bank statement…</p>
            <p className="text-narra-muted text-sm mt-1">Extracting all transactions from the PDF</p>
          </>
        ) : dragging ? (
          <>
            <div className="text-4xl mb-3">📂</div>
            <p className="font-heading font-medium text-narra-dark">Drop it!</p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">🏦</div>
            <p className="font-heading font-medium text-narra-dark">Drop your Sleek bank statement here</p>
            <p className="text-narra-muted text-sm mt-1">or click to browse · PDF or CSV · Multi-currency</p>
            <div className="flex justify-center gap-2 mt-3">
              {['PDF', 'CSV'].map(f => (
                <span key={f} className="text-xs px-2 py-1 bg-narra-light rounded-md text-narra-muted font-mono">{f}</span>
              ))}
            </div>
          </>
        )}
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

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
        </div>
      )}

      {/* Transactions table */}
      {rows.length > 0 && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-light/50 border-b border-narra-border flex items-center justify-between">
            <span className="text-sm font-body text-narra-dark">
              {rows.length} transactions · Review and correct before saving
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
                  {['Date', 'Description', 'Amount', 'Currency', 'Type', 'Account'].map(h => (
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
                      {row.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2">
                      <select value={row.currency} onChange={e => updateRow(i, 'currency', e.target.value)}
                        className="bg-transparent text-xs outline-none cursor-pointer">
                        {['USD','SGD','PHP','EUR','GBP'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={row.type} onChange={e => updateRow(i, 'type', e.target.value as BankRow['type'])}
                        className={`text-xs px-2 py-0.5 rounded-full outline-none cursor-pointer ${typeColor(row.type)}`}>
                        {['expense','revenue','transfer','fx'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input value={row.account} onChange={e => updateRow(i, 'account', e.target.value)}
                        className="bg-transparent w-20 outline-none border-b border-transparent focus:border-narra-muted text-xs text-narra-muted" />
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