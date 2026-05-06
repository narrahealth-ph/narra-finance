'use client'
import { useState, useEffect, useCallback } from 'react'
import { downloadCSV, toCSV } from '@/lib/csv'

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
  status: 'matched' | 'proposed' | 'unmatched'
  confidence: 'high' | 'medium' | 'low'
}

interface CostGroup {
  accountCode: string
  total: number
  items: {
    id: number
    date: string
    description: string
    vendor: string
    amount: number
    currency: string
    status: string
    matchedInvoice: string | null
  }[]
}

export default function ReconciliationPanel({ periodId, data, onRefresh, selectedMonth }: {
  periodId: number
  data: any
  onRefresh: () => void
  selectedMonth?: string
}) {
  const [loading,       setLoading]       = useState(true)
  const [costGroups,    setCostGroups]    = useState<CostGroup[]>([])
  const [matches,       setMatches]       = useState<MatchedPair[]>([])
  const [unmatched,     setUnmatched]     = useState<any[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [totalExpenses, setTotalExpenses] = useState(0)
  const [totalRevenue,  setTotalRevenue]  = useState(0)
  const [activeTab,     setActiveTab]     = useState<'overview' | 'matches' | 'unmatched'>('overview')
  const [unmatching,    setUnmatching]    = useState<number | null>(null)

  useEffect(() => {
    if (!periodId) return
    loadData()
  }, [periodId])

  async function loadData() {
    setLoading(true)
    try {
      // Load bank summary (costs grouped by account)
      const summaryRes = await fetch(`/api/bank?action=summary&periodId=${periodId}`, { credentials: 'include' })
      if (summaryRes.ok) {
        const summary = await summaryRes.json()
        setTotalExpenses(summary.totalExpenses || 0)
        setTotalRevenue(summary.totalRevenue || 0)

        // Build cost groups
        const groups: CostGroup[] = Object.entries(summary.byAccount || {}).map(([code, group]: any) => ({
          accountCode: code,
          total: group.total,
          items: group.items,
        })).sort((a, b) => b.total - a.total)
        setCostGroups(groups)
      }

      // Load matched/proposed pairs
      const txRes = await fetch(`/api/bank?periodId=${periodId}`, { credentials: 'include' })
      if (txRes.ok) {
        const txData = await txRes.json()
        const txs = txData.transactions || []

        const matchedTxs = txs.filter((t: any) => t.status === 'matched' || t.status === 'proposed')
        const unmatchedTxs = txs.filter((t: any) => t.status === 'unmatched' && t.type === 'expense')

        // Load invoices for matched pairs
        const invRes = await fetch(`/api/invoices?periodId=${periodId}`, { credentials: 'include' })
        const invData = invRes.ok ? await invRes.json() : { invoices: [] }
        const invMap: Record<number, any> = {}
        for (const inv of (invData.invoices || [])) invMap[inv.matched_bank_id] = inv

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
            confidence:      tx.status === 'matched' ? 'high' : 'medium',
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

  const proposedMatches = matches.filter(m => m.status === 'proposed')
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
          <p className="text-sm text-narra-muted mt-0.5">{selectedMonth?.replace('_', ' ')} · Bank vs Invoices</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { loadData(); onRefresh() }}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-dark hover:bg-narra-light transition-all">
            ↻ Refresh
          </button>
          <button onClick={exportCosts}
            className="px-4 py-2 border border-narra-border rounded-lg text-sm font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">
            ↓ Export Costs CSV
          </button>
        </div>
      </div>

      {/* KPI tiles */}
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
            <span className="text-xl">⚠️</span>
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
              <div className="text-3xl mb-2">🏦</div>
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
                            {['Date', 'Vendor / Description', 'Amount', 'Invoice', 'Status'].map(h => (
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
                                ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  item.status === 'matched'   ? 'bg-green-50 text-green-700' :
                                  item.status === 'proposed'  ? 'bg-amber-50 text-amber-700' :
                                  'bg-narra-light text-narra-muted'
                                }`}>{item.status}</span>
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
          {/* Proposed — need review */}
          {proposedMatches.length > 0 && (
            <div>
              <h3 className="font-heading font-semibold text-amber-700 mb-3 flex items-center gap-2">
                <span className="text-lg">⚠️</span> Proposed Matches — Review Required
              </h3>
              <div className="space-y-2">
                {proposedMatches.map((pair, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-2 gap-0 text-sm">
                      {/* Bank side */}
                      <div className="px-4 py-3 border-r border-amber-200">
                        <div className="text-xs text-amber-700 uppercase tracking-wider mb-1 font-body">Bank Transaction</div>
                        <div className="font-medium text-amber-900">{pair.bankDescription}</div>
                        <div className="text-amber-700 text-xs mt-0.5">{pair.bankDate} · {pair.bankCurrency} ${pair.bankAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                        {pair.bankAccount && <div className="text-amber-600 text-xs">{pair.bankAccount}</div>}
                      </div>
                      {/* Invoice side */}
                      <div className="px-4 py-3">
                        <div className="text-xs text-amber-700 uppercase tracking-wider mb-1 font-body">Matched Invoice</div>
                        <div className="font-medium text-amber-900">{pair.invoiceVendor || '—'}</div>
                        <div className="text-amber-700 text-xs mt-0.5">
                          {pair.invoiceDate} · USD ${pair.invoiceAmount?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '—'}
                        </div>
                        {pair.invoiceFile && <div className="text-amber-600 text-xs truncate">{pair.invoiceFile}</div>}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="px-4 py-2.5 border-t border-amber-200 bg-amber-100/50 flex items-center justify-between">
                      <span className="text-xs text-amber-700">
                        Amount diff: ${Math.abs((pair.bankAmount || 0) - (pair.invoiceAmount || 0)).toFixed(2)}
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
                          {pair.bankCurrency} ${pair.bankAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {pair.invoiceVendor ? (
                            <div>
                              <div className="text-narra-dark font-medium">{pair.invoiceVendor}</div>
                              {pair.invoiceFile && <div className="text-xs text-narra-muted truncate max-w-[160px]">{pair.invoiceFile}</div>}
                            </div>
                          ) : (
                            <span className="text-narra-muted text-xs italic">No invoice on file</span>
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
          <div>
            <h3 className="font-heading font-semibold text-narra-dark mb-1">Unmatched Bank Transactions</h3>
            <p className="text-xs text-narra-muted">These expenses have no matching invoice — follow up with your team or add the invoice to Drive.</p>
          </div>

          {unmatched.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
              <div className="text-3xl mb-2">🎉</div>
              <p className="font-heading font-semibold text-green-800">All transactions matched!</p>
            </div>
          ) : (
            <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
                <span className="text-sm font-medium text-amber-800">
                  ⚠️ {unmatched.length} unmatched · ${unmatched.reduce((s: number, t: any) => s + parseFloat(t.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} total
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-amber-800/10">
                    {['Date', 'Description', 'Amount', 'Account', 'Action'].map(h => (
                      <th key={h} className={`px-4 py-2.5 text-xs font-body text-amber-800/60 uppercase tracking-wider ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((tx: any, i) => (
                    <tr key={i} className="border-t border-amber-100 hover:bg-amber-50/50">
                      <td className="px-4 py-3 text-amber-700 text-xs whitespace-nowrap">{tx.date}</td>
                      <td className="px-4 py-3 text-amber-900 font-medium">{tx.description}</td>
                      <td className="px-4 py-3 text-right font-medium text-amber-900 whitespace-nowrap">
                        {tx.currency} ${parseFloat(tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-amber-600 text-xs">{tx.account || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">Follow up</span>
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
