import pg from 'pg'
const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_5szDEpgNd4tT@ep-twilight-dream-aob2e472-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
})
await client.connect()

// Show current state of these transactions
const check = await client.query(`
  SELECT bt.id, bt.date, bt.description, bt.amount, bt.currency, bt.amount_usd, bt.type, p.label AS period
  FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.id IN (121, 122, 123, 124)
  ORDER BY bt.id
`)
console.log('Current state of PayPal transactions:')
check.rows.forEach(r => console.log(`  id=${r.id} | date=${String(r.date).split('T')[0]} | period=${r.period} | ${r.description} | ${r.currency} ${r.amount} | type=${r.type}`))

// Fix: move each to its correct period based on actual transaction date
// id=121: Apr 17 2026 → April_2026
// id=122: Feb 3 2026  → February_2026
// id=123: Jan 21 2026 → January_2026
// id=124: Jan 20 2026 → January_2026

const corrections = [
  { id: 121, periodLabel: 'April_2026' },
  { id: 122, periodLabel: 'February_2026' },
  { id: 123, periodLabel: 'January_2026' },
  { id: 124, periodLabel: 'January_2026' },
]

for (const { id, periodLabel } of corrections) {
  const pRes = await client.query(`SELECT id FROM periods WHERE label = $1`, [periodLabel])
  if (!pRes.rows[0]) {
    console.log(`  Period ${periodLabel} not found — skipping id=${id}`)
    continue
  }
  const periodId = pRes.rows[0].id
  await client.query(`UPDATE bank_transactions SET period_id = $1 WHERE id = $2`, [periodId, id])
  console.log(`  Moved id=${id} → ${periodLabel} (period_id=${periodId})`)
}

// Show the Standard Chartered Bank transaction so user can identify it
console.log('\nStandard Chartered Bank transaction (id=331):')
const scb = await client.query(`
  SELECT bt.*, p.label AS period FROM bank_transactions bt
  JOIN periods p ON p.id = bt.period_id
  WHERE bt.id = 331
`)
scb.rows.forEach(r => console.log(JSON.stringify(r, null, 2)))

await client.end()
console.log('\nDone.')
