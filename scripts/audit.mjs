import pg from 'pg'
const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_5szDEpgNd4tT@ep-twilight-dream-aob2e472-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
})
await client.connect()

function header(n, title) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`CHECK ${n}: ${title}`)
  console.log('='.repeat(60))
}

function printRows(rows) {
  if (rows.length === 0) {
    console.log('(no rows)')
    return
  }
  console.table(rows)
}

// 1. All years summary
header(1, 'ALL YEARS SUMMARY (by year, by type)')
const q1 = await client.query(`
  SELECT
    SPLIT_PART(p.label, '_', 2) AS yr,
    bt.type,
    COUNT(*) AS count,
    SUM(bt.amount_usd) AS total_usd
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  GROUP BY SPLIT_PART(p.label, '_', 2), bt.type
  ORDER BY yr, bt.type
`)
printRows(q1.rows)

// 2. Opening balances
header(2, 'OPENING BALANCES')
const q2 = await client.query(`
  SELECT
    p.label AS period_label,
    bt.description,
    bt.amount_usd
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.type = 'opening'
  ORDER BY p.start_date
`)
printRows(q2.rows)

// 3. Duplicate check
header(3, 'DUPLICATE TRANSACTIONS')
const q3 = await client.query(`
  SELECT
    p.label AS period_label,
    bt.date::date AS tx_date,
    bt.description,
    bt.amount_usd,
    COUNT(*) AS occurrences
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  GROUP BY p.label, bt.date::date, bt.description, bt.amount_usd
  HAVING COUNT(*) > 1
  ORDER BY occurrences DESC, period_label
`)
printRows(q3.rows)

// 4. Cross-year transactions
header(4, 'CROSS-YEAR TRANSACTIONS (tx date year != period year)')
const q4 = await client.query(`
  SELECT
    bt.id,
    p.label AS period_label,
    bt.date::date AS tx_date,
    EXTRACT(YEAR FROM bt.date) AS tx_year,
    SPLIT_PART(p.label,'_',2)::int AS period_year,
    bt.description,
    bt.amount_usd,
    bt.type
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE EXTRACT(YEAR FROM bt.date) != SPLIT_PART(p.label,'_',2)::int
    AND bt.type NOT IN ('opening','fx')
  ORDER BY period_label, bt.date
`)
printRows(q4.rows)

// 5. Negative or zero amounts
header(5, 'NEGATIVE OR ZERO AMOUNTS (excluding opening)')
const q5 = await client.query(`
  SELECT
    bt.id,
    p.label AS period_label,
    bt.description,
    bt.amount_usd,
    bt.type
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.amount_usd <= 0
    AND bt.type != 'opening'
  ORDER BY bt.amount_usd, period_label
`)
printRows(q5.rows)

// 6. Revenue transactions full list
header(6, 'REVENUE TRANSACTIONS (all time)')
const q6 = await client.query(`
  SELECT
    bt.id,
    p.label AS period_label,
    bt.date::date AS date,
    bt.description,
    bt.amount_usd,
    bt.currency,
    bt.status
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.type = 'revenue'
  ORDER BY p.start_date, bt.date
`)
printRows(q6.rows)

// 7. Investment transactions full list
header(7, 'INVESTMENT TRANSACTIONS (all time)')
const q7 = await client.query(`
  SELECT
    bt.id,
    p.label AS period_label,
    bt.date::date AS date,
    bt.description,
    bt.amount_usd,
    bt.currency
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.type = 'investment'
  ORDER BY p.start_date, bt.date
`)
printRows(q7.rows)

// 8. Capex full list
header(8, 'CAPEX TRANSACTIONS (all time)')
const q8 = await client.query(`
  SELECT
    bt.id,
    p.label AS period_label,
    bt.date::date AS date,
    bt.description,
    bt.amount_usd
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.type = 'capex'
  ORDER BY p.start_date, bt.date
`)
printRows(q8.rows)

// 9. FX transactions
header(9, 'FX TRANSACTIONS (count/total per period)')
const q9a = await client.query(`
  SELECT
    p.label AS period_label,
    COUNT(*) AS count,
    SUM(bt.amount_usd) AS total_usd
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.type = 'fx'
  GROUP BY p.label
  ORDER BY p.label
`)
console.log('FX per period:')
printRows(q9a.rows)

const q9b = await client.query(`
  SELECT
    p.label AS period_label,
    bt.date::date AS tx_date,
    SUM(bt.amount_usd) AS net_amount,
    COUNT(*) AS pair_count
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.type = 'fx'
  GROUP BY p.label, bt.date::date
  HAVING ABS(SUM(bt.amount_usd)) > 0.01
  ORDER BY ABS(SUM(bt.amount_usd)) DESC
`)
console.log('\nFX pairs that do NOT net to zero (|net| > 0.01):')
printRows(q9b.rows)

// 10. Period coverage
header(10, 'PERIOD COVERAGE')
const q10 = await client.query(`
  SELECT
    p.label,
    p.start_date::date,
    p.end_date::date,
    p.locked,
    COUNT(bt.id) AS tx_count
  FROM periods p
  LEFT JOIN bank_transactions bt ON bt.period_id = p.id
  GROUP BY p.id, p.label, p.start_date, p.end_date, p.locked
  ORDER BY p.start_date
`)
printRows(q10.rows)

// 11. Invoice table audit
header(11, 'INVOICE TABLE AUDIT (by year)')
const q11a = await client.query(`
  SELECT
    SPLIT_PART(p.label, '_', 2) AS yr,
    COUNT(*) AS count,
    SUM(inv.amount_usd) AS total_usd
  FROM invoices inv
  JOIN periods p ON p.id = inv.period_id
  GROUP BY SPLIT_PART(p.label, '_', 2)
  ORDER BY yr
`)
console.log('Invoices by year:')
printRows(q11a.rows)

const q11b = await client.query(`
  SELECT
    inv.id,
    p.label AS period_label,
    inv.amount_usd,
    inv.status
  FROM invoices inv
  JOIN periods p ON p.id = inv.period_id
  WHERE inv.amount_usd IS NULL OR inv.amount_usd = 0
  ORDER BY period_label
`)
console.log('\nInvoices with null or zero amount_usd:')
printRows(q11b.rows)

// 12. 2026 data so far
header(12, '2026 DATA SO FAR (by type)')
const q12 = await client.query(`
  SELECT
    bt.type,
    COUNT(*) AS count,
    SUM(bt.amount_usd) AS total_usd
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE SPLIT_PART(p.label, '_', 2) = '2026'
  GROUP BY bt.type
  ORDER BY bt.type
`)
printRows(q12.rows)

// 13. Cash flow waterfall per year
header(13, 'CASH FLOW WATERFALL (2024, 2025, 2026)')
const q13 = await client.query(`
  SELECT
    SPLIT_PART(p.label, '_', 2) AS yr,
    COALESCE(SUM(CASE WHEN bt.type = 'opening'    THEN bt.amount_usd ELSE 0 END), 0) AS opening_cash,
    COALESCE(SUM(CASE WHEN bt.type = 'revenue'    THEN bt.amount_usd ELSE 0 END), 0) AS revenue,
    COALESCE(SUM(CASE WHEN bt.type = 'investment' THEN bt.amount_usd ELSE 0 END), 0) AS investment,
    COALESCE(SUM(CASE WHEN bt.type = 'expense'    THEN bt.amount_usd ELSE 0 END), 0) AS expense,
    COALESCE(SUM(CASE WHEN bt.type = 'capex'      THEN bt.amount_usd ELSE 0 END), 0) AS capex,
    COALESCE(SUM(CASE WHEN bt.type = 'opening'    THEN bt.amount_usd ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN bt.type = 'revenue'    THEN bt.amount_usd ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN bt.type = 'investment' THEN bt.amount_usd ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN bt.type = 'expense'    THEN bt.amount_usd ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN bt.type = 'capex'      THEN bt.amount_usd ELSE 0 END), 0)
    AS closing_cash
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE SPLIT_PART(p.label, '_', 2) IN ('2024','2025','2026')
  GROUP BY SPLIT_PART(p.label, '_', 2)
  ORDER BY yr
`)
printRows(q13.rows)

// 14. Duplicate periods
header(14, 'DUPLICATE PERIOD LABELS')
const q14 = await client.query(`
  SELECT label, COUNT(*) AS count
  FROM periods
  GROUP BY label
  HAVING COUNT(*) > 1
`)
printRows(q14.rows)

// 15. Unmatched invoices by year
header(15, "UNMATCHED INVOICES (status='unmatched') BY YEAR")
const q15 = await client.query(`
  SELECT
    SPLIT_PART(p.label, '_', 2) AS yr,
    COUNT(*) AS count,
    SUM(inv.amount_usd) AS total_usd
  FROM invoices inv
  JOIN periods p ON p.id = inv.period_id
  WHERE inv.status = 'unmatched'
  GROUP BY SPLIT_PART(p.label, '_', 2)
  ORDER BY yr
`)
printRows(q15.rows)

await client.end()
console.log('\n=== AUDIT COMPLETE ===')
