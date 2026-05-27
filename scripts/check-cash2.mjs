import pg from 'pg'
const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_5szDEpgNd4tT@ep-twilight-dream-aob2e472-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
})
await client.connect()

// Show all revenue transactions with amounts
const rev = await client.query(`
  SELECT bt.id, bt.description, bt.amount, bt.currency, bt.amount_usd, bt.date, p.label
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.type = 'revenue'
  ORDER BY bt.date
`)
console.log(`\nAll REVENUE transactions (${rev.rows.length} total):`)
let totalRev = 0
rev.rows.forEach(r => {
  const usd = parseFloat(r.amount_usd)
  totalRev += usd
  console.log(`  id=${r.id} | ${String(r.date).split('T')[0]} | ${r.label} | ${r.description.substring(0,40)} | ${r.currency} ${r.amount} | USD ${usd.toFixed(2)}`)
})
console.log(`  TOTAL REVENUE: $${totalRev.toFixed(2)}`)

// Show PayPal/opening related
const special = await client.query(`
  SELECT id, description, amount_usd, currency, type, date FROM bank_transactions
  WHERE LOWER(description) LIKE '%paypal%' OR type IN ('opening')
  ORDER BY date
`)
console.log(`\nPayPal / opening transactions:`)
special.rows.forEach(r => console.log(`  id=${r.id} | ${r.type} | ${r.description} | $${r.amount_usd} ${r.currency}`))

await client.end()
