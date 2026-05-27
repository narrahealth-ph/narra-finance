import pg from 'pg'
const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_5szDEpgNd4tT@ep-twilight-dream-aob2e472-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
})
await client.connect()

const res = await client.query(`
  SELECT
    COALESCE(SUM(CASE WHEN type = 'opening'    THEN amount_usd ELSE 0 END), 0) AS opening,
    COALESCE(SUM(CASE WHEN type = 'revenue'    THEN amount_usd ELSE 0 END), 0) AS revenue,
    COALESCE(SUM(CASE WHEN type = 'investment' THEN amount_usd ELSE 0 END), 0) AS investment,
    COALESCE(SUM(CASE WHEN type = 'expense'    THEN amount_usd ELSE 0 END), 0) AS expenses,
    COALESCE(SUM(CASE WHEN type = 'opening'    THEN amount_usd ELSE 0 END), 0) +
    COALESCE(SUM(CASE WHEN type = 'revenue'    THEN amount_usd ELSE 0 END), 0) +
    COALESCE(SUM(CASE WHEN type = 'investment' THEN amount_usd ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN type = 'expense'    THEN amount_usd ELSE 0 END), 0) AS cash_position
  FROM bank_transactions
`)
console.log('Cash breakdown:')
const r = res.rows[0]
console.log(`  Opening balance:  $${parseFloat(r.opening).toLocaleString()}`)
console.log(`  Revenue (client): $${parseFloat(r.revenue).toLocaleString()}`)
console.log(`  Investment:       $${parseFloat(r.investment).toLocaleString()}`)
console.log(`  Expenses:        -$${parseFloat(r.expenses).toLocaleString()}`)
console.log(`  ─────────────────────────────`)
console.log(`  Calculated total: $${parseFloat(r.cash_position).toLocaleString()}`)

// Show opening transactions
const opens = await client.query(`SELECT id, description, amount_usd, currency, date FROM bank_transactions WHERE type = 'opening' ORDER BY date`)
console.log('\nOpening transactions:')
opens.rows.forEach(r => console.log(`  id=${r.id} | ${r.description} | $${r.amount_usd} ${r.currency}`))

await client.end()
