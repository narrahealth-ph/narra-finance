'use client'
import { useState } from 'react'
import { downloadCSV, toCSV } from '@/lib/csv'

type ReportTab = 'gl' | 'bs' | 'pl'

function fmt(n: number) {
  return Math.abs(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtSigned(n: number) {
  return n < 0 ? `(${fmt(n)})` : fmt(n)
}

// Build the exact CSV format matching NARRA_HEALTH_PTE__LTD__-_MA_JAN_2026 files
function buildGLCSV(gl: any, period: string, bs: any): string {
  const [month, year] = period.split('_')
  const startDate = `${year}-${String(['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month) + 1).padStart(2,'0')}-01`
  const endDate   = startDate.slice(0,7) + '-' + new Date(parseInt(year), ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month) + 1, 0).getDate()

  const rows: string[][] = [
    ['Report Name','General Ledger','','','','','','','','','','','','','','',''],
    ['Company Name','NARRA HEALTH PTE. LTD.','','','','','','','','','','','','','','',''],
    ['Start Date', startDate,'','','','','','','','','','','','','','',''],
    ['End Date',   endDate,  '','','','','','','','','','','','','','',''],
    ['','','','','','','','','','','','','','','','',''],
    ['Posting Date','Account','Debit (USD)','Credit (USD)','Balance (USD)','Voucher Type','Voucher Subtype','Voucher No','Against Account','Party Type','Party','Project','Customer Group','Cost Center','Against Voucher Type','Against Voucher','Supplier Invoice No'],
  ]

  // Expense accounts
  for (const [acct, items] of Object.entries(gl.expenseByAccount as Record<string, any[]>)) {
    let opening = 0
    rows.push([`'Opening'`, '', fmt(opening), '0.00', fmt(opening), '', '', '', '', '', '', '', '', '', '', '', ''])
    let bal = opening
    for (const inv of items as any[]) {
      const amt = parseFloat(inv.amount_usd || 0)
      bal += amt
      rows.push([
        inv.date || '',
        `${acct} - NARRA HEALTH PTE. LTD.`,
        fmt(amt), '0.00', fmt(bal),
        'Purchase Invoice', 'Purchase Invoice',
        inv.voucher_no || '',
        inv.vendor || inv.drive_file_name || '',
        '', '', '', '',
        'Main - NARRA HEALTH PTE. LTD.',
        '', '', '',
      ])
    }
    const total = (items as any[]).reduce((s, i) => s + parseFloat(i.amount_usd || 0), 0)
    rows.push([`'Total'`, '', fmt(total), '0.00', fmt(total), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push([`'Closing (Opening + Total)'`, '', fmt(opening + total), '0.00', fmt(opening + total), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', '', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
  }

  // Revenue rows (Bank / Accounts Receivable)
  if (gl.revenueRows?.length > 0) {
    rows.push([`'Opening'`, '', '0.00', '0.00', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
    let bal = 0
    for (const r of gl.revenueRows) {
      const amt = parseFloat(r.amount_usd || r.amount || 0)
      bal += amt
      rows.push([
        r.date || '',
        'BANK Sleek Business Account USD - NARRA HEALTH PTE. LTD.',
        fmt(amt), '0.00', fmt(bal),
        'Payment Entry', '', '',
        r.description || '',
        'Customer', r.description || '',
        '', '', 'Main - NARRA HEALTH PTE. LTD.',
        '', '', '',
      ])
    }
    const revTotal = gl.revenueRows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || r.amount || 0), 0)
    rows.push([`'Total'`, '', fmt(revTotal), '0.00', fmt(revTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push([`'Closing (Opening + Total)'`, '', fmt(revTotal), '0.00', fmt(revTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', '', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
  }

  const grandDebit  = Object.values(gl.expenseByAccount as Record<string, any[]>).flat().reduce((s, i) => s + parseFloat(i.amount_usd || 0), 0)
    + (gl.revenueRows || []).reduce((s: number, r: any) => s + parseFloat(r.amount_usd || r.amount || 0), 0)
  rows.push([`'Total'`, '', fmt(grandDebit), fmt(grandDebit), '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
  rows.push([`'Closing (Opening + Total)'`, '', '0.00', '0.00', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])

  return rows.map(r => r.map(c => c.includes(',') || c.includes('"') ? `"${c}"` : c).join(',')).join('\n')
}

function buildBSCSV(bs: any, period: string): string {
  const [month, year] = period.split('_')
  const endDate = bs.period?.end_date?.split('T')[0] || `${year}-12-31`

  const safe = (v: number) => (v < 0 ? `"(${fmt(Math.abs(v))})"` : fmt(v))

  const rows: string[][] = [
    ['Report Name', 'Balance Sheet'],
    ['Company Name', 'NARRA HEALTH PTE. LTD.'],
    ['Start Date', `${year}-01-01`],
    ['End Date', endDate],
    ['', ''],
    ['Account', `${month} ${year}`],
    // ── Current Assets ──
    ['Current Assets', fmt(bs.totalCurrentAssets || 0)],
    ['600 - Accounts Receivable', fmt(bs.arTotal || 0)],
    ['610 - Prepayments', fmt(bs.prepayments || 0)],
    ...Object.entries(bs.cashByAccount || {}).map(([acct, info]: [string, any]) =>
      [`BANK ${acct}`, fmt(info.amount)]
    ),
    [`'Total Current Assets'`, fmt(bs.totalCurrentAssets || 0)],
    ['', ''],
    // ── Non-current Assets ──
    ['Non-current Assets', fmt(bs.totalNonCurrentAssets || 0)],
    ...(bs.fixedAssets > 0        ? [['Fixed Assets', fmt(bs.fixedAssets)]] : []),
    ...(bs.intangibleAssets > 0   ? [['670 - Intangible Asset', fmt(bs.intangibleAssets)]] : []),
    [`'Total Non-current Assets'`, fmt(bs.totalNonCurrentAssets || 0)],
    ['', ''],
    [`'Total Asset (Debit)'`, fmt(bs.totalAssets || 0)],
    ['', ''],
    // ── Current Liabilities ──
    ['Current Liabilities', fmt(bs.totalCurrentLiabilities || 0)],
    ['800 - Accounts Payable', fmt(bs.accountsPayable || 0)],
    ...(bs.deferredRevenue > 0    ? [['Deferred Revenue', fmt(bs.deferredRevenue)]] : []),
    ...(bs.director835 > 0        ? [['835 - Director Current Account', fmt(bs.director835)]] : []),
    ...(bs.director840 > 0        ? [['840 - Director Current Account', fmt(bs.director840)]] : []),
    ...(bs.director842 > 0        ? [['842 - Director Current Account', fmt(bs.director842)]] : []),
    ...(bs.incomeTax > 0          ? [['860 - Income Tax Payable', fmt(bs.incomeTax)]] : []),
    ...(bs.gstPayable > 0         ? [['GST Payable', fmt(bs.gstPayable)]] : []),
    [`'Total Current Liabilities'`, fmt(bs.totalCurrentLiabilities || 0)],
    ['', ''],
    // ── Non-current Liabilities ──
    ['Non-current Liabilities', fmt(bs.totalNonCurrentLiabilities || 0)],
    ...(bs.loans > 0              ? [['851 - Loans', fmt(bs.loans)]] : []),
    ...(bs.investment852 > 0      ? [['852 - Founder Investment', fmt(bs.investment852)]] : []),
    ...(bs.investment853 > 0      ? [['853 - Founder Investment', fmt(bs.investment853)]] : []),
    [`'Total Non-current Liabilities'`, fmt(bs.totalNonCurrentLiabilities || 0)],
    [`'Total Liability (Credit)'`, fmt(bs.totalLiabilities || 0)],
    ['', ''],
    // ── Equity ──
    ['Equity', fmt(bs.totalEquity || 0)],
    ['900 - Share Capital', fmt(bs.shareCapital || 0)],
    ['920 - Retained Earnings', safe(bs.retainedEarnings || 0)],
    [`'Provisional Profit / Loss (Credit)'`, safe(bs.provisionalPL || 0)],
    [`'Total Equity (Credit)'`, safe(bs.totalEquity || 0)],
    ['', ''],
    [`'Total (Credit)'`, fmt(bs.totalAssets || 0)],
    ['', ''],
    ['Balance Check (Assets = Liabilities + Equity)', bs.balanceCheck ? 'BALANCED' : 'OUT OF BALANCE'],
  ]
  return rows.map(r => r.map(c => (String(c).includes(',') && !String(c).startsWith('"')) ? `"${c}"` : c).join(',')).join('\n')
}

function buildPLCSV(pl: any, period: string): string {
  const [month, year] = period.split('_')
  const rows: string[][] = [
    ['Report Name', 'Profit and Loss Statement'],
    ['Company Name', 'NARRA HEALTH PTE. LTD.'],
    ['Start Date', `${year}-${String(['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month) + 1).padStart(2,'0')}-01`],
    ['End Date',   `${year}-${String(['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month) + 1).padStart(2,'0')}-${new Date(parseInt(year), ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month) + 1, 0).getDate()}`],
    ['', ''],
    ['Account', year],
    ['Expenses', fmt(pl.totalExpenses || 0)],
  ]

  for (const [acct, items] of Object.entries(pl.expenseByAccount as Record<string, any[]>)) {
    const sub = (items as any[]).reduce((s, i) => s + parseFloat(i.amount_usd || 0), 0)
    rows.push([acct, fmt(sub)])
  }

  rows.push([`'Total Expense (Debit)'`, fmt(pl.totalExpenses || 0)])
  rows.push(['', ''])
  if (pl.totalRevenue > 0) {
    rows.push(['Income', fmt(pl.totalRevenue)])
    rows.push(['310 - Service Revenue', fmt(pl.totalRevenue)])
    rows.push([`'Total Income (Credit)'`, fmt(pl.totalRevenue)])
    rows.push(['', ''])
  }
  rows.push([`'Profit for the year'`, pl.netProfit < 0 ? `(${fmt(Math.abs(pl.netProfit))})` : fmt(pl.netProfit)])

  return rows.map(r => r.join(',')).join('\n')
}

export default function ReportsPanel({ data, loading, period }: { data: any; loading: boolean; period: string }) {
  const [tab, setTab] = useState<ReportTab>('pl')

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-narra-muted animate-pulse-soft">Generating reports…</div>
  )
  if (!data) return (
    <div className="flex flex-col items-center justify-center h-64 text-narra-muted gap-2">
      <div className="text-4xl">📊</div>
      <p className="text-sm">Import data to generate reports</p>
    </div>
  )

  const { gl, bs, pl } = data

  function exportGL() {
    const csv = buildGLCSV(gl, period, bs)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `NARRA_HEALTH_PTE__LTD__-_${period}_-_General_Ledger.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function exportBS() {
    const csv = buildBSCSV(bs, period)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `NARRA_HEALTH_PTE__LTD__-_${period}_-_Balance_Sheet.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function exportPL() {
    const csv = buildPLCSV(pl, period)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `NARRA_HEALTH_PTE__LTD__-_${period}_-_Profit_and_Loss_Statement.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function exportAll() { exportGL(); exportBS(); exportPL() }

  const tabs = [
    { id: 'pl' as ReportTab, label: 'P&L Statement' },
    { id: 'bs' as ReportTab, label: 'Balance Sheet' },
    { id: 'gl' as ReportTab, label: 'General Ledger' },
  ]

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">Financial Reports</h2>
          <p className="text-sm text-narra-muted mt-0.5">{period.replace('_', ' ')} · NARRA HEALTH PTE. LTD.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={exportGL}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ GL CSV</button>
          <button onClick={exportBS}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ BS CSV</button>
          <button onClick={exportPL}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ P&L CSV</button>
          <button onClick={exportAll} className="px-3 py-2 bg-narra-dark text-narra-green rounded-lg text-xs font-body hover:bg-narra-mid transition-all">↓ Export All</button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-narra-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-body transition-all border-b-2 -mb-px
              ${tab === t.id ? 'text-narra-dark border-narra-dark font-medium' : 'text-narra-muted border-transparent hover:text-narra-dark'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* P&L */}
      {tab === 'pl' && pl && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-narra-border bg-narra-dark text-white flex justify-between items-start">
            <div>
              <div className="text-xs text-white/40 uppercase tracking-widest mb-1">NARRA HEALTH PTE. LTD.</div>
              <h3 className="font-heading font-semibold text-white">Profit and Loss Statement</h3>
              <p className="text-xs text-white/50 mt-0.5">{period.replace('_', ' ')}</p>
            </div>
            <div className="text-right">
              <div className={`font-heading text-2xl font-semibold ${pl.netProfit >= 0 ? 'text-narra-green' : 'text-red-400'}`}>
                {pl.netProfit < 0 ? '(' : ''}${fmt(pl.netProfit)}{pl.netProfit < 0 ? ')' : ''}
              </div>
              <div className="text-xs text-white/40">{pl.netProfit >= 0 ? 'Profit' : 'Loss'} for the period</div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-narra-border">
                <th className="text-left px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">Account</th>
                <th className="text-right px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">{period.split('_')[1]}</th>
              </tr>
            </thead>
            <tbody>
              {/* Expenses section */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider">
                  Expenses — ${fmt(pl.totalExpenses)}
                </td>
              </tr>
              {Object.entries(pl.expenseByAccount as Record<string, any[]>).map(([acct, items]) => {
                const sub = (items as any[]).reduce((s, i) => s + parseFloat(i.amount_usd || 0), 0)
                return (
                  <tr key={acct} className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-3 text-narra-ink pl-10">{acct}</td>
                    <td className="px-6 py-3 text-right font-medium text-narra-dark">{fmt(sub)}</td>
                  </tr>
                )
              })}
              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Expense (Debit)</td>
                <td className="px-6 py-3 text-right font-semibold text-narra-dark">{fmt(pl.totalExpenses)}</td>
              </tr>

              {/* Income section */}
              {pl.totalRevenue > 0 && <>
                <tr className="bg-narra-light/40">
                  <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">
                    Income — ${fmt(pl.totalRevenue)}
                  </td>
                </tr>
                {pl.revenueRows.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-3 text-narra-ink pl-10">310 - Service Revenue · {r.description}</td>
                    <td className="px-6 py-3 text-right font-medium text-green-700">{fmt(parseFloat(r.amount_usd || r.amount || 0))}</td>
                  </tr>
                ))}
                <tr className="border-t border-narra-border bg-narra-surface">
                  <td className="px-6 py-3 font-semibold text-narra-dark">Total Income (Credit)</td>
                  <td className="px-6 py-3 text-right font-semibold text-green-700">{fmt(pl.totalRevenue)}</td>
                </tr>
              </>}

              {/* Bottom line */}
              <tr className="border-t-2 border-narra-dark">
                <td className="px-6 py-4 font-heading font-bold text-narra-dark text-base">Profit for the year</td>
                <td className={`px-6 py-4 text-right font-heading font-bold text-base ${pl.netProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {pl.netProfit < 0 ? '(' : ''}${fmt(Math.abs(pl.netProfit))}{pl.netProfit < 0 ? ')' : ''}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Balance Sheet */}
      {tab === 'bs' && bs && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-narra-border bg-narra-dark text-white flex justify-between items-start">
            <div>
              <div className="text-xs text-white/40 uppercase tracking-widest mb-1">NARRA HEALTH PTE. LTD.</div>
              <h3 className="font-heading font-semibold text-white">Balance Sheet</h3>
              <p className="text-xs text-white/50 mt-0.5">As at end of {period.replace('_', ' ')}</p>
            </div>
            {!bs.balanceCheck && (
              <div className="bg-red-500/20 text-red-300 text-xs px-3 py-1.5 rounded-lg font-body">
                ⚠ Out of balance — check manual entries
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-narra-border">
                <th className="text-left px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">Account</th>
                <th className="text-right px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">{period.split('_')[1]}</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Current Assets ── */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider">
                  Current Assets — ${fmt(bs.totalCurrentAssets || 0)}
                </td>
              </tr>
              {Object.entries(bs.cashByAccount || {}).map(([acct, info]: [string, any]) => (
                <tr key={acct} className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">BANK {acct}</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(info.amount)}</td>
                </tr>
              ))}
              {bs.arTotal > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">600 - Accounts Receivable</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.arTotal)}</td>
                </tr>
              )}
              {bs.prepayments > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">610 - Prepayments</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.prepayments)}</td>
                </tr>
              )}
              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Current Assets</td>
                <td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalCurrentAssets || 0)}</td>
              </tr>

              {/* ── Non-current Assets ── */}
              {bs.totalNonCurrentAssets > 0 && <>
                <tr className="bg-narra-light/40">
                  <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Non-current Assets</td>
                </tr>
                {bs.fixedAssets > 0 && (
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-3 text-narra-ink pl-10">Fixed Assets</td>
                    <td className="px-6 py-3 text-right font-medium">{fmt(bs.fixedAssets)}</td>
                  </tr>
                )}
                {bs.intangibleAssets > 0 && (
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-3 text-narra-ink pl-10">670 - Intangible Asset</td>
                    <td className="px-6 py-3 text-right font-medium">{fmt(bs.intangibleAssets)}</td>
                  </tr>
                )}
                <tr className="border-t border-narra-border bg-narra-surface">
                  <td className="px-6 py-3 font-semibold text-narra-dark">Total Non-current Assets</td>
                  <td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalNonCurrentAssets)}</td>
                </tr>
              </>}

              <tr className="border-t-2 border-narra-dark">
                <td className="px-6 py-4 font-heading font-bold text-narra-dark">Total Asset (Debit)</td>
                <td className="px-6 py-4 text-right font-heading font-bold">{fmt(bs.totalAssets)}</td>
              </tr>

              {/* ── Current Liabilities ── */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Current Liabilities</td>
              </tr>
              {bs.accountsPayable > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">800 - Accounts Payable</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.accountsPayable)}</td>
                </tr>
              )}
              {bs.deferredRevenue > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">Deferred Revenue</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.deferredRevenue)}</td>
                </tr>
              )}
              {bs.director835 > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">835 - Director Current Account</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.director835)}</td>
                </tr>
              )}
              {bs.director840 > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">840 - Director Current Account</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.director840)}</td>
                </tr>
              )}
              {bs.director842 > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">842 - Director Current Account</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.director842)}</td>
                </tr>
              )}
              {bs.incomeTax > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">860 - Income Tax Payable</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.incomeTax)}</td>
                </tr>
              )}
              {bs.gstPayable > 0 && (
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">GST Payable</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.gstPayable)}</td>
                </tr>
              )}
              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Current Liabilities</td>
                <td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalCurrentLiabilities || 0)}</td>
              </tr>

              {/* ── Non-current Liabilities ── */}
              {bs.totalNonCurrentLiabilities > 0 && <>
                <tr className="bg-narra-light/40">
                  <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Non-current Liabilities</td>
                </tr>
                {bs.loans > 0 && (
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-3 text-narra-ink pl-10">851 - Loans</td>
                    <td className="px-6 py-3 text-right font-medium">{fmt(bs.loans)}</td>
                  </tr>
                )}
                {bs.investment852 > 0 && (
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-3 text-narra-ink pl-10">852 - Founder Investment</td>
                    <td className="px-6 py-3 text-right font-medium">{fmt(bs.investment852)}</td>
                  </tr>
                )}
                {bs.investment853 > 0 && (
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-3 text-narra-ink pl-10">853 - Founder Investment</td>
                    <td className="px-6 py-3 text-right font-medium">{fmt(bs.investment853)}</td>
                  </tr>
                )}
                <tr className="border-t border-narra-border bg-narra-surface">
                  <td className="px-6 py-3 font-semibold text-narra-dark">Total Non-current Liabilities</td>
                  <td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalNonCurrentLiabilities)}</td>
                </tr>
              </>}

              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Liability (Credit)</td>
                <td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalLiabilities || 0)}</td>
              </tr>

              {/* ── Equity ── */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Equity</td>
              </tr>
              <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                <td className="px-6 py-3 text-narra-ink pl-10">900 - Share Capital</td>
                <td className="px-6 py-3 text-right font-medium">{fmt(bs.shareCapital || 0)}</td>
              </tr>
              <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                <td className="px-6 py-3 text-narra-ink pl-10">920 - Retained Earnings</td>
                <td className={`px-6 py-3 text-right font-medium ${(bs.retainedEarnings || 0) >= 0 ? '' : 'text-red-600'}`}>
                  {(bs.retainedEarnings || 0) < 0 ? '(' : ''}{fmt(Math.abs(bs.retainedEarnings || 0))}{(bs.retainedEarnings || 0) < 0 ? ')' : ''}
                </td>
              </tr>
              <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                <td className="px-6 py-3 text-narra-ink pl-10">Provisional Profit / Loss (Credit)</td>
                <td className={`px-6 py-3 text-right font-medium ${(bs.provisionalPL || 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {(bs.provisionalPL || 0) < 0 ? '(' : ''}{fmt(Math.abs(bs.provisionalPL || 0))}{(bs.provisionalPL || 0) < 0 ? ')' : ''}
                </td>
              </tr>
              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Equity (Credit)</td>
                <td className={`px-6 py-3 text-right font-semibold ${(bs.totalEquity || 0) >= 0 ? '' : 'text-red-600'}`}>
                  {(bs.totalEquity || 0) < 0 ? '(' : ''}{fmt(Math.abs(bs.totalEquity || 0))}{(bs.totalEquity || 0) < 0 ? ')' : ''}
                </td>
              </tr>

              <tr className="border-t-2 border-narra-dark">
                <td className="px-6 py-4 font-heading font-bold text-narra-dark">Total (Credit)</td>
                <td className="px-6 py-4 text-right font-heading font-bold">{fmt(bs.totalAssets)}</td>
              </tr>

              {/* Balance check */}
              <tr className={`border-t ${bs.balanceCheck ? 'bg-green-50' : 'bg-red-50'}`}>
                <td colSpan={2} className={`px-6 py-2 text-xs font-body ${bs.balanceCheck ? 'text-green-700' : 'text-red-600'}`}>
                  {bs.balanceCheck
                    ? '✓ Balanced — Assets equal Liabilities + Equity'
                    : '⚠ Out of balance — check manual entries in the Adjustments tab'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* General Ledger */}
      {tab === 'gl' && gl && (
        <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-narra-border bg-narra-dark text-white">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-1">NARRA HEALTH PTE. LTD.</div>
            <h3 className="font-heading font-semibold text-white">General Ledger</h3>
            <p className="text-xs text-white/50 mt-0.5">{period.replace('_', ' ')} · All accounts</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-narra-border bg-narra-surface">
                <th className="text-left px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Posting Date</th>
                <th className="text-left px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Account / Vendor</th>
                <th className="text-right px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Debit (USD)</th>
                <th className="text-right px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Credit (USD)</th>
                <th className="text-right px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Balance (USD)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(gl.expenseByAccount as Record<string, any[]>).map(([acct, items]) => {
                let bal = 0
                const total = (items as any[]).reduce((s, i) => s + parseFloat(i.amount_usd || 0), 0)
                return [
                  // Account header row
                  <tr key={`open-${acct}`} className="bg-narra-light/50 border-t border-narra-border">
                    <td className="px-4 py-2 text-xs text-narra-muted italic">'Opening'</td>
                    <td colSpan={2} className="px-4 py-2 font-heading font-semibold text-narra-dark text-xs">{acct} — NARRA HEALTH PTE. LTD.</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                  </tr>,

                  // Transaction rows
                  ...(items as any[]).map((inv: any, i: number) => {
                    bal += parseFloat(inv.amount_usd || 0)
                    return (
                      <tr key={`${acct}-${i}`} className="border-t border-narra-border/30 hover:bg-narra-surface">
                        <td className="px-4 py-2.5 text-narra-muted text-xs font-mono">{inv.date}</td>
                        <td className="px-4 py-2.5 text-narra-ink">{inv.vendor || inv.drive_file_name}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-narra-dark">{fmt(inv.amount_usd)}</td>
                        <td className="px-4 py-2.5 text-right text-narra-muted">0.00</td>
                        <td className="px-4 py-2.5 text-right font-medium text-narra-dark">{fmt(bal)}</td>
                      </tr>
                    )
                  }),

                  // Total / Closing rows
                  <tr key={`total-${acct}`} className="border-t border-narra-border bg-narra-surface text-xs">
                    <td className="px-4 py-2 text-narra-muted italic">'Total'</td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right font-medium text-narra-dark">{fmt(total)}</td>
                    <td className="px-4 py-2 text-right text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right font-medium text-narra-dark">{fmt(total)}</td>
                  </tr>,
                  <tr key={`close-${acct}`} className="border-t border-narra-border/20 bg-narra-surface text-xs">
                    <td className="px-4 py-2 text-narra-muted italic">'Closing (Opening + Total)'</td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right font-semibold text-narra-dark">{fmt(total)}</td>
                    <td className="px-4 py-2 text-right text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right font-semibold text-narra-dark">{fmt(total)}</td>
                  </tr>,
                ]
              })}

              {/* Revenue rows */}
              {gl.revenueRows?.length > 0 && (() => {
                let bal = 0
                const total = gl.revenueRows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || r.amount || 0), 0)
                return [
                  <tr key="rev-open" className="bg-narra-light/50 border-t-2 border-narra-dark">
                    <td className="px-4 py-2 text-xs text-narra-muted italic">'Opening'</td>
                    <td colSpan={2} className="px-4 py-2 font-heading font-semibold text-narra-dark text-xs">BANK Sleek Business Account USD — Service Revenue</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                  </tr>,
                  ...gl.revenueRows.map((r: any, i: number) => {
                    const amt = parseFloat(r.amount_usd || r.amount || 0)
                    bal += amt
                    return (
                      <tr key={`rev-${i}`} className="border-t border-narra-border/30 hover:bg-narra-surface">
                        <td className="px-4 py-2.5 text-narra-muted text-xs font-mono">{r.date}</td>
                        <td className="px-4 py-2.5 text-narra-ink">{r.description}</td>
                        <td className="px-4 py-2.5 text-right text-narra-muted">0.00</td>
                        <td className="px-4 py-2.5 text-right font-medium text-green-700">{fmt(amt)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-narra-dark">{fmt(bal)}</td>
                      </tr>
                    )
                  }),
                  <tr key="rev-total" className="border-t border-narra-border bg-narra-surface text-xs">
                    <td className="px-4 py-2 text-narra-muted italic">'Total'</td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right font-medium text-green-700">{fmt(total)}</td>
                    <td className="px-4 py-2 text-right font-medium text-narra-dark">{fmt(total)}</td>
                  </tr>,
                ]
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
