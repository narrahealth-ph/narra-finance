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
      bal += r.amount
      rows.push([
        r.date || '',
        'BANK Sleek Business Account USD - NARRA HEALTH PTE. LTD.',
        fmt(r.amount), '0.00', fmt(bal),
        'Payment Entry', '', '',
        r.description || '',
        'Customer', r.description || '',
        '', '', 'Main - NARRA HEALTH PTE. LTD.',
        '', '', '',
      ])
    }
    const revTotal = gl.revenueRows.reduce((s: number, r: any) => s + r.amount, 0)
    rows.push([`'Total'`, '', fmt(revTotal), '0.00', fmt(revTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push([`'Closing (Opening + Total)'`, '', fmt(revTotal), '0.00', fmt(revTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', '', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
  }

  const grandDebit  = Object.values(gl.expenseByAccount as Record<string, any[]>).flat().reduce((s, i) => s + parseFloat(i.amount_usd || 0), 0)
    + (gl.revenueRows || []).reduce((s: number, r: any) => s + r.amount, 0)
  rows.push([`'Total'`, '', fmt(grandDebit), fmt(grandDebit), '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
  rows.push([`'Closing (Opening + Total)'`, '', '0.00', '0.00', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])

  return rows.map(r => r.map(c => c.includes(',') || c.includes('"') ? `"${c}"` : c).join(',')).join('\n')
}

function buildBSCSV(bs: any, period: string): string {
  const [month, year] = period.split('_')
  const rows: string[][] = [
    ['Report Name', 'Balance Sheet'],
    ['Company Name', 'NARRA HEALTH PTE. LTD.'],
    ['Start Date', `${year}-01-01`],
    ['End Date',   `${year}-12-31`],
    ['', ''],
    ['Account', year],
    ['Current Assets', fmt(bs.totalCurrentAssets || 0)],
    ['600 - Accounts Receivable', fmt(bs.arTotal || 0)],
    ['610 - Prepayments', fmt(bs.prepayments || 0)],
    ['BANK Sleek Business Account SGD', fmt(bs.cashClosing || 0)],
    ['SBA - USD', fmt(bs.cashUSD || 0)],
    ['Non-current assets', fmt(bs.intangibleAssets || 0)],
    ['670 - Intangible Asset', fmt(bs.intangibleAssets || 0)],
    [`'Total Asset (Debit)'`, fmt(bs.totalAssets || 0)],
    ['', ''],
    ['Current Liabilities', fmt(bs.totalLiabilities || 0)],
    ['800 - Accounts Payable', fmt(bs.accountsPayable || 0)],
    [`'Total Liability (Credit)'`, fmt(bs.totalLiabilities || 0)],
    ['', ''],
    ['Equity', fmt(bs.totalEquity || 0)],
    ['920 - Retained Earnings', fmt(bs.retainedEarnings || 0)],
    [`'Total Equity (Credit)'`, fmt(bs.totalEquity || 0)],
    ['', ''],
    [`'Provisional Profit / Loss (Credit)'`, bs.retainedEarnings < 0 ? `(${fmt(bs.retainedEarnings)})` : fmt(bs.retainedEarnings)],
    [`'Total (Credit)'`, fmt(bs.totalAssets || 0)],
  ]
  return rows.map(r => r.join(',')).join('\n')
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
                    <td className="px-6 py-3 text-right font-medium text-green-700">{fmt(r.amount)}</td>
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
          <div className="px-6 py-4 border-b border-narra-border bg-narra-dark text-white">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-1">NARRA HEALTH PTE. LTD.</div>
            <h3 className="font-heading font-semibold text-white">Balance Sheet</h3>
            <p className="text-xs text-white/50 mt-0.5">As at end of {period.replace('_', ' ')}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-narra-border">
                <th className="text-left px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">Account</th>
                <th className="text-right px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">{period.split('_')[1]}</th>
              </tr>
            </thead>
            <tbody>
              {/* Current Assets */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider">
                  Current Assets — ${fmt(bs.totalCurrentAssets || (bs.cashClosing + bs.arTotal + bs.prepayments))}
                </td>
              </tr>
              {[
                { label: '600 - Accounts Receivable', val: bs.arTotal },
                { label: '610 - Prepayments',         val: bs.prepayments },
                { label: 'BANK Sleek Business Account SGD', val: bs.cashClosing },
                ...(bs.cashUSD ? [{ label: 'SBA - USD', val: bs.cashUSD }] : []),
              ].filter(r => r.val > 0).map(r => (
                <tr key={r.label} className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">{r.label}</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(r.val)}</td>
                </tr>
              ))}
              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Current Assets</td>
                <td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalCurrentAssets || 0)}</td>
              </tr>

              {/* Non-current Assets */}
              {bs.intangibleAssets > 0 && <>
                <tr className="bg-narra-light/40">
                  <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Non-current Assets</td>
                </tr>
                <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                  <td className="px-6 py-3 text-narra-ink pl-10">670 - Intangible Asset</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(bs.intangibleAssets)}</td>
                </tr>
              </>}

              <tr className="border-t-2 border-narra-dark">
                <td className="px-6 py-4 font-heading font-bold text-narra-dark">Total Asset (Debit)</td>
                <td className="px-6 py-4 text-right font-heading font-bold">{fmt(bs.totalAssets)}</td>
              </tr>

              {/* Liabilities */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Current Liabilities</td>
              </tr>
              <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                <td className="px-6 py-3 text-narra-ink pl-10">800 - Accounts Payable</td>
                <td className="px-6 py-3 text-right font-medium">{fmt(bs.accountsPayable || 0)}</td>
              </tr>
              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Liability (Credit)</td>
                <td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalLiabilities || 0)}</td>
              </tr>

              {/* Equity */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Equity</td>
              </tr>
              <tr className="border-t border-narra-border/50 hover:bg-narra-surface">
                <td className="px-6 py-3 text-narra-ink pl-10">920 - Retained Earnings</td>
                <td className={`px-6 py-3 text-right font-medium ${bs.retainedEarnings >= 0 ? '' : 'text-red-600'}`}>
                  {bs.retainedEarnings < 0 ? '(' : ''}{fmt(Math.abs(bs.retainedEarnings))}{bs.retainedEarnings < 0 ? ')' : ''}
                </td>
              </tr>
              <tr className="border-t border-narra-border bg-narra-surface">
                <td className="px-6 py-3 font-semibold text-narra-dark">Total Equity (Credit)</td>
                <td className={`px-6 py-3 text-right font-semibold ${bs.totalEquity >= 0 ? '' : 'text-red-600'}`}>
                  {bs.totalEquity < 0 ? '(' : ''}{fmt(Math.abs(bs.totalEquity))}{bs.totalEquity < 0 ? ')' : ''}
                </td>
              </tr>

              <tr className="border-t border-narra-border/50">
                <td className="px-6 py-3 text-narra-ink pl-10">Provisional Profit / Loss (Credit)</td>
                <td className={`px-6 py-3 text-right font-medium ${(bs.retainedEarnings || 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {(bs.retainedEarnings || 0) < 0 ? '(' : ''}{fmt(Math.abs(bs.retainedEarnings || 0))}{(bs.retainedEarnings || 0) < 0 ? ')' : ''}
                </td>
              </tr>
              <tr className="border-t-2 border-narra-dark">
                <td className="px-6 py-4 font-heading font-bold text-narra-dark">Total (Credit)</td>
                <td className="px-6 py-4 text-right font-heading font-bold">{fmt(bs.totalAssets)}</td>
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
                const total = gl.revenueRows.reduce((s: number, r: any) => s + r.amount, 0)
                return [
                  <tr key="rev-open" className="bg-narra-light/50 border-t-2 border-narra-dark">
                    <td className="px-4 py-2 text-xs text-narra-muted italic">'Opening'</td>
                    <td colSpan={2} className="px-4 py-2 font-heading font-semibold text-narra-dark text-xs">BANK Sleek Business Account USD — Service Revenue</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                  </tr>,
                  ...gl.revenueRows.map((r: any, i: number) => {
                    bal += r.amount
                    return (
                      <tr key={`rev-${i}`} className="border-t border-narra-border/30 hover:bg-narra-surface">
                        <td className="px-4 py-2.5 text-narra-muted text-xs font-mono">{r.date}</td>
                        <td className="px-4 py-2.5 text-narra-ink">{r.description}</td>
                        <td className="px-4 py-2.5 text-right text-narra-muted">0.00</td>
                        <td className="px-4 py-2.5 text-right font-medium text-green-700">{fmt(r.amount)}</td>
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
