// Run with: node lib/db-migrate.js
const { Pool } = require('pg')
require('dotenv').config({ path: '.env.local' })

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
})

async function migrate() {
  console.log('🔧 Running migrations...')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS periods (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,          -- e.g. "January_2026"
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT DEFAULT 'open',   -- open | reconciled | closed
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      period_id INTEGER REFERENCES periods(id),
      drive_file_id TEXT,
      drive_file_name TEXT,
      vendor TEXT,
      date DATE,
      amount NUMERIC(12,2),
      currency TEXT DEFAULT 'USD',
      amount_usd NUMERIC(12,2),
      account_code TEXT,
      account_name TEXT,
      status TEXT DEFAULT 'unmatched', -- unmatched | matched | flagged
      matched_bank_id INTEGER,
      ai_extracted BOOLEAN DEFAULT FALSE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
      id SERIAL PRIMARY KEY,
      period_id INTEGER REFERENCES periods(id),
      date DATE,
      description TEXT,
      amount NUMERIC(12,2),
      currency TEXT DEFAULT 'USD',
      amount_usd NUMERIC(12,2),
      type TEXT,                    -- expense | revenue | transfer | opening
      account TEXT,
      status TEXT DEFAULT 'unmatched',
      matched_invoice_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mrr_entries (
      id SERIAL PRIMARY KEY,
      period_id INTEGER REFERENCES periods(id),
      client_name TEXT NOT NULL,
      amount_usd NUMERIC(12,2),
      seats INTEGER,
      status TEXT DEFAULT 'active',  -- active | churned | new
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id SERIAL PRIMARY KEY,
      period_id INTEGER REFERENCES periods(id),
      type TEXT,                    -- narrative | anomalies | runway | churn
      content TEXT,
      generated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)
  console.log('✅ All tables created.')
  await pool.end()
}

migrate().catch(e => { console.error(e); process.exit(1) })
