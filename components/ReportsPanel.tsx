'use client'
import { useState, useEffect } from 'react'
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
    for (const tx of items as any[]) {
      const usd = parseFloat(tx.amount_usd); const amt = (!isNaN(usd) && usd > 0) ? usd : ((tx.currency || 'USD') === 'USD' ? parseFloat(tx.amount || 0) : 0)
      bal += amt
      rows.push([
        String(tx.date || '').split('T')[0],
        `${acct} - NARRA HEALTH PTE. LTD.`,
        fmt(amt), '0.00', fmt(bal),
        'Purchase Invoice', 'Purchase Invoice',
        tx.voucher_no || '',
        tx.description || tx.vendor || tx.drive_file_name || '',
        '', '', '', '',
        'Main - NARRA HEALTH PTE. LTD.',
        '', '', '',
      ])
    }
    const total = (items as any[]).reduce((s, i) => { const u = parseFloat(i.amount_usd); return s + ((!isNaN(u) && u > 0) ? u : ((i.currency || 'USD') === 'USD' ? parseFloat(i.amount || 0) : 0)) }, 0)
    rows.push([`'Total'`, '', fmt(total), '0.00', fmt(total), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push([`'Closing (Opening + Total)'`, '', fmt(opening + total), '0.00', fmt(opening + total), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', '', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
  }

  // 600 - Accounts Receivable
  if (bs.arItems?.length > 0) {
    rows.push([`'Opening'`, '', '0.00', '0.00', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
    let bal = 0
    for (const item of bs.arItems as any[]) {
      bal += item.amount
      rows.push([
        '',
        `600 - Accounts Receivable - NARRA HEALTH PTE. LTD.`,
        fmt(item.amount), '0.00', fmt(bal),
        'Sales Invoice', 'Sales Invoice',
        item.invoiceId || '',
        item.clientName || '',
        'Customer', item.clientName || '',
        '', '', 'Main - NARRA HEALTH PTE. LTD.',
        '', '', '',
      ])
    }
    const arTotal = bs.arTotal || 0
    rows.push([`'Total'`, '', fmt(arTotal), '0.00', fmt(arTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push([`'Closing (Opening + Total)'`, '', fmt(arTotal), '0.00', fmt(arTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', '', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
  }

  // Revenue rows — Credit to income account (DR Bank / CR Revenue)
  if (gl.revenueRows?.length > 0) {
    rows.push([`'Opening'`, '', '0.00', '0.00', '0.00', '', '', '', '', '', '', '', '', '', '', '', ''])
    let bal = 0
    for (const r of gl.revenueRows) {
      const amt = parseFloat(r.amount_usd || r.amount || 0)
      bal += amt
      rows.push([
        String(r.date || '').split('T')[0],
        '310 - Service Revenue - NARRA HEALTH PTE. LTD.',
        '0.00', fmt(amt), fmt(bal),          // Debit=0, Credit=revenue (correct double-entry)
        'Payment Entry', 'Sales Invoice', '',
        r.description || '',
        'Customer', r.description || '',
        '', '', 'Main - NARRA HEALTH PTE. LTD.',
        '', '', '',
      ])
    }
    const revTotal = gl.revenueRows.reduce((s: number, r: any) => s + parseFloat(r.amount_usd || r.amount || 0), 0)
    rows.push([`'Total'`, '', '0.00', fmt(revTotal), fmt(revTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
    rows.push([`'Closing (Opening + Total)'`, '', '0.00', fmt(revTotal), fmt(revTotal), '', '', '', '', '', '', '', '', '', '', '', ''])
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
  const MONTH_LIST = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const [month, year] = period.split('_')
  const mIdx = MONTH_LIST.indexOf(month) + 1
  const lastDay = new Date(parseInt(year), mIdx, 0).getDate()
  const startDate = `${year}-${String(mIdx).padStart(2,'0')}-01`
  const endDate   = `${year}-${String(mIdx).padStart(2,'0')}-${lastDay}`
  const fmtNet = (n: number) => n < 0 ? `-${fmt(Math.abs(n))}` : fmt(n)

  const rows: string[][] = [
    ['Report Name', 'Profit and Loss Statement'],
    ['Company Name', 'NARRA HEALTH PTE. LTD.'],
    ['Start Date', startDate],
    ['End Date',   endDate],
    ['', ''],
    ['Account', year],
  ]

  // Expenses
  rows.push(['Expenses', fmt(pl.totalExpenses || 0)])
  for (const [acct, items] of Object.entries(pl.expenseByAccount as Record<string, any[]>)) {
    const sub = (items as any[]).reduce((s, i) => {
      const u = parseFloat(i.amount_usd); return s + ((!isNaN(u) && u > 0) ? u : ((i.currency || 'USD') === 'USD' ? parseFloat(i.amount || 0) : 0))
    }, 0)
    rows.push([acct, fmt(sub)])
  }
  rows.push([`'Total Expense (Debit)'`, fmt(pl.totalExpenses || 0)])
  rows.push(['', ''])

  // Income (only if non-zero)
  if (pl.totalRevenue > 0) {
    rows.push(['Income', fmt(pl.totalRevenue)])
    rows.push(['310 - Service Revenue', fmt(pl.totalRevenue)])
    rows.push([`'Total Income (Credit)'`, fmt(pl.totalRevenue)])
    rows.push(['', ''])
  }

  rows.push([`'Profit for the year'`, fmtNet(pl.netProfit)])

  return rows.map(r => r.join(',')).join('\n')
}

function buildAnnualPLCSV(annualData: any): string {
  const { year, totals, expensesByDescription } = annualData
  const fmtNet = (n: number) => n < 0 ? `-${fmt(Math.abs(n))}` : fmt(n)
  const rows: string[][] = [
    ['Report Name', 'Profit and Loss Statement'],
    ['Company Name', 'NARRA HEALTH PTE. LTD.'],
    ['Start Date', `${year}-01-01`],
    ['End Date',   `${year}-12-31`],
    ['', ''],
    ['Account', year],
    ['Expenses', fmt(totals.expenses)],
    ...expensesByDescription.map((e: any) => [
      `"${(e.description || 'Other').replace(/"/g, '""')}"`,
      fmt(e.total),
    ]),
    [`'Total Expense (Debit)'`, fmt(totals.expenses)],
    ['', ''],
    ...(totals.revenue > 0 ? [
      ['Income', fmt(totals.revenue)],
      ['310 - Service Revenue', fmt(totals.revenue)],
      [`'Total Income (Credit)'`, fmt(totals.revenue)],
      ['', ''],
    ] : []),
    [`'Profit for the year'`, fmtNet(totals.net)],
  ]
  return rows.map(r => r.join(',')).join('\n')
}

function buildAnnualGLCSV(annualData: any): string {
  const { year, allTransactions } = annualData
  const rows: string[][] = [
    ['Report Name', 'Annual General Ledger', '', '', '', ''],
    ['Company Name', 'NARRA HEALTH PTE. LTD.', '', '', '', ''],
    ['Start Date', `${year}-01-01`, '', '', '', ''],
    ['End Date',   `${year}-12-31`, '', '', '', ''],
    ['Source', 'Bank transactions', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['Date', 'Description', 'Bank Account', 'Type', 'Amount (USD)', 'Running Balance'],
  ]
  let balance = 0
  for (const tx of (allTransactions || [])) {
    const amt = tx.type === 'revenue' ? tx.amount_usd : -tx.amount_usd
    balance += amt
    rows.push([
      tx.date ? new Date(tx.date).toISOString().split('T')[0] : '',
      `"${(tx.description || '').replace(/"/g, '""')}"`,
      tx.account || '',
      tx.type,
      tx.type === 'revenue' ? fmt(tx.amount_usd) : `(${fmt(tx.amount_usd)})`,
      fmt(balance),
    ])
  }
  return rows.map(r => r.join(',')).join('\n')
}

export default function ReportsPanel({ data, loading, period, selectedYear, onRefresh }: {
  data: any; loading: boolean; period: string; selectedYear?: string; onRefresh?: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    if (!onRefresh) return
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }
  const [tab, setTab] = useState<ReportTab>('pl')
  const [annualMode,    setAnnualMode]    = useState(false)
  const [annualData,    setAnnualData]    = useState<any>(null)
  const [annualBS,      setAnnualBS]      = useState<any>(null)
  const [annualLoading, setAnnualLoading] = useState(false)

  useEffect(() => {
    if (!annualMode || !selectedYear) return
    setAnnualLoading(true)
    setAnnualData(null)
    setAnnualBS(null)
    fetch(`/api/annual-report?year=${selectedYear}`, { credentials: 'include' })
      .then(r => r.json())
      .then(async (annual) => {
        setAnnualData(annual)
        if (annual.lastPeriodId) {
          const bsRes = await fetch(`/api/reports?periodId=${annual.lastPeriodId}`, { credentials: 'include' })
          const bsJson = await bsRes.json()
          setAnnualBS(bsJson?.bs || null)
        }
      })
      .finally(() => setAnnualLoading(false))
  }, [annualMode, selectedYear])

  // ── Annual mode early returns ──────────────────────────────────────────────
  if (annualMode) {
    if (annualLoading) return (
      <div className="flex items-center justify-center h-64 text-narra-muted animate-pulse-soft">
        Loading {selectedYear} annual report…
      </div>
    )

    const aYear = selectedYear || ''

    const exportAnnualPL = () => {
      if (!annualData) return
      downloadCSV(buildAnnualPLCSV(annualData), `NARRA_HEALTH_PTE__LTD__-_${aYear}_-_Annual_Profit_and_Loss.csv`)
    }
    const exportAnnualGL = () => {
      if (!annualData) return
      downloadCSV(buildAnnualGLCSV(annualData), `NARRA_HEALTH_PTE__LTD__-_${aYear}_-_Annual_General_Ledger.csv`)
    }
    const exportAnnualBS = () => {
      if (!annualBS) return
      const csv = buildBSCSV(annualBS, `December_${aYear}`)
      const blob = new Blob([csv], { type: 'text/csv' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a'); a.href = url
      a.download = `NARRA_HEALTH_PTE__LTD__-_${aYear}_-_Annual_Balance_Sheet.csv`
      a.click(); URL.revokeObjectURL(url)
    }

    const revenueRows  = (annualData?.allTransactions || []).filter((t: any) => t.type === 'revenue')
    const expenseRows  = annualData?.expensesByDescription || []
    const totals       = annualData?.totals || {}
    const bs           = annualBS

    return (
      <div className="space-y-6 animate-fade-up">
        {/* Header + toggle */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-heading text-xl font-semibold text-narra-dark">Financial Reports</h2>
            <p className="text-sm text-narra-muted mt-0.5">{aYear} · NARRA HEALTH PTE. LTD. · Bank-based (accountant-approved)</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Monthly / Annual toggle */}
            <div className="flex rounded-lg border border-narra-border overflow-hidden text-xs font-body">
              <button onClick={() => setAnnualMode(false)} className="px-3 py-2 text-narra-muted hover:bg-narra-light transition-all">Monthly</button>
              <button className="px-3 py-2 bg-narra-dark text-narra-green">Annual</button>
            </div>
            <button onClick={exportAnnualGL}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ GL CSV</button>
            <button onClick={exportAnnualBS}  disabled={!annualBS} className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all disabled:opacity-40">↓ BS CSV</button>
            <button onClick={exportAnnualPL}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ P&L CSV</button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 border-b border-narra-border">
          {[{ id: 'pl', label: 'P&L Statement' }, { id: 'bs', label: 'Balance Sheet' }, { id: 'gl', label: 'General Ledger' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as ReportTab)}
              className={`px-5 py-2.5 text-sm font-body transition-all border-b-2 -mb-px
                ${tab === t.id ? 'text-narra-dark border-narra-dark font-medium' : 'text-narra-muted border-transparent hover:text-narra-dark'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Annual P&L */}
        {tab === 'pl' && annualData && (
          <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-narra-border bg-narra-dark text-white flex justify-between items-start">
              <div>
                <div className="text-xs text-white/40 uppercase tracking-widest mb-1">NARRA HEALTH PTE. LTD.</div>
                <h3 className="font-heading font-semibold text-white">Annual Profit and Loss Statement</h3>
                <p className="text-xs text-white/50 mt-0.5">1 January {aYear} – 31 December {aYear} · Bank transactions</p>
              </div>
              <div className="text-right">
                <div className={`font-heading text-2xl font-semibold ${totals.net >= 0 ? 'text-narra-green' : 'text-red-400'}`}>
                  {totals.net < 0 ? '(' : ''}${fmt(Math.abs(totals.net || 0))}{totals.net < 0 ? ')' : ''}
                </div>
                <div className="text-xs text-white/40">{totals.net >= 0 ? 'Profit' : 'Loss'} for {aYear}</div>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-narra-border">
                  <th className="text-left px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">Account</th>
                  <th className="text-right px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">{aYear}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-narra-light/40">
                  <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider">
                    Expenses — ${fmt(totals.expenses)}
                  </td>
                </tr>
                {expenseRows.map((e: any, i: number) => (
                  <tr key={i} className="border-t border-narra-border/50 hover:bg-narra-surface">
                    <td className="px-6 py-2.5 text-narra-ink pl-10 truncate max-w-[500px]">{e.description || '—'}</td>
                    <td className="px-6 py-2.5 text-right font-medium text-narra-dark">{fmt(e.total)}</td>
                  </tr>
                ))}
                <tr className="border-t border-narra-border bg-narra-surface">
                  <td className="px-6 py-3 font-semibold text-narra-dark">Total Expense (Debit)</td>
                  <td className="px-6 py-3 text-right font-semibold text-narra-dark">{fmt(totals.expenses)}</td>
                </tr>

                {totals.revenue > 0 && <>
                  <tr className="bg-narra-light/40">
                    <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">
                      Income — ${fmt(totals.revenue)}
                    </td>
                  </tr>
                  {revenueRows.map((r: any, i: number) => (
                    <tr key={i} className="border-t border-narra-border/50 hover:bg-narra-surface">
                      <td className="px-6 py-2.5 text-narra-ink pl-10">310 - Service Revenue · {r.description}</td>
                      <td className="px-6 py-2.5 text-right font-medium text-green-700">{fmt(r.amount_usd)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-narra-border bg-narra-surface">
                    <td className="px-6 py-3 font-semibold text-narra-dark">Total Income (Credit)</td>
                    <td className="px-6 py-3 text-right font-semibold text-green-700">{fmt(totals.revenue)}</td>
                  </tr>
                </>}

                <tr className="border-t-2 border-narra-dark">
                  <td className="px-6 py-4 font-heading font-bold text-narra-dark text-base">Profit for the year</td>
                  <td className={`px-6 py-4 text-right font-heading font-bold text-base ${totals.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {totals.net < 0 ? '(' : ''}${fmt(Math.abs(totals.net || 0))}{totals.net < 0 ? ')' : ''}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Annual BS — year-end (December period) */}
        {tab === 'bs' && (
          bs ? (
            <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-narra-border bg-narra-dark text-white flex justify-between items-start">
                <div>
                  <div className="text-xs text-white/40 uppercase tracking-widest mb-1">NARRA HEALTH PTE. LTD.</div>
                  <h3 className="font-heading font-semibold text-white">Balance Sheet</h3>
                  <p className="text-xs text-white/50 mt-0.5">As at 31 December {aYear}</p>
                </div>
                {!bs.balanceCheck && (
                  <div className="bg-red-500/20 text-red-300 text-xs px-3 py-1.5 rounded-lg font-body">⚠ Out of balance</div>
                )}
              </div>
              {/* Reuse the same BS table structure */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-narra-border">
                    <th className="text-left px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">Account</th>
                    <th className="text-right px-6 py-2.5 text-xs text-narra-muted font-body uppercase tracking-widest">{aYear}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-narra-light/40"><td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider">Current Assets — ${fmt(bs.totalCurrentAssets||0)}</td></tr>
                  {Object.entries(bs.cashByAccount||{}).map(([acct,info]:any)=>(
                    <tr key={acct} className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">BANK {acct}</td><td className="px-6 py-3 text-right font-medium">{fmt(info.amount)}</td></tr>
                  ))}
                  {bs.prepayments>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">610 - Prepayments</td><td className="px-6 py-3 text-right">{fmt(bs.prepayments)}</td></tr>}
                  <tr className="border-t border-narra-border bg-narra-surface"><td className="px-6 py-3 font-semibold text-narra-dark">Total Current Assets</td><td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalCurrentAssets||0)}</td></tr>
                  {bs.arTotal>0&&<tr className="border-t border-narra-border/30 hover:bg-narra-surface"><td className="px-6 py-2.5 text-narra-muted pl-10 italic text-xs">600 - Accounts Receivable (memo — cash basis)</td><td className="px-6 py-2.5 text-right text-narra-muted text-xs italic">{fmt(bs.arTotal)}</td></tr>}
                  <tr className="border-t-2 border-narra-dark"><td className="px-6 py-4 font-heading font-bold text-narra-dark">Total Asset (Debit)</td><td className="px-6 py-4 text-right font-heading font-bold">{fmt(bs.totalAssets||0)}</td></tr>
                  <tr className="bg-narra-light/40"><td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Current Liabilities</td></tr>
                  {bs.accountsPayable>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">800 - Accounts Payable</td><td className="px-6 py-3 text-right">{fmt(bs.accountsPayable)}</td></tr>}
                  {bs.deferredRevenue>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">Deferred Revenue</td><td className="px-6 py-3 text-right">{fmt(bs.deferredRevenue)}</td></tr>}
                  {bs.director835>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">835 - Director Current Account</td><td className="px-6 py-3 text-right">{fmt(bs.director835)}</td></tr>}
                  {bs.director840>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">840 - Director Current Account</td><td className="px-6 py-3 text-right">{fmt(bs.director840)}</td></tr>}
                  {bs.director842>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">842 - Director Current Account</td><td className="px-6 py-3 text-right">{fmt(bs.director842)}</td></tr>}
                  {bs.incomeTax>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">860 - Income Tax Payable</td><td className="px-6 py-3 text-right">{fmt(bs.incomeTax)}</td></tr>}
                  {bs.gstPayable>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">GST Payable</td><td className="px-6 py-3 text-right">{fmt(bs.gstPayable)}</td></tr>}
                  <tr className="border-t border-narra-border bg-narra-surface"><td className="px-6 py-3 font-semibold text-narra-dark">Total Current Liabilities</td><td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalCurrentLiabilities||0)}</td></tr>
                  {bs.totalNonCurrentLiabilities>0&&<>
                    <tr className="bg-narra-light/40"><td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Non-current Liabilities</td></tr>
                    {bs.loans>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">851 - Loans</td><td className="px-6 py-3 text-right">{fmt(bs.loans)}</td></tr>}
                    {bs.investment852>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">852 - Founder Investment</td><td className="px-6 py-3 text-right">{fmt(bs.investment852)}</td></tr>}
                    {bs.investment853>0&&<tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">853 - Founder Investment</td><td className="px-6 py-3 text-right">{fmt(bs.investment853)}</td></tr>}
                    <tr className="border-t border-narra-border bg-narra-surface"><td className="px-6 py-3 font-semibold text-narra-dark">Total Non-current Liabilities</td><td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalNonCurrentLiabilities)}</td></tr>
                  </>}
                  <tr className="border-t border-narra-border bg-narra-surface"><td className="px-6 py-3 font-semibold text-narra-dark">Total Liability (Credit)</td><td className="px-6 py-3 text-right font-semibold">{fmt(bs.totalLiabilities||0)}</td></tr>
                  <tr className="bg-narra-light/40"><td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">Equity</td></tr>
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">900 - Share Capital</td><td className="px-6 py-3 text-right">{fmt(bs.shareCapital||0)}</td></tr>
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">920 - Retained Earnings</td><td className={`px-6 py-3 text-right ${(bs.retainedEarnings||0)<0?'text-red-600':''}`}>{(bs.retainedEarnings||0)<0?'(':''}{ fmt(Math.abs(bs.retainedEarnings||0))}{(bs.retainedEarnings||0)<0?')':''}</td></tr>
                  <tr className="border-t border-narra-border/50 hover:bg-narra-surface"><td className="px-6 py-3 text-narra-ink pl-10">Provisional Profit / Loss (Credit)</td><td className={`px-6 py-3 text-right ${(bs.provisionalPL||0)>=0?'text-green-700':'text-red-600'}`}>{(bs.provisionalPL||0)<0?'(':''}{fmt(Math.abs(bs.provisionalPL||0))}{(bs.provisionalPL||0)<0?')':''}</td></tr>
                  <tr className="border-t border-narra-border bg-narra-surface"><td className="px-6 py-3 font-semibold text-narra-dark">Total Equity (Credit)</td><td className={`px-6 py-3 text-right font-semibold ${(bs.totalEquity||0)<0?'text-red-600':''}`}>{(bs.totalEquity||0)<0?'(':''}{fmt(Math.abs(bs.totalEquity||0))}{(bs.totalEquity||0)<0?')':''}</td></tr>
                  <tr className="border-t-2 border-narra-dark"><td className="px-6 py-4 font-heading font-bold text-narra-dark">Total (Credit)</td><td className="px-6 py-4 text-right font-heading font-bold">{fmt(bs.totalAssets||0)}</td></tr>
                  <tr className={`border-t ${bs.balanceCheck?'bg-green-50':'bg-red-50'}`}><td colSpan={2} className={`px-6 py-2 text-xs font-body ${bs.balanceCheck?'text-green-700':'text-red-600'}`}>{bs.balanceCheck?'✓ Balanced — Assets equal Liabilities + Equity':'⚠ Out of balance — check manual entries in the Adjustments tab'}</td></tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-700">
              No December period found for {aYear}. Make sure December bank data is imported.
            </div>
          )
        )}

        {/* Annual GL */}
        {tab === 'gl' && annualData && (
          <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-narra-border bg-narra-dark text-white">
              <div className="text-xs text-white/40 uppercase tracking-widest mb-1">NARRA HEALTH PTE. LTD.</div>
              <h3 className="font-heading font-semibold text-white">Annual General Ledger</h3>
              <p className="text-xs text-white/50 mt-0.5">{aYear} · {(annualData.allTransactions||[]).length} bank transactions</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-narra-border bg-narra-surface">
                  <th className="text-left px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Date</th>
                  <th className="text-left px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Description</th>
                  <th className="text-left px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Account</th>
                  <th className="text-right px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Debit (USD)</th>
                  <th className="text-right px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Credit (USD)</th>
                  <th className="text-right px-4 py-3 text-xs text-narra-muted font-body uppercase tracking-widest">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let bal = 0
                  return (annualData.allTransactions || []).map((tx: any, i: number) => {
                    const amt = tx.amount_usd
                    if (tx.type === 'revenue') bal += amt
                    else bal -= amt
                    return (
                      <tr key={i} className="border-t border-narra-border/30 hover:bg-narra-surface">
                        <td className="px-4 py-2.5 text-narra-muted text-xs font-mono">{tx.date ? new Date(tx.date).toISOString().split('T')[0] : '—'}</td>
                        <td className="px-4 py-2.5 text-narra-ink max-w-[280px] truncate">{tx.description}</td>
                        <td className="px-4 py-2.5 text-narra-muted text-xs">{tx.account}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-narra-dark">{tx.type === 'expense' ? fmt(amt) : '—'}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-green-700">{tx.type === 'revenue' ? fmt(amt) : '—'}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${bal >= 0 ? 'text-narra-dark' : 'text-red-600'}`}>{bal < 0 ? '(' : ''}{fmt(Math.abs(bal))}{bal < 0 ? ')' : ''}</td>
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ── Monthly mode ───────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-narra-muted animate-pulse-soft">Generating reports…</div>
  )
  if (!data) return (
    <div className="flex flex-col items-center justify-center h-64 text-narra-muted gap-2">
      <div className="text-4xl">📊</div>
      <p className="text-sm">Import data to generate reports</p>
    </div>
  )

  const { gl, bs, pl, fxRates } = data

  // Build exchange rate footer for CSV exports
  const fxFooter = fxRates && fxRates.length > 0
    ? '\n\nExchange Rates Used\n' + fxRates.map((r: any) =>
        `${r.currency} → USD,${r.rate},as of ${r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}`
      ).join('\n') + '\nSource: ExchangeRate-API'
    : ''

  function exportGL() {
    const csv = buildGLCSV(gl, period, bs) + fxFooter
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `NARRA_HEALTH_PTE__LTD__-_${period}_-_General_Ledger.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function exportBS() {
    const csv = buildBSCSV(bs, period) + fxFooter
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `NARRA_HEALTH_PTE__LTD__-_${period}_-_Balance_Sheet.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function exportPL() {
    const csv = buildPLCSV(pl, period) + fxFooter
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
        <div className="flex gap-2 flex-wrap items-center">
          {/* Monthly / Annual toggle */}
          {selectedYear && (
            <div className="flex rounded-lg border border-narra-border overflow-hidden text-xs font-body">
              <button className="px-3 py-2 bg-narra-dark text-narra-green">Monthly</button>
              <button onClick={() => setAnnualMode(true)} className="px-3 py-2 text-narra-muted hover:bg-narra-light transition-all">Annual</button>
            </div>
          )}
          <button onClick={exportGL}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ GL CSV</button>
          <button onClick={exportBS}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ BS CSV</button>
          <button onClick={exportPL}  className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all">↓ P&L CSV</button>
          <button onClick={exportAll} className="px-3 py-2 bg-narra-dark text-narra-green rounded-lg text-xs font-body hover:bg-narra-mid transition-all">↓ Export All</button>
          {onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-2 border border-narra-border rounded-lg text-xs font-body text-narra-muted hover:bg-narra-light hover:text-narra-dark transition-all disabled:opacity-50 flex items-center gap-1"
            >
              {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
            </button>
          )}
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
              {/* Income section — always first per accounting standard */}
              {pl.totalRevenue > 0 && <>
                <tr className="bg-narra-light/40">
                  <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider">
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

              {/* Expenses section */}
              <tr className="bg-narra-light/40">
                <td colSpan={2} className="px-6 py-2 font-heading font-semibold text-narra-dark text-xs uppercase tracking-wider pt-3">
                  Expenses — ${fmt(pl.totalExpenses)}
                </td>
              </tr>
              {Object.entries(pl.expenseByAccount as Record<string, any[]>).map(([acct, items]) => {
                const sub = (items as any[]).reduce((s, i) => {
                  const usd = parseFloat(i.amount_usd)
                  if (!isNaN(usd) && usd > 0) return s + usd
                  if ((i.currency || 'USD') === 'USD') return s + parseFloat(i.amount || 0)
                  return s
                }, 0)
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

              {/* Bottom line */}
              <tr className="border-t-2 border-narra-dark">
                <td className="px-6 py-4 font-heading font-bold text-narra-dark text-base">Net Profit / (Loss) for the period</td>
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
            {!bs.balanceCheck && (() => {
              const f2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              const diff = bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)
              return (
                <div className="relative group">
                  <div className="bg-red-500/20 text-red-300 text-xs px-3 py-1.5 rounded-lg font-body cursor-default">
                    ⚠ Out of balance — check manual entries
                  </div>
                  <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block bg-narra-dark text-red-200 text-xs px-4 py-3 rounded-xl shadow-xl font-body w-64 space-y-1">
                    <div className="font-semibold text-red-300 pb-1">Off by ${f2(Math.abs(diff))}</div>
                    <div className="text-white/60 space-y-0.5">
                      <div className="flex justify-between"><span>Cash</span><span>${f2(bs.totalCash)}</span></div>
                      <div className="flex justify-between"><span>Prepayments</span><span>${f2(bs.prepayments)}</span></div>
                      <div className="flex justify-between"><span>Intangibles (670)</span><span>${f2(bs.intangibleAssets)}</span></div>
                      <div className="flex justify-between font-semibold text-white border-t border-white/10 pt-1"><span>Total Assets</span><span>${f2(bs.totalAssets)}</span></div>
                    </div>
                    <div className="text-white/60 space-y-0.5 pt-1">
                      <div className="flex justify-between"><span>All Liabilities</span><span>${f2(bs.totalLiabilities)}</span></div>
                      <div className="flex justify-between"><span>Share Capital</span><span>${f2(bs.shareCapital)}</span></div>
                      <div className="flex justify-between"><span>Retained Earnings</span><span>${f2(bs.retainedEarnings)}</span></div>
                      <div className="flex justify-between"><span>Current P&L</span><span>${f2(bs.provisionalPL)}</span></div>
                      <div className="flex justify-between font-semibold text-white border-t border-white/10 pt-1"><span>Total L+E</span><span>${f2(bs.totalLiabilities + bs.totalEquity)}</span></div>
                    </div>
                    <div className="text-red-300 border-t border-white/10 pt-1">
                      {diff > 0 ? 'Assets too high' : 'Liabilities/Equity too high'}
                    </div>
                  </div>
                </div>
              )
            })()}
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
              {bs.arTotal > 0 && (
                <tr className="border-t border-narra-border/30 hover:bg-narra-surface">
                  <td className="px-6 py-2 text-narra-muted pl-10 italic text-xs">600 - Accounts Receivable (memo — cash basis)</td>
                  <td className="px-6 py-2 text-right text-narra-muted text-xs italic">{fmt(bs.arTotal)}</td>
                </tr>
              )}

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
                const safeAmt = (i: any) => { const u = parseFloat(i.amount_usd); return (!isNaN(u) && u > 0) ? u : ((i.currency || 'USD') === 'USD' ? parseFloat(i.amount || 0) : 0) }
                const total = (items as any[]).reduce((s, i) => s + safeAmt(i), 0)
                return [
                  // Account header row
                  <tr key={`open-${acct}`} className="bg-narra-light/50 border-t border-narra-border">
                    <td className="px-4 py-2 text-xs text-narra-muted italic">'Opening'</td>
                    <td colSpan={2} className="px-4 py-2 font-heading font-semibold text-narra-dark text-xs">{acct} — NARRA HEALTH PTE. LTD.</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                  </tr>,

                  // Transaction rows
                  ...(items as any[]).map((tx: any, i: number) => {
                    const amt = (() => { const u = parseFloat(tx.amount_usd); return (!isNaN(u) && u > 0) ? u : ((tx.currency || 'USD') === 'USD' ? parseFloat(tx.amount || 0) : 0) })()
                    bal += amt
                    return (
                      <tr key={`${acct}-${i}`} className="border-t border-narra-border/30 hover:bg-narra-surface">
                        <td className="px-4 py-2.5 text-narra-muted text-xs font-mono">{String(tx.date).split('T')[0]}</td>
                        <td className="px-4 py-2.5 text-narra-ink">{tx.description || tx.vendor || tx.drive_file_name}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-narra-dark">{fmt(amt)}</td>
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

              {/* 600 - Accounts Receivable */}
              {bs.arItems?.length > 0 && (() => {
                let bal = 0
                const total = bs.arTotal || 0
                return [
                  <tr key="ar-open" className="bg-narra-light/50 border-t-2 border-narra-dark">
                    <td className="px-4 py-2 text-xs text-narra-muted italic">'Opening'</td>
                    <td colSpan={2} className="px-4 py-2 font-heading font-semibold text-narra-dark text-xs">600 - Accounts Receivable — NARRA HEALTH PTE. LTD.</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right text-xs text-narra-muted">0.00</td>
                  </tr>,
                  ...(bs.arItems as any[]).map((item: any, i: number) => {
                    bal += item.amount
                    return (
                      <tr key={`ar-${i}`} className="border-t border-narra-border/30 hover:bg-narra-surface">
                        <td className="px-4 py-2.5 text-narra-muted text-xs font-mono">—</td>
                        <td className="px-4 py-2.5 text-narra-ink">
                          {item.clientName}
                          <span className="ml-2 text-xs text-narra-muted">#{item.invoiceId} · {item.billingType} · {item.status}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-narra-dark">{fmt(item.amount)}</td>
                        <td className="px-4 py-2.5 text-right text-narra-muted">0.00</td>
                        <td className="px-4 py-2.5 text-right font-medium text-narra-dark">{fmt(bal)}</td>
                      </tr>
                    )
                  }),
                  <tr key="ar-total" className="border-t border-narra-border bg-narra-surface text-xs">
                    <td className="px-4 py-2 text-narra-muted italic">'Total'</td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right font-medium text-narra-dark">{fmt(total)}</td>
                    <td className="px-4 py-2 text-right text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right font-medium text-narra-dark">{fmt(total)}</td>
                  </tr>,
                  <tr key="ar-close" className="border-t border-narra-border/20 bg-narra-surface text-xs">
                    <td className="px-4 py-2 text-narra-muted italic">'Closing (Opening + Total)'</td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right font-semibold text-narra-dark">{fmt(total)}</td>
                    <td className="px-4 py-2 text-right text-narra-muted">0.00</td>
                    <td className="px-4 py-2 text-right font-semibold text-narra-dark">{fmt(total)}</td>
                  </tr>,
                ]
              })()}

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
