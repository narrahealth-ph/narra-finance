import pg from 'pg'
const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_5szDEpgNd4tT@ep-twilight-dream-aob2e472-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
})
await client.connect()

// Fix 1: Currency Exchange GBP→USD (these are FX conversions, not revenue)
const fxFix = await client.query(
  `UPDATE bank_transactions SET type = 'fx' WHERE id IN (343, 344, 345) RETURNING id, description, amount_usd`
)
console.log('Re-tagged Currency Exchange to fx:', fxFix.rows)

// Fix 2: Canva* tagged as revenue (it's an expense)
const canvaFix = await client.query(
  `UPDATE bank_transactions SET type = 'expense' WHERE id = 326 RETURNING id, description, amount_usd`
)
console.log('Re-tagged Canva* to expense:', canvaFix.rows)

// Fix 3: PLNTSCALE* TEMP HOLD tagged as revenue (likely an expense/hold)
const plntFix = await client.query(
  `UPDATE bank_transactions SET type = 'expense' WHERE id = 324 RETURNING id, description, amount_usd`
)
console.log('Re-tagged PLNTSCALE TEMP HOLD to expense:', plntFix.rows)

// Show new calculated cash position
const res = await client.query(`
  SELECT
    COALESCE(SUM(CASE WHEN type = 'opening'    THEN amount_usd ELSE 0 END), 0) +
    COALESCE(SUM(CASE WHEN type = 'revenue'    THEN amount_usd ELSE 0 END), 0) +
    COALESCE(SUM(CASE WHEN type = 'investment' THEN amount_usd ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN type = 'expense'    THEN amount_usd ELSE 0 END), 0) AS cash_position,
    COALESCE(SUM(CASE WHEN type = 'revenue'    THEN amount_usd ELSE 0 END), 0) AS revenue,
    COALESCE(SUM(CASE WHEN type = 'expense'    THEN amount_usd ELSE 0 END), 0) AS expenses
  FROM bank_transactions
`)
const r = res.rows[0]
console.log(`\nUpdated totals:`)
console.log(`  Revenue:   $${parseFloat(r.revenue).toFixed(2)}`)
console.log(`  Expenses:  $${parseFloat(r.expenses).toFixed(2)}`)
console.log(`  Cash pos:  $${parseFloat(r.cash_position).toFixed(2)}`)

await client.end()
