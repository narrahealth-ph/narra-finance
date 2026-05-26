import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check the last 6 months
  const months: { label: string; display: string }[] = []
  for (let i = 1; i <= 6; i++) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const y = d.getFullYear()
    const m = d.getMonth()
    months.push({
      label:   `${MONTH_NAMES[m]}_${y}`,
      display: `${MONTH_NAMES[m].slice(0, 3)} ${y}`,
    })
  }

  const labels = months.map(m => m.label)

  const [periodsRes, bankRes, invoiceRes, reconciledRes] = await Promise.all([
    // Periods that exist (with lock status)
    query(
      `SELECT id, label, locked FROM periods WHERE label = ANY($1::text[])`,
      [labels]
    ),
    // Months that have bank transactions (expense or revenue)
    query(
      `SELECT DISTINCT p.label
       FROM bank_transactions bt
       JOIN periods p ON p.id = bt.period_id
       WHERE p.label = ANY($1::text[]) AND bt.type IN ('expense','revenue')`,
      [labels]
    ),
    // Months that have invoices synced from Drive
    query(
      `SELECT DISTINCT p.label
       FROM invoices i
       JOIN periods p ON p.id = i.period_id
       WHERE p.label = ANY($1::text[])`,
      [labels]
    ),
    // Months where at least one bank transaction has been matched or acknowledged
    query(
      `SELECT DISTINCT p.label
       FROM bank_transactions bt
       JOIN periods p ON p.id = bt.period_id
       WHERE p.label = ANY($1::text[]) AND bt.status IN ('matched','acknowledged')`,
      [labels]
    ),
  ])

  const periodsWithBank      = new Set(bankRes.rows.map((r: any) => r.label))
  const periodsWithInvoices  = new Set(invoiceRes.rows.map((r: any) => r.label))
  const periodsReconciled    = new Set(reconciledRes.rows.map((r: any) => r.label))
  const periodsMap           = new Map(periodsRes.rows.map((r: any) => [r.label, r]))

  const notifications: { month: string; issues: string[]; locked: boolean }[] = []

  for (const { label, display } of months) {
    const period = periodsMap.get(label)
    const locked = period?.locked ?? false

    const issues: string[] = []
    if (!periodsWithBank.has(label))     issues.push('No bank statements imported')
    if (!periodsWithInvoices.has(label)) issues.push('No invoices synced from Drive')
    if (periodsWithBank.has(label) && !periodsReconciled.has(label)) {
      issues.push('Bank statements imported but not reconciled')
    }

    if (issues.length > 0) {
      notifications.push({ month: display, issues, locked })
    }
  }

  return NextResponse.json({ notifications })
}
