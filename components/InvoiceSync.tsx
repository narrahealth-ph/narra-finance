'use client'
import { useState } from 'react'

interface DriveFile {
  id: string
  name: string
  mimeType: string
}

interface ExtractedInvoice {
  fileId: string
  fileName: string
  status: 'pending' | 'extracting' | 'done' | 'error' | 'exists'
  data?: any
  error?: string
}

export default function InvoiceSync({ periodId, monthLabel, onSync }: {
  periodId: number
  monthLabel: string
  onSync: () => void
}) {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(false)
  const [invoices, setInvoices] = useState<ExtractedInvoice[]>([])
  const [syncing, setSyncing] = useState(false)
  const [folderFound, setFolderFound] = useState<boolean | null>(null)

  async function loadDriveFiles() {
    setLoading(true)
    const res = await fetch(`/api/drive?action=files&month=${monthLabel}`)
    const data = await res.json()
    setFolderFound(!!data.folder)
    setFiles(data.files || [])
    setInvoices((data.files || []).map((f: DriveFile) => ({
      fileId: f.id, fileName: f.name, status: 'pending'
    })))
    setLoading(false)
  }

  async function extractFile(file: DriveFile, force = false) {
    setInvoices(prev => prev.map(i =>
      i.fileId === file.id ? { ...i, status: 'extracting' } : i
    ))
    const res = await fetch('/api/drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, fileId: file.id, fileName: file.name, mimeType: file.mimeType, force }),
    })
    const result = await res.json()
    setInvoices(prev => prev.map(i =>
      i.fileId === file.id ? {
        ...i,
        status: result.status === 'error' ? 'error'
              : result.status === 'already_exists' ? 'exists'
              : 'done',
        data:  result.data,
        error: result.error
      } : i
    ))
    return result
  }

  async function syncAll() {
    setSyncing(true)
    for (const file of files) {
      await extractFile(file, false)
    }
    setSyncing(false)
    onSync()
  }

  const statusIcon = (s: ExtractedInvoice['status']) =>
    ({ pending: '○', extracting: '⟳', done: '✓', error: '✗', exists: '=' }[s])

  const statusColor = (s: ExtractedInvoice['status']) => ({
    pending:    'text-narra-muted',
    extracting: 'text-narra-green animate-pulse-soft',
    done:       'text-green-500',
    error:      'text-red-400',
    exists:     'text-white/30',
  }[s])

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Invoice Sync</h2>
          <p className="text-sm text-narra-muted mt-0.5">
            Pulls from Drive →{' '}
            <code className="text-xs bg-narra-light px-1.5 py-0.5 rounded">
              Incoming Invoices &amp; Receipts / {monthLabel}
            </code>
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadDriveFiles}
            disabled={loading}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all disabled:opacity-50"
          >
            {loading ? 'Loading…' : '↻ Refresh from Drive'}
          </button>
          {files.length > 0 && (
            <button
              onClick={syncAll}
              disabled={syncing}
              className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50"
            >
              {syncing ? '✨ Extracting…' : `✨ AI Extract All (${files.length})`}
            </button>
          )}
        </div>
      </div>

      {folderFound === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          ⚠️ Folder <strong>{monthLabel}</strong> not found in Drive. Check the folder name matches exactly.
        </div>
      )}

      {files.length === 0 && folderFound === null && (
        <div className="bg-narra-light/50 border border-narra-border rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">📁</div>
          <p className="text-narra-muted text-sm">
            Click "Refresh from Drive" to load invoices for {monthLabel}
          </p>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-narra-dark text-white">
                {['Status', 'File', 'Vendor', 'Date', 'Amount', 'Account', 'Confidence'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-body font-normal text-xs tracking-widest uppercase text-white/60">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.fileId} className="border-t border-narra-border hover:bg-narra-surface transition-colors">
                  <td className={`px-4 py-3 font-mono text-base ${statusColor(inv.status)}`}>
                    {statusIcon(inv.status)}
                  </td>
                  <td className="px-4 py-3 text-narra-ink max-w-xs truncate">{inv.fileName}</td>
                  <td className="px-4 py-3 text-narra-muted">{inv.data?.vendor || '—'}</td>
                  <td className="px-4 py-3 text-narra-muted">{inv.data?.date || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-narra-dark">
                    {inv.data?.amount
                      ? `${inv.data.currency || 'USD'} ${Number(inv.data.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-narra-muted text-xs">{inv.data?.suggested_account || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {inv.data?.confidence && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inv.data.confidence === 'high'   ? 'bg-green-100 text-green-700' :
                          inv.data.confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                             'bg-red-100 text-red-700'
                        }`}>
                          {inv.data.confidence}
                        </span>
                      )}
                      {inv.status === 'error' && (
                        <span className="text-red-400 text-xs">{inv.error}</span>
                      )}
                      {(inv.status === 'exists' || inv.status === 'done' || inv.status === 'error') && (
                        <button
                          onClick={() => {
                            const file = files.find(f => f.id === inv.fileId)
                            if (file) extractFile(file, true)
                          }}
                          className="text-xs text-narra-muted hover:text-narra-dark transition-colors"
                          title="Re-extract"
                        >
                          ↻
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
