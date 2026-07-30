/**
 * seed-2025-bank.mjs
 * Imports all 2025 bank transactions from Narra Health Sleek statements.
 *
 * Transaction types used:
 *   opening    — opening cash balance (Jan 1, 2025)
 *   revenue    — client payments received
 *   expense    — operating costs (OPEX)
 *   capex      — product development / angel-funded capital expenditure
 *                (excluded from MRR operating burn; still a real cash outflow)
 *   investment — angel investor deposits (inflows from Rene / Mike)
 *
 * Currency exchanges (USD→SGD internal transfers within Sleek) are SKIPPED.
 * Wire fees on incoming USD payments are recorded as expenses.
 *
 * Run: node scripts/seed-2025-bank.mjs
 */

import pg from 'pg'
const { Client } = pg

const DB = 'postgresql://neondb_owner:npg_5szDEpgNd4tT@ep-twilight-dream-aob2e472-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

// Actual SGD→USD rates derived from currency-exchange transactions in each statement
const SGD_USD = {
  '2025-01': 0.740,
  '2025-02': 0.752,
  '2025-03': 0.750,
  '2025-04': 0.750,
  '2025-05': 0.773,
  '2025-06': 0.783,
  '2025-07': 0.762,
  '2025-08': 0.762,
  '2025-09': 0.762,
  '2025-10': 0.779,
  '2025-11': 0.768,
  '2025-12': 0.760,
}

function toUsd(amount, currency, dateStr) {
  if (currency === 'USD') return amount
  const ym = dateStr.slice(0, 7)
  const rate = SGD_USD[ym] || 0.74
  return Math.round(amount * rate * 100) / 100
}

// ── Transaction data ──────────────────────────────────────────────────────────
// Each entry: { date, description, amount, currency, type }
// USD amounts: amount = amount_usd directly
// SGD amounts: amount_usd computed via toUsd()

const TRANSACTIONS = {

  // ─── JANUARY 2025 ───────────────────────────────────────────────────────────
  January_2025: [
    // Opening balances (Jan 1)
    { date:'2025-01-01', description:'Opening Balance — USD account',  amount:4310.90,  currency:'USD', type:'opening', account:'USD' },
    { date:'2025-01-01', description:'Opening Balance — SGD account',  amount:1302.49,  currency:'SGD', type:'opening', account:'SGD' },
    // OPEX
    { date:'2025-01-01', description:'Google GSUITE_narramind',         amount:73.93,    currency:'SGD', type:'expense' },
    { date:'2025-01-14', description:'NOTION LABS, INC.',               amount:53.05,    currency:'SGD', type:'expense' },
    { date:'2025-01-31', description:'Mary Jane Carreon - Narra Health tshirts and totes', amount:520.96, currency:'SGD', type:'expense' },
  ],

  // ─── FEBRUARY 2025 ──────────────────────────────────────────────────────────
  February_2025: [
    // OPEX (SGD)
    { date:'2025-02-01', description:'Mary Jane Carreon - Marketing/Advertising',  amount:10.33,    currency:'SGD', type:'expense' },
    { date:'2025-02-01', description:'Mary Jane Carreon - Marketing/Advertising',  amount:30.00,    currency:'SGD', type:'expense' },
    { date:'2025-02-01', description:'Google GSUITE',                               amount:73.46,    currency:'SGD', type:'expense' },
    { date:'2025-02-03', description:'SLACK',                                       amount:12.98,    currency:'SGD', type:'expense' },
    { date:'2025-02-14', description:'NOTION LABS, INC.',                           amount:53.32,    currency:'SGD', type:'expense' },
    { date:'2025-02-20', description:'LinkedIn',                                    amount:126.72,   currency:'SGD', type:'expense' },
    // Product development (CAPEX — angel-funded, excluded from OPEX burn)
    { date:'2025-02-23', description:'Stella Regina Pangilinan - Development milestone fee', amount:1575.02, currency:'SGD', type:'capex' },
    // Client revenue (USD)
    { date:'2025-02-20', description:'K LINE LOGISTICS PHILS INC - Membership Dues',         amount:8257.00, currency:'USD', type:'revenue' },
    { date:'2025-02-21', description:'K LINE AUTO LOGISTICS PHILIPPINES',                     amount:738.00,  currency:'USD', type:'revenue' },
    { date:'2025-02-21', description:'ORIENT FREIGHT INTERNATIONAL INC',                     amount:15796.00,currency:'USD', type:'revenue' },
    { date:'2025-02-26', description:'K LINE AUTO SOLUTIONS INC',                            amount:2788.00, currency:'USD', type:'revenue' },
    // Wire fees on inbound USD payments
    { date:'2025-02-21', description:'K LINE LOGISTICS — wire fee',   amount:7.40, currency:'USD', type:'expense' },
    { date:'2025-02-22', description:'K LINE AUTO LOGISTICS — wire fee', amount:7.42, currency:'USD', type:'expense' },
    { date:'2025-02-22', description:'ORIENT FREIGHT — wire fee',     amount:7.41, currency:'USD', type:'expense' },
    { date:'2025-02-27', description:'K LINE AUTO SOLUTIONS — wire fee', amount:7.41, currency:'USD', type:'expense' },
  ],

  // ─── MARCH 2025 ─────────────────────────────────────────────────────────────
  March_2025: [
    { date:'2025-03-01', description:'Google GSUITE',       amount:73.05,  currency:'SGD', type:'expense' },
    { date:'2025-03-03', description:'SLACK',               amount:12.90,  currency:'SGD', type:'expense' },
    { date:'2025-03-14', description:'NOTION LABS, INC.',   amount:115.56, currency:'SGD', type:'expense' },
    // LinkedIn refund (SGD 126.72 deposit) and Sleek refund (SGD 126.72 deposit) → skip; net zero effect
  ],

  // ─── APRIL 2025 ─────────────────────────────────────────────────────────────
  April_2025: [
    // OPEX (SGD)
    { date:'2025-04-01', description:'Google GSUITE',             amount:72.65,   currency:'SGD', type:'expense' },
    { date:'2025-04-03', description:'SLACK',                     amount:12.86,   currency:'SGD', type:'expense' },
    { date:'2025-04-11', description:'ZOOM.COM',                  amount:234.44,  currency:'SGD', type:'expense' },
    { date:'2025-04-14', description:'NOTION LABS, INC.',         amount:109.36,  currency:'SGD', type:'expense' },
    { date:'2025-04-29', description:'OPENAI *CHATGPT SUBSCR',    amount:28.70,   currency:'SGD', type:'expense' },
    // Payroll via IDEIN SERVICES (USD — through bank)
    { date:'2025-04-01', description:'IDEIN SERVICES - Salary Payment March 2025', amount:1652.25, currency:'USD', type:'expense' },
    { date:'2025-04-02', description:'IDEIN SERVICES — payroll fee', amount:22.16, currency:'USD', type:'expense' },
    { date:'2025-04-02', description:'IDEIN SERVICES — payroll fee', amount:7.72,  currency:'USD', type:'expense' },
    { date:'2025-04-28', description:'IDEIN SERVICES - Payroll Services April 2025', amount:1783.86, currency:'USD', type:'expense' },
    { date:'2025-04-29', description:'IDEIN SERVICES — payroll fee', amount:30.17, currency:'USD', type:'expense' },
    { date:'2025-04-29', description:'IDEIN SERVICES — payroll fee', amount:15.00, currency:'USD', type:'expense' },
  ],

  // ─── MAY 2025 ───────────────────────────────────────────────────────────────
  May_2025: [
    // OPEX (SGD)
    { date:'2025-05-01', description:'Google GSUITE',             amount:73.06,   currency:'SGD', type:'expense' },
    { date:'2025-05-03', description:'SLACK',                     amount:12.52,   currency:'SGD', type:'expense' },
    { date:'2025-05-11', description:'CALENDLY',                  amount:203.35,  currency:'SGD', type:'expense' },
    { date:'2025-05-14', description:'NOTION LABS, INC.',         amount:123.52,  currency:'SGD', type:'expense' },
    { date:'2025-05-17', description:'SQSP (Squarespace)',         amount:93.98,   currency:'SGD', type:'expense' },
    { date:'2025-05-19', description:'Mailchimp',                  amount:142.57,  currency:'SGD', type:'expense' },
    { date:'2025-05-20', description:'AirAsia - Travel',           amount:316.35,  currency:'SGD', type:'expense' },
    { date:'2025-05-21', description:'Hotel at Booking.com',       amount:400.15,  currency:'SGD', type:'expense' },
    { date:'2025-05-29', description:'OPENAI *CHATGPT SUBSCR',    amount:28.12,   currency:'SGD', type:'expense' },
    { date:'2025-05-29', description:'SLACK',                     amount:209.13,  currency:'SGD', type:'expense' },
    // Product development — CAPEX (angel-funded)
    { date:'2025-05-02', description:'Stella Regina Pangilinan - Product Development GoLaunch Phase 1', amount:3849.26, currency:'SGD', type:'capex' },
    { date:'2025-05-13', description:'Stella Regina Pangilinan - Narra Project Kickoff',                amount:7600.59, currency:'SGD', type:'capex' },
    // Client revenue (USD)
    { date:'2025-05-06', description:'LAWINA COMPANY LIMITED - Payment for INV', amount:18065.50, currency:'USD', type:'revenue' },
    { date:'2025-05-07', description:'LAWINA COMPANY LIMITED — wire fee',         amount:7.68,     currency:'USD', type:'expense' },
  ],

  // ─── JUNE 2025 ──────────────────────────────────────────────────────────────
  June_2025: [
    // OPEX (SGD)
    { date:'2025-06-01', description:'Google GSUITE',             amount:93.08,   currency:'SGD', type:'expense' },
    { date:'2025-06-11', description:'CALENDLY',                  amount:243.31,  currency:'SGD', type:'expense' },
    { date:'2025-06-14', description:'NOTION LABS, INC.',         amount:112.31,  currency:'SGD', type:'expense' },
    { date:'2025-06-19', description:'Mailchimp',                  amount:141.06,  currency:'SGD', type:'expense' },
    { date:'2025-06-28', description:'Mike - PAYNOW Payroll',      amount:6016.00, currency:'SGD', type:'expense' },
    { date:'2025-06-28', description:'SLACK',                     amount:180.16,  currency:'SGD', type:'expense' },
    { date:'2025-06-29', description:'OPENAI *CHATGPT SUBSCR',    amount:27.87,   currency:'SGD', type:'expense' },
    // Product development — CAPEX
    { date:'2025-06-19', description:'Stella Regina Pangilinan - Payment Narra Health V2 Month 1', amount:7523.55, currency:'SGD', type:'capex' },
    // Client revenue (USD)
    { date:'2025-06-18', description:'LAWINA COMPANY LIMITED - Payment for INV', amount:12892.30, currency:'USD', type:'revenue' },
    { date:'2025-06-19', description:'LAWINA COMPANY LIMITED — wire fee',         amount:7.72,     currency:'USD', type:'expense' },
  ],

  // ─── JULY 2025 ──────────────────────────────────────────────────────────────
  July_2025: [
    { date:'2025-07-01', description:'Google GSUITE',             amount:103.00,  currency:'SGD', type:'expense' },
    { date:'2025-07-11', description:'CALENDLY',                  amount:242.08,  currency:'SGD', type:'expense' },
    { date:'2025-07-14', description:'NOTION LABS, INC.',         amount:94.17,   currency:'SGD', type:'expense' },
    { date:'2025-07-19', description:'Mailchimp',                  amount:140.97,  currency:'SGD', type:'expense' },
    { date:'2025-07-28', description:'SLACK',                     amount:178.22,  currency:'SGD', type:'expense' },
    { date:'2025-07-29', description:'OPENAI *CHATGPT SUBSCR',    amount:27.96,   currency:'SGD', type:'expense' },
  ],

  // ─── AUGUST 2025 ────────────────────────────────────────────────────────────
  August_2025: [
    // OPEX (SGD)
    { date:'2025-08-01', description:'Google GSUITE',             amount:104.81,  currency:'SGD', type:'expense' },
    { date:'2025-08-11', description:'CALENDLY',                  amount:242.88,  currency:'SGD', type:'expense' },
    { date:'2025-08-14', description:'NOTION LABS, INC.',         amount:123.69,  currency:'SGD', type:'expense' },
    { date:'2025-08-19', description:'Mailchimp',                  amount:140.78,  currency:'SGD', type:'expense' },
    { date:'2025-08-22', description:'CALENDLY',                  amount:48.70,   currency:'SGD', type:'expense' },
    { date:'2025-08-28', description:'SLACK',                     amount:295.76,  currency:'SGD', type:'expense' },
    { date:'2025-08-29', description:'OPENAI *CHATGPT SUBSCR',    amount:28.13,   currency:'SGD', type:'expense' },
    // Product development — CAPEX
    { date:'2025-08-21', description:'Stella Regina Pangilinan - GoLaunch Invoice 011', amount:7307.95, currency:'SGD', type:'capex' },
    // Angel investor deposit — Investment Round 2 (Rene)
    { date:'2025-08-12', description:'RENE R GARCIA - Investment Round 2 (1001 Donation)', amount:9397.26, currency:'SGD', type:'investment' },
  ],

  // ─── SEPTEMBER 2025 ─────────────────────────────────────────────────────────
  September_2025: [
    // OPEX (SGD)
    { date:'2025-09-01', description:'Google GSUITE',             amount:103.75,  currency:'SGD', type:'expense' },
    { date:'2025-09-11', description:'CALENDLY',                  amount:317.11,  currency:'SGD', type:'expense' },
    { date:'2025-09-14', description:'NOTION LABS, INC.',         amount:113.59,  currency:'SGD', type:'expense' },
    { date:'2025-09-19', description:'Mailchimp',                  amount:140.68,  currency:'SGD', type:'expense' },
    { date:'2025-09-24', description:'CALENDLY',                  amount:42.54,   currency:'SGD', type:'expense' },
    { date:'2025-09-28', description:'SLACK',                     amount:314.86,  currency:'SGD', type:'expense' },
    { date:'2025-09-29', description:'OPENAI *CHATGPT SUBSCR',    amount:28.24,   currency:'SGD', type:'expense' },
    // GARCIA M J B deposit — flagged as investment; verify with accountant (could be Mike Garcia / client revenue)
    { date:'2025-09-23', description:'GARCIA M J B - PeraltaVet and NAVC [REVIEW: investment or client revenue?]', amount:1537.00, currency:'SGD', type:'investment' },
  ],

  // ─── OCTOBER 2025 ───────────────────────────────────────────────────────────
  October_2025: [
    // OPEX (SGD)
    { date:'2025-10-01', description:'Google GSUITE',                         amount:104.24,  currency:'SGD', type:'expense' },
    { date:'2025-10-02', description:'PAYPAL *EKIMGARCIA - Payroll (Mike Garcia)', amount:5176.31,currency:'SGD', type:'expense' },
    { date:'2025-10-03', description:'LIGHTHOUSE INDEPENDENT',                amount:616.33,  currency:'SGD', type:'expense' },
    { date:'2025-10-07', description:'Kahoot Oslo',                           amount:257.82,  currency:'SGD', type:'expense' },
    { date:'2025-10-11', description:'CALENDLY',                              amount:396.52,  currency:'SGD', type:'expense' },
    { date:'2025-10-14', description:'NOTION LABS, INC.',                     amount:94.77,   currency:'SGD', type:'expense' },
    { date:'2025-10-19', description:'Mailchimp',                              amount:142.13,  currency:'SGD', type:'expense' },
    { date:'2025-10-22', description:'GROUPGREETING',                         amount:9.00,    currency:'SGD', type:'expense' },
    { date:'2025-10-27', description:'NOMINUS.COM',                           amount:213.29,  currency:'SGD', type:'expense' },
    { date:'2025-10-28', description:'SLACK',                                 amount:279.97,  currency:'SGD', type:'expense' },
    { date:'2025-10-29', description:'OPENAI *CHATGPT SUBSCR',               amount:28.31,   currency:'SGD', type:'expense' },
    { date:'2025-10-29', description:'CALENDLY',                              amount:7.94,    currency:'SGD', type:'expense' },
    { date:'2025-10-31', description:'TMG Express Inc - Launch Party Catering', amount:1442.48,currency:'SGD', type:'expense' },
    // Product development — CAPEX
    { date:'2025-10-06', description:'Stella Regina Pangilinan - GoLaunch V2 Fourth Payment', amount:7234.95, currency:'SGD', type:'capex' },
    // Client revenue (USD)
    { date:'2025-10-30', description:'LAWINA COMPANY LIMITED - Payment for INV', amount:7603.20, currency:'USD', type:'revenue' },
    { date:'2025-10-08', description:'ORIENT FREIGHT INTERNATIONAL INC',          amount:472.00,  currency:'USD', type:'revenue' },
    { date:'2025-10-09', description:'ORIENT FREIGHT — wire fee',                 amount:7.65,    currency:'USD', type:'expense' },
    { date:'2025-10-31', description:'LAWINA COMPANY — wire fee',                 amount:7.64,    currency:'USD', type:'expense' },
    // Unknown deposit — flagged; NSTAPTE3 may be an investor or refund
    { date:'2025-10-07', description:'NSTAPTE3 [REVIEW: investment source unknown]', amount:3670.59, currency:'SGD', type:'investment' },
  ],

  // ─── NOVEMBER 2025 ──────────────────────────────────────────────────────────
  November_2025: [
    // OPEX (SGD)
    { date:'2025-11-01', description:'TMG EXPRESS INC - Launch Party Catering fee',   amount:9.83,    currency:'SGD', type:'expense' },
    { date:'2025-11-01', description:'TMG EXPRESS INC - Launch Party Catering fee',   amount:30.00,   currency:'SGD', type:'expense' },
    { date:'2025-11-01', description:'Google GSUITE',                                  amount:105.09,  currency:'SGD', type:'expense' },
    { date:'2025-11-05', description:'Tatiana Garcia - Rode microphone',               amount:133.00,  currency:'SGD', type:'expense' },
    { date:'2025-11-11', description:'CALENDLY',                                       amount:416.52,  currency:'SGD', type:'expense' },
    { date:'2025-11-14', description:'NOTION LABS, INC.',                              amount:194.16,  currency:'SGD', type:'expense' },
    { date:'2025-11-17', description:'Michael Jack Bermont - Idein Consulting October 2025', amount:4184.14, currency:'SGD', type:'expense' },
    { date:'2025-11-19', description:'Mailchimp',                                       amount:142.90,  currency:'SGD', type:'expense' },
    { date:'2025-11-28', description:'SLACK',                                          amount:358.51,  currency:'SGD', type:'expense' },
    { date:'2025-11-29', description:'OPENAI *CHATGPT SUBSCR',                        amount:28.32,   currency:'SGD', type:'expense' },
    // Product development — CAPEX
    { date:'2025-11-05', description:'Stella Regina Pangilinan - GoLaunch 5th Payment', amount:6994.97, currency:'SGD', type:'capex' },
  ],

  // ─── DECEMBER 2025 ──────────────────────────────────────────────────────────
  December_2025: [
    // OPEX (SGD) — CRAFTMNL: one charge stands after reversal
    { date:'2025-12-01', description:'PAYPAL *CRAFTMNL',                      amount:137.51,  currency:'SGD', type:'expense' },
    { date:'2025-12-01', description:'Google Workspace',                       amount:104.76,  currency:'SGD', type:'expense' },
    { date:'2025-12-11', description:'CALENDLY',                               amount:414.73,  currency:'SGD', type:'expense' },
    { date:'2025-12-14', description:'NOTION LABS, INC.',                      amount:152.37,  currency:'SGD', type:'expense' },
    { date:'2025-12-19', description:'CALENDLY',                               amount:14.39,   currency:'SGD', type:'expense' },
    { date:'2025-12-19', description:'Mailchimp',                               amount:141.63,  currency:'SGD', type:'expense' },
    { date:'2025-12-28', description:'SLACK',                                  amount:304.54,  currency:'SGD', type:'expense' },
    { date:'2025-12-29', description:'OPENAI *CHATGPT SUBSCR',                amount:28.03,   currency:'SGD', type:'expense' },
    // OPEX (USD)
    { date:'2025-12-02', description:'Lawina Company Limited - Health Insurance 2025', amount:1118.55, currency:'USD', type:'expense' },
    { date:'2025-12-03', description:'LAWINA COMPANY LIMITED — fee',           amount:12.87,   currency:'USD', type:'expense' },
    { date:'2025-12-03', description:'LAWINA COMPANY LIMITED — fee',           amount:22.95,   currency:'USD', type:'expense' },
    { date:'2025-12-18', description:'MC1 Enterprises - MC1 Merchandise',     amount:1243.89, currency:'USD', type:'expense' },
    { date:'2025-12-19', description:'MC1 ENTERPRISES — fee',                 amount:7.53,    currency:'USD', type:'expense' },
    { date:'2025-12-19', description:'MC1 ENTERPRISES — fee',                 amount:23.03,   currency:'USD', type:'expense' },
  ],
}

// ── Main ──────────────────────────────────────────────────────────────────────

const client = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
await client.connect()
console.log('✓ Connected to DB\n')

const MONTH_DAYS = { January:31, February:28, March:31, April:30, May:31, June:30, July:31, August:31, September:30, October:31, November:30, December:31 }

let totalInserted = 0
let totalSkipped  = 0

for (const [periodLabel, txns] of Object.entries(TRANSACTIONS)) {
  const [monthName, yearStr] = periodLabel.split('_')
  const year      = parseInt(yearStr)
  const monthIdx  = Object.keys(MONTH_DAYS).indexOf(monthName) + 1
  const startDate = `${year}-${String(monthIdx).padStart(2,'0')}-01`
  const endDate   = `${year}-${String(monthIdx).padStart(2,'0')}-${String(MONTH_DAYS[monthName]).padStart(2,'0')}`

  // Ensure period exists (upsert-safe: check first then insert)
  let pRes = await client.query(`SELECT id FROM periods WHERE label = $1`, [periodLabel])
  if (pRes.rows.length === 0) {
    pRes = await client.query(
      `INSERT INTO periods (label, start_date, end_date) VALUES ($1, $2, $3) RETURNING id`,
      [periodLabel, startDate, endDate]
    )
  }
  const periodId = pRes.rows[0].id
  console.log(`\n── ${periodLabel} (period_id=${periodId}) ──`)

  for (const tx of txns) {
    const amountUsd = toUsd(tx.amount, tx.currency, tx.date)

    // Skip if already exists (same period + description + amount_usd within $0.02)
    const dup = await client.query(
      `SELECT id FROM bank_transactions
       WHERE period_id = $1 AND description = $2 AND ABS(amount_usd - $3) < 0.02`,
      [periodId, tx.description, amountUsd]
    )
    if (dup.rows.length > 0) {
      console.log(`  SKIP  ${tx.type.padEnd(10)} ${tx.currency} ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0,60)}`)
      totalSkipped++
      continue
    }

    await client.query(
      `INSERT INTO bank_transactions
         (period_id, date, description, amount, currency, amount_usd, type, account, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unmatched')`,
      [periodId, tx.date, tx.description, tx.amount, tx.currency, amountUsd, tx.type, tx.account || tx.currency]
    )
    console.log(`  INSERT ${tx.type.padEnd(10)} ${tx.currency} ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0,60)}`)
    totalInserted++
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────')
console.log(`Inserted: ${totalInserted}  |  Skipped (already existed): ${totalSkipped}`)

const summary = await client.query(`
  SELECT bt.type,
         COUNT(*)::int                              AS count,
         SUM(bt.amount_usd)::numeric(12,2)          AS total_usd
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE p.start_date >= '2025-01-01' AND p.start_date < '2026-01-01'
  GROUP BY bt.type
  ORDER BY bt.type
`)
console.log('\n2025 transactions by type:')
for (const r of summary.rows) {
  console.log(`  ${r.type.padEnd(12)} ${String(r.count).padStart(4)} txns   $${r.total_usd}`)
}

await client.end()
console.log('\n✓ Done.')
