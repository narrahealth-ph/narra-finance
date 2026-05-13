// Run with: node lib/db-migrate.js
const { Pool } = require('pg')
require('dotenv').config({ path: '.env.local' })

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
})

async function migrate() {
  console.log('🔧 Running migrations...')

  // ── Core tables ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS periods (
      id          SERIAL PRIMARY KEY,
      label       TEXT NOT NULL,
      start_date  DATE NOT NULL,
      end_date    DATE NOT NULL,
      status      TEXT DEFAULT 'open',     -- open | reconciled | closed
      locked      BOOLEAN DEFAULT FALSE,
      locked_at   TIMESTAMPTZ,
      locked_by   TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id                SERIAL PRIMARY KEY,
      period_id         INTEGER REFERENCES periods(id),
      drive_file_id     TEXT,
      drive_file_name   TEXT,
      vendor            TEXT,
      date              DATE,
      amount            NUMERIC(12,2),
      currency          TEXT DEFAULT 'USD',
      amount_usd        NUMERIC(12,2),
      account_code      TEXT,
      account_name      TEXT,
      billing_type      TEXT DEFAULT 'monthly',
      status            TEXT DEFAULT 'unmatched', -- unmatched | matched | proposed | flagged
      matched_bank_id   INTEGER,
      ai_extracted      BOOLEAN DEFAULT FALSE,
      notes             TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
      id                  SERIAL PRIMARY KEY,
      period_id           INTEGER REFERENCES periods(id),
      date                DATE,
      description         TEXT,
      amount              NUMERIC(12,2),
      currency            TEXT DEFAULT 'USD',
      amount_usd          NUMERIC(12,2),
      type                TEXT,             -- expense | revenue | transfer | opening
      account             TEXT,
      status              TEXT DEFAULT 'unmatched', -- unmatched | matched | proposed | flagged
      matched_invoice_id  INTEGER,
      discrepancy_pct     NUMERIC(8,4),     -- % diff when flagged (>5%)
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mrr_entries (
      id            SERIAL PRIMARY KEY,
      period_id     INTEGER REFERENCES periods(id),
      client_name   TEXT NOT NULL,
      amount_usd    NUMERIC(12,2),
      billing_type  TEXT DEFAULT 'annual', -- annual | quarterly | monthly
      seats         INTEGER,
      status        TEXT DEFAULT 'active', -- active | churned | new
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id           SERIAL PRIMARY KEY,
      period_id    INTEGER REFERENCES periods(id),
      type         TEXT,                   -- narrative | anomalies | runway | churn
      content      TEXT,
      generated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Reconciliation sessions (AI-assisted reconcile workflow)
    CREATE TABLE IF NOT EXISTS reconciliation_sessions (
      id              SERIAL PRIMARY KEY,
      period_id       INTEGER REFERENCES periods(id),
      status          TEXT DEFAULT 'draft', -- draft | in_review | approved
      bank_json       JSONB DEFAULT '[]',
      expenses_json   JSONB DEFAULT '[]',
      matches_json    JSONB DEFAULT '[]',
      questions_json  JSONB DEFAULT '[]',
      mrr_snapshot    JSONB DEFAULT '{}',
      notes           TEXT DEFAULT '',
      approved_at     TIMESTAMPTZ,
      pushed_to_sheet BOOLEAN DEFAULT FALSE,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- FX rate cache (to/from USD, per date)
    CREATE TABLE IF NOT EXISTS fx_rates (
      id            SERIAL PRIMARY KEY,
      date          DATE NOT NULL,
      from_currency TEXT NOT NULL,
      rate          NUMERIC(14,8) NOT NULL, -- 1 unit of from_currency = rate USD
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(date, from_currency)
    );

    -- Immutable audit trail for every data mutation
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      table_name  TEXT NOT NULL,
      record_id   TEXT,
      action      TEXT NOT NULL,   -- insert | update | delete | lock | unlock | approve | push_to_sheet | reassign
      old_value   JSONB,
      new_value   JSONB,
      user_email  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    -- Manual entry fields for the Balance Sheet
    -- Covers: intangibles(670), fixed assets, director amounts(835/840/842),
    --         loans(851), investments(852/853), tax(860), GST, share capital(900)
    -- NOTE: 610 (Prepayments) is auto-calculated from prepayment_schedules below
    CREATE TABLE IF NOT EXISTS manual_entries (
      id           SERIAL PRIMARY KEY,
      period_id    INTEGER REFERENCES periods(id),
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      value        NUMERIC(14,2) DEFAULT 0,
      notes        TEXT,
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(period_id, account_code)
    );

    -- Prepayment amortization schedules (company-wide, not period-specific)
    -- Each row = one annual/multi-month service fee paid upfront and amortized monthly
    CREATE TABLE IF NOT EXISTS prepayment_schedules (
      id           SERIAL PRIMARY KEY,
      service_name TEXT NOT NULL,
      total_amount NUMERIC(14,2) NOT NULL,
      start_date   DATE NOT NULL,
      months       INTEGER NOT NULL DEFAULT 12,
      currency     TEXT DEFAULT 'USD',
      notes        TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // ── Additive ALTER TABLE — safe to run repeatedly ───────────────────────────
  await pool.query(`
    ALTER TABLE periods           ADD COLUMN IF NOT EXISTS locked        BOOLEAN DEFAULT FALSE;
    ALTER TABLE periods           ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ;
    ALTER TABLE periods           ADD COLUMN IF NOT EXISTS locked_by     TEXT;
    ALTER TABLE periods           ADD COLUMN IF NOT EXISTS approved_mrr  JSONB;
    ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS discrepancy_pct NUMERIC(8,4);
    ALTER TABLE invoices          ADD COLUMN IF NOT EXISTS billing_type  TEXT DEFAULT 'monthly';
    ALTER TABLE mrr_entries       ADD COLUMN IF NOT EXISTS billing_type  TEXT DEFAULT 'annual';
  `)

  console.log('✅ All tables created/updated.')
  await pool.end()
}

migrate().catch(e => { console.error(e); process.exit(1) })
