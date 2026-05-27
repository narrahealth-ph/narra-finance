import pg from 'pg'
const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_5szDEpgNd4tT@ep-twilight-dream-aob2e472-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
})

await client.connect()
console.log('Connected to DB\n')

// ── 1. Check existing 2024 periods ──────────────────────────────────────────
const existingPeriods = await client.query(`
  SELECT id, label, start_date, end_date
  FROM periods
  WHERE start_date >= '2024-01-01' AND start_date < '2025-01-01'
  ORDER BY start_date
`)
console.log('Existing 2024 periods:', existingPeriods.rows)

// ── 2. Create missing 2024 periods (Aug–Dec) ─────────────────────────────────
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
const neededMonths = [
  { month: 8,  year: 2024 }, // August
  { month: 9,  year: 2024 }, // September
  { month: 10, year: 2024 }, // October
  { month: 11, year: 2024 }, // November
  { month: 12, year: 2024 }, // December
]

const periodIds = {}

for (const { month, year } of neededMonths) {
  const label = `${monthNames[month - 1]}_${year}`
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endMonth = month === 12 ? 1 : month + 1
  const endYear  = month === 12 ? year + 1 : year
  const endDate  = `${endYear}-${String(endMonth).padStart(2, '0')}-01`

  const existing = existingPeriods.rows.find(r => r.label === label)
  if (existing) {
    console.log(`Period ${label} already exists (id=${existing.id})`)
    periodIds[label] = existing.id
    continue
  }

  const res = await client.query(
    `INSERT INTO periods (label, start_date, end_date) VALUES ($1, $2, $3) RETURNING id`,
    [label, startDate, endDate]
  )
  console.log(`Created period ${label} (id=${res.rows[0].id})`)
  periodIds[label] = res.rows[0].id
}
console.log('\nPeriod IDs:', periodIds)

// ── 3. Check current bank_transactions for 2024 ──────────────────────────────
const existing2024 = await client.query(`
  SELECT bt.id, bt.description, bt.amount_usd, bt.currency, bt.type, p.label
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE p.start_date >= '2024-01-01' AND p.start_date < '2025-01-01'
  ORDER BY p.start_date
`)
console.log('\nExisting 2024 bank_transactions:', existing2024.rows.length, 'rows')

// ── 4. Insert 2024 investment deposits ───────────────────────────────────────
// Only insert if they don't already exist (check by description + period)

const investments2024 = [
  {
    label: 'August_2024',
    description: 'GARCIA MICHAEL JACK BERMONT - SGD Opening Deposit',
    amount_usd: 3142.00,   // SGD 4,102.88 @ ~1.278
    currency: 'SGD',
    type: 'investment',
  },
  {
    label: 'August_2024',
    description: 'RENE R GARCIA OR MARIA MARGARITA - 6 210 INVESTMENTS',
    amount_usd: 3150.00,
    currency: 'USD',
    type: 'investment',
  },
  {
    label: 'December_2024',
    description: 'RENE R GARCIA OR MARIA MARGARITA - 6 210 INVESTMENTS',
    amount_usd: 3540.00,
    currency: 'USD',
    type: 'investment',
  },
  {
    label: 'December_2024',
    description: 'GARCIA MICHAEL JACK BERMONT',
    amount_usd: 3500.00,
    currency: 'USD',
    type: 'investment',
  },
]

// 2024 expenses from bank statements
const expenses2024 = [
  // August 2024
  { label: 'August_2024',    description: 'Stella Pangilinan - Developer',         amount_usd: 400.00, currency: 'USD', type: 'expense' },
  // September 2024
  { label: 'September_2024', description: 'Carl Lorenz Cervantes - Psychologist Training', amount_usd: 120.00, currency: 'USD', type: 'expense' },
  { label: 'September_2024', description: 'Stella Pangilinan - Developer',         amount_usd: 400.00, currency: 'USD', type: 'expense' },
  { label: 'September_2024', description: 'Google Workspace',                       amount_usd: 12.00,  currency: 'USD', type: 'expense' },
  { label: 'September_2024', description: 'Notion',                                 amount_usd: 16.00,  currency: 'USD', type: 'expense' },
  // October 2024
  { label: 'October_2024',   description: 'Stella Pangilinan - Developer',         amount_usd: 400.00, currency: 'USD', type: 'expense' },
  { label: 'October_2024',   description: 'Google Workspace',                       amount_usd: 12.00,  currency: 'USD', type: 'expense' },
  { label: 'October_2024',   description: 'Gumroad',                                amount_usd: 10.00,  currency: 'USD', type: 'expense' },
  { label: 'October_2024',   description: 'Squarespace',                            amount_usd: 16.00,  currency: 'USD', type: 'expense' },
  // November 2024
  { label: 'November_2024',  description: 'Stella Pangilinan - Developer',         amount_usd: 400.00, currency: 'USD', type: 'expense' },
  { label: 'November_2024',  description: 'Hubspot',                                amount_usd: 20.00,  currency: 'USD', type: 'expense' },
  { label: 'November_2024',  description: 'Google Workspace',                       amount_usd: 12.00,  currency: 'USD', type: 'expense' },
  // December 2024
  { label: 'December_2024',  description: 'Stella Pangilinan - Developer',         amount_usd: 400.00, currency: 'USD', type: 'expense' },
  { label: 'December_2024',  description: 'Google Workspace',                       amount_usd: 12.00,  currency: 'USD', type: 'expense' },
]

const allNewTxns = [...investments2024, ...expenses2024]

let inserted = 0
for (const txn of allNewTxns) {
  const pid = periodIds[txn.label]
  if (!pid) { console.warn(`No period ID for ${txn.label}, skipping`); continue }

  // Check duplicate
  const dup = await client.query(
    `SELECT id FROM bank_transactions WHERE period_id = $1 AND description = $2 AND amount_usd = $3`,
    [pid, txn.description, txn.amount_usd]
  )
  if (dup.rows.length > 0) {
    console.log(`  SKIP (exists): ${txn.label} | ${txn.description} | $${txn.amount_usd}`)
    continue
  }

  await client.query(
    `INSERT INTO bank_transactions (period_id, description, amount_usd, currency, type) VALUES ($1, $2, $3, $4, $5)`,
    [pid, txn.description, txn.amount_usd, txn.currency, txn.type]
  )
  console.log(`  INSERTED: ${txn.label} | ${txn.type} | ${txn.description} | $${txn.amount_usd}`)
  inserted++
}
console.log(`\nInserted ${inserted} new 2024 transactions`)

// ── 5. Re-tag Rene's 2025 transactions from revenue → investment ──────────────
const reneIds = [236, 261, 112]
const retagRes = await client.query(
  `UPDATE bank_transactions SET type = 'investment' WHERE id = ANY($1) RETURNING id, description, amount_usd, type`,
  [reneIds]
)
console.log(`\nRe-tagged ${retagRes.rows.length} Rene 2025 transactions to investment:`)
retagRes.rows.forEach(r => console.log(`  id=${r.id} | ${r.description} | $${r.amount_usd}`))

// ── 6. Delete duplicate transaction ID 309 ────────────────────────────────────
const delRes = await client.query(`DELETE FROM bank_transactions WHERE id = 309 RETURNING id, description`)
console.log(`\nDeleted duplicate: ${delRes.rows.length > 0 ? JSON.stringify(delRes.rows[0]) : 'not found (may already be gone)'}`)

// ── 7. Verify totals ──────────────────────────────────────────────────────────
const totals = await client.query(`
  SELECT type, COUNT(*) AS count, SUM(amount_usd)::numeric(12,2) AS total
  FROM bank_transactions
  GROUP BY type ORDER BY type
`)
console.log('\nTransaction totals by type:')
totals.rows.forEach(r => console.log(`  ${r.type}: ${r.count} txns, $${r.total}`))

const investTotal = await client.query(`
  SELECT COALESCE(SUM(amount_usd), 0)::numeric(12,2) AS total FROM bank_transactions WHERE type = 'investment'
`)
console.log(`\nTotal invested: $${investTotal.rows[0].total}`)

await client.end()
console.log('\nDone.')
