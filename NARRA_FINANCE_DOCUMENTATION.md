# Narra Finance — Complete Documentation

**Narra Health PTE. LTD. · Singapore**  
*Internal use only — Finance Team & Founders*

---

## Table of Contents

1. [What This App Is](#1-what-this-app-is)
2. [How It Was Built](#2-how-it-was-built)
3. [How It Works (Technical Overview)](#3-how-it-works-technical-overview)
4. [Getting Started](#4-getting-started)
5. [The Dashboard — All Tabs Explained](#5-the-dashboard--all-tabs-explained)
   - Clients
   - Bank Import
   - Revenue (MRR)
   - Invoices
   - Reconciliation
   - Adjustments
   - Reports
   - Cash Flow
   - AI Insights
   - Investor View
   - How to Use
6. [Month-End Close Process](#6-month-end-close-process)
7. [Multi-Currency Support](#7-multi-currency-support)
8. [Roles & Access](#8-roles--access)
9. [Google Sheets Integration](#9-google-sheets-integration)
10. [Data & Security](#10-data--security)
11. [Environment Variables](#11-environment-variables)
12. [Frequently Asked Questions](#12-frequently-asked-questions)

---

## 1. What This App Is

Narra Finance is a custom-built financial management platform for Narra Health. It replaces spreadsheet-based bookkeeping with a structured, month-by-month workflow that covers:

- **Bank statement import and categorisation** — Upload your Wise/DBS/PayPal statements and have transactions automatically sorted into revenue, expenses, and FX conversions.
- **Invoice management** — Expense invoices are pulled automatically from Google Drive, and Claude AI extracts the vendor, amount, and account code.
- **Reconciliation** — Bank transactions are matched to invoices using a confidence scoring system. AI can assist with more complex matches.
- **MRR tracking** — Monthly Recurring Revenue is calculated in real time from your Google Sheets invoice tracker, broken down by client, billing type, and payment status.
- **Financial reports** — P&L, General Ledger, and Balance Sheet are generated automatically for every month.
- **Investor dashboard** — A clean, read-only view showing ARR, runway, cash position, and top clients.
- **AI insights** — Monthly investor narratives, anomaly detection, and churn risk assessment powered by Claude.

---

## 2. How It Was Built

### Technology Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 14 (React 18, App Router) |
| **Language** | TypeScript |
| **Database** | PostgreSQL (hosted on Neon — serverless) |
| **AI** | Anthropic Claude (claude-sonnet) |
| **Styling** | Tailwind CSS |
| **Charts** | Recharts |
| **Google APIs** | googleapis npm package (Sheets + Drive) |
| **Auth** | JWT tokens in httpOnly cookies |
| **Hosting** | Vercel (auto-deploys from GitHub on push to `main`) |

### Architecture

The app is a **full-stack Next.js application** — the same codebase handles both the frontend React UI and the backend API routes. There is no separate server.

```
Browser (React UI)
      ↕  HTTP
Next.js API Routes (/app/api/*)
      ↕  SQL
PostgreSQL (Neon)
      ↕  HTTP
External Services (Claude API, Google Sheets/Drive, ExchangeRate API)
```

All API routes live under `/app/api/`. They run server-side on Vercel as serverless functions. The frontend components fetch from these routes using standard `fetch()` calls.

### Database

The database is a **PostgreSQL** instance on [Neon](https://neon.tech), a serverless Postgres provider. It connects via a standard connection string using the `pg` npm package. The schema is initialised using the migration script at `lib/db-migrate.js`.

### AI Integration

The app uses **Claude** (Anthropic) in several places:
- Extracting data from invoice PDFs (vendor, amount, date, account code)
- Parsing bank statement PDFs into structured transactions
- Performing AI-assisted reconciliation (matching invoices to bank deposits)
- Writing investor narratives
- Detecting unusual spending patterns
- Assessing client churn risk

### Deployment

Every push to the `main` branch on GitHub automatically deploys to Vercel. The app is live within about 60 seconds of a push. Environment variables (database URL, API keys, passwords) are stored in Vercel's environment settings and in `.env.local` for local development.

---

## 3. How It Works (Technical Overview)

### Periods

Everything in the app is organised around **periods** — one period = one calendar month (e.g., `April_2026`). When you select a month in the dropdown, the app creates or retrieves the period from the database. All transactions, invoices, MRR entries, manual adjustments, and reports are linked to a period ID.

Periods can be **locked** after month-end close. Once locked, no data can be added, edited, or deleted for that month (all API endpoints return 403).

### Data Flow

```
1. You select a month (e.g., April 2026)
   → Period is created/retrieved from DB

2. You import the bank statement (PDF or CSV)
   → Claude (or CSV parser) extracts transactions
   → Transactions saved to bank_transactions table
   → Auto-reconciliation runs immediately (scores transactions against invoices)

3. Invoices sync from Google Drive
   → Claude extracts vendor, amount, date, account code from each PDF
   → Saved to invoices table
   → Auto-reconciliation runs again

4. You review matches in Reconciliation tab
   → Approve good matches, decline bad ones
   → Use AI-assist for complex cases (distributor payments, partial matches)

5. MRR is calculated from Google Sheets invoice tracker
   → Active contracts counted for the month
   → Client breakdown shown in Revenue tab

6. Reports are generated automatically
   → P&L, GL, and Balance Sheet pull from all tables for the period

7. Month-end close
   → Approve reconciliation → Push MRR to Sheets → Lock period
```

### MRR Calculation

MRR is calculated directly from your Google Invoice Sheet ("All time" tab). For each active invoice:

- **Annual contract**: Amount ÷ 12 per month (active while `issue date ≤ month end` AND `issue date + 12 months > month start`)
- **Quarterly**: Amount ÷ 3 per month
- **Monthly**: Full amount per month
- **One-off**: Full amount only in the month it was issued

Deduplication is by invoice ID (or client + date + amount if no ID). A client can have multiple active invoices counted simultaneously.

### Cash Position

The cash position shown in the Investor View is calculated as:

```
Opening Balance + Client Revenue + Founder Investments − Expenses
```

All non-USD amounts are converted to USD using exchange rates fetched from exchangerate-api.com (cached in the database to avoid repeated API calls).

### Balance Sheet

The Balance Sheet is assembled from multiple sources:

| Line item | Source |
|---|---|
| Cash | Sum of `bank_transactions` by account |
| Accounts Receivable | Unpaid invoices from Google Sheets |
| Prepayments | Amortised schedules in `prepayment_schedules` table |
| Fixed Assets / Intangibles | Manual entries |
| Accounts Payable | Unmatched expense invoices |
| Deferred Revenue | Paid contracts with future delivery (calculated from billing type) |
| Director Accounts / Loans | Manual entries |
| Share Capital | Manual entry (default SGD 2.10) |
| Retained Earnings | Cumulative P&L from all prior periods |

---

## 4. Getting Started

### Logging In

1. Go to the app URL
2. Enter your `@narrahealth.co` email address
3. Enter the shared finance password
4. You will be redirected to the dashboard

The investor login uses a separate password and gives read-only access to the Investor View only.

Sessions last **7 days**. After that you will be prompted to log in again.

### Selecting a Month

The month and year selectors are in the top navigation bar. Changing either one reloads all data for the selected period. You can navigate freely between months — historical data is always available.

### Navigation

The tabs are shown across the top of the page (below the month selector on desktop). Tap or click any tab to switch views. The selected tab is highlighted.

---

## 5. The Dashboard — All Tabs Explained

---

### Clients

**Purpose:** Manage your client and holding company list. This master list is used throughout the app — in reconciliation (tagging revenue to a client), in reports, and in the investor dashboard.

**What you can do:**
- Add a new client (name, holding company, billing type, distributor flag, notes)
- Create holding companies (e.g., K Line Group, which has KLLP, KLAS, KALP as clients)
- Mark a client as inactive
- View total lifetime revenue per client
- See how much cash has been received per client from bank imports
- Sync the client list to Google Sheets

**Key concepts:**
- **Holding company**: A parent entity that groups related clients. Used in reports and distributor payment splits.
- **Distributor flag**: Marks clients like Lawina who pay on behalf of sub-clients.

---

### Bank Import

**Purpose:** Import your bank statements so the app knows what money actually came in and went out.

**What you can do:**
- Upload a PDF bank statement (Wise, DBS, PayPal)
- Upload a CSV file
- Upload a PayPal screenshot (Claude reads the image)
- Review parsed transactions before saving
- Edit transaction type (revenue / expense / fx / investment) before saving
- Save transactions to the database

**How PDF parsing works:**
Claude reads the PDF and extracts each transaction — date, description, amount, currency, and its best guess at the type (revenue vs. expense vs. FX conversion). You review the results before saving.

**Transaction types:**
| Type | Meaning |
|---|---|
| `revenue` | Money received from a client |
| `expense` | Money paid out (salaries, subscriptions, tools) |
| `fx` | Currency conversion within your own accounts |
| `investment` | Founder capital deposited |
| `opening` | Starting balance for an account |

**Tips:**
- Import all accounts for a month (USD, SGD, PayPal) before reconciling
- The app detects duplicates — re-importing a statement will not create double entries
- After saving, auto-reconciliation runs automatically

---

### Revenue (MRR)

**Purpose:** Track your Monthly Recurring Revenue from signed contracts, see which clients are active, and review the payment pipeline.

**What you can do:**
- View MRR history chart (last 12–18 months)
- See the current month's MRR breakdown by client
- See pending (invoiced but not yet paid) contracts
- See the pipeline (upcoming renewals, new contracts)
- View year totals (MRR, costs, net)
- Push the month's MRR snapshot to Google Sheets

**Data source:** MRR is calculated live from the "All time" tab of your Google Invoice Sheet. It does NOT rely on the database for the calculation — it reads the sheet every time you open the page.

**Billing types handled:**
- Annual (e.g., $36,000/year → $3,000/month)
- Quarterly (e.g., $9,000/quarter → $3,000/month)
- Monthly (e.g., $3,000/month)
- One-off (counted in the month issued, not recurring)

**Client breakdown:** Click on a month in the chart to see a detailed per-client breakdown for that month, including whether they are a new client, a carryover from a prior year, or pending payment.

---

### Invoices

**Purpose:** Manage expense invoices (bills from vendors) that have been uploaded to Google Drive.

**What you can do:**
- Sync invoices from your Google Drive month folder
- Review AI-extracted details (vendor, date, amount, account code)
- Edit any extracted field manually
- See which invoices have been matched to bank transactions
- Delete invoices that are duplicates or errors

**How it works:**
1. You upload invoice PDFs to Google Drive in the correct month folder (e.g., `April_2026`)
2. Click "Sync from Drive" in the app
3. Claude reads each PDF and extracts: vendor name, invoice date, amount, currency, and account code
4. Invoices are saved to the database
5. Auto-reconciliation immediately tries to match each invoice to a bank transaction

**Account codes used:**
| Code | Category |
|---|---|
| 411 | Professional Fees |
| 417 | Freight |
| 426 | Subscriptions |
| 427 | General Expenses |
| 452 | Bank Fees |
| 525 | FX Gains/Losses |
| Payroll | Salaries |

---

### Reconciliation

**Purpose:** Match bank transactions to invoices and confirm that all money in and out is accounted for.

**Views:**
- **Month view** (default): See the current selected month's transactions
- **Year view**: See all transactions for the full year — useful for bulk-tagging revenue to clients

**Tabs within reconciliation:**

#### Costs Breakdown
Shows all expense transactions grouped by account code. Expand any group to see individual line items. You can:
- See which expenses have a matching invoice
- Re-categorise an invoice to a different account code
- Delete a transaction (e.g., to remove a duplicate)

#### Matches
Shows all matched pairs (bank transaction ↔ invoice).
- **Confirmed matches** (green): Auto-matched with high confidence — no action needed
- **Proposed matches** (amber): AI suggested a match but confidence is medium — you must approve or decline
- **Flagged matches** (red): A match was found but the amounts differ by more than 5% — verify before approving

Click ✕ to unmatch any pair.

#### Unmatched
Shows transactions that couldn't be automatically matched.

For **revenue rows** (blue):
- Use the **Tag client** dropdown to say which client this payment came from
- Enter an invoice ID to link the payment to a specific invoice
- Use **⊕ Split** if one bank deposit covers multiple clients

For **expense rows** (amber):
- Select the matching invoice from the dropdown
- Use **⊕ Split** if one payment covered multiple invoices
- Click **✓ I see it** to mark as manually reviewed (dismisses without needing an invoice)

#### Year View
Switch to "Year" in the top-right toggle to see all transactions for the entire selected year. This is especially useful for:
- Tagging all client revenue payments at once
- Reviewing which expenses are uncategorised
- Getting an overview before month-end close

---

### Adjustments

**Purpose:** Record balance sheet items that don't come from bank statements or invoices — things like director loans, taxes owed, fixed assets, and share capital.

**What you can adjust:**
| Account | What it covers |
|---|---|
| Fixed Assets | Equipment, hardware, physical assets |
| Intangibles | Software licences, IP, development costs |
| Director Account (Mike) | Amounts owed to / from Mike |
| Director Account (Rene) | Amounts owed to / from Rene |
| Director Account (Karina) | Amounts owed to / from Karina |
| Loans Payable | Any external loans |
| Founder Investment (Mike) | Capital contributed (off-bank) |
| Founder Investment (Rene) | Capital contributed (off-bank) |
| Tax Provision | Estimated taxes owed |
| GST Payable | GST collected and owed to IRAS |
| Share Capital | Issued share capital (default SGD 2.10) |

**Prepayment schedules:**
Add annual software licences or other prepaid expenses as a schedule (e.g., $12,000 annual Slack licence starting Jan 2026). The app automatically amortises the monthly portion into each period's balance sheet.

**Convert to equity:** Move the sum of all director accounts to share capital in one click (used at year-end or when directors convert loans to equity).

---

### Reports

**Purpose:** View your Profit & Loss, General Ledger, and Balance Sheet for the selected month.

**P&L (Profit & Loss):**
- Revenue: Total MRR for the period
- Expenses: Sum of all bank expense transactions and invoices, grouped by account code
- Net Profit / (Loss)
- Operating Margin %

**General Ledger:**
- Detailed line-by-line listing of all transactions
- Revenue entries, expense entries, bank opening/closing balances
- Useful for accounting or audit purposes

**Balance Sheet:**
- Assets (current + non-current)
- Liabilities (current + non-current)
- Equity (share capital + retained earnings + current P&L)
- Balance check: Assets should equal Liabilities + Equity (tolerance < $0.01)

**FX Rates:**
- Shows the exchange rates used for currency conversions this period
- Rates are fetched from exchangerate-api.com and cached

**Export:** All reports can be exported to CSV using the download button.

---

### Cash Flow

**Purpose:** See annual cash performance — all months in a single view, side by side.

**What it shows:**
- Monthly revenue, expenses, and net for the full year
- Year-over-year comparison (2024, 2025, 2026)
- Total MRR tracked vs. cash actually received
- Closing cash balance for the year

Useful for board presentations, investor updates, and year-end planning.

---

### AI Insights

**Purpose:** Generate AI-powered analysis using Claude.

**Three types:**

#### Monthly Investor Narrative
Claude writes a 3-paragraph CFO-style summary of the month:
- Headline performance (revenue, MRR, growth)
- Key expense movements and what drove them
- Outlook: risks, opportunities, what to watch

#### Anomaly Detection
Claude reviews all expense transactions and flags anything unusual:
- New vendors not seen before
- Amounts significantly higher than prior months
- Potential duplicate payments
- Unexpected categories

#### Churn Risk Assessment
Claude reviews client payment history and flags:
- Clients who are late to renew
- Clients whose payment amounts have dropped
- Contracts expiring in the next 90 days

**Note:** AI insights are cached. Click "Regenerate" to get a fresh analysis using the latest data.

---

### Investor View

**Purpose:** A clean, read-only dashboard designed to be shared with investors or founders who want a high-level view of the business.

**What it shows:**
- **Total Raised**: $60,000 founder investment (hardcoded, reflects actual commitment)
- **Total Revenue Earned**: All-time client revenue collected through the bank (excludes founder investments)
- **Revenue Recovery**: How much of the invested capital has been recovered through revenue (shown as a percentage bar)
- **Avg Monthly Revenue**: Average of the last 3 months' client deposits
- **Annual Run Rate (ARR)**: Avg monthly revenue × 12
- **Avg Monthly Spend**: Average of the last 3 months' expenses
- **Runway**: How many months the company can operate at the current burn rate (Cash ÷ Avg Monthly Spend)
- **Revenue vs Monthly Spend chart**: 18-month bar chart of actual cash in vs. cash out
- **Paying Clients**: List of active clients with their share of total MRR
- **Cash Position**: Current balance (opening + revenue + investments − expenses)

**Data coverage banner:** Shows whether all recent bank statements are imported. Amber warning if any of the last 3 months are missing.

---

### How to Use

In-app instructions panel with step-by-step guides for each feature. Refer here first if you're unsure how to complete a task.

---

## 6. Month-End Close Process

Run through this checklist at the end of each month before starting the next one.

### Step 1 — Import Bank Statements
- Import all accounts: USD, SGD, and PayPal (if applicable)
- Review and confirm all transactions are correctly categorised
- Tag all revenue transactions to clients in the Reconciliation → Unmatched tab

### Step 2 — Sync Invoices
- Upload all vendor invoices to Google Drive in the correct month folder
- Click "Sync from Drive" in the Invoices tab
- Review AI-extracted details and fix any errors

### Step 3 — Reconcile
- Go to the Reconciliation tab
- Review all **Proposed** matches — approve or decline each one
- Review all **Flagged** matches — verify amounts before approving
- Clear the Unmatched list — either match, acknowledge, or split each item
- Run AI-assist for any complex distributor or multi-client payments

### Step 4 — Review MRR
- Open the Revenue tab
- Confirm the MRR breakdown looks correct for the month
- Check for any pending (unpaid) invoices that should be chased

### Step 5 — Adjustments (if needed)
- Open the Adjustments tab
- Update any director account balances, tax provisions, or loan amounts
- Add any new prepayment schedules

### Step 6 — Review Reports
- Open the Reports tab
- Check that the P&L looks reasonable
- Verify the Balance Sheet balances (Assets = Liabilities + Equity)

### Step 7 — Close the Month
- Click the **Close Month** button (top right)
- The Financial Close Wizard will guide you through:
  1. Approve reconciliation
  2. Save MRR snapshot
  3. Push MRR to Google Sheets
  4. Lock the period (prevents further edits)

Once locked, a padlock icon appears next to the month label. To unlock, use the lock button in the period header (finance team only).

---

## 7. Multi-Currency Support

The app handles transactions in USD, SGD, PHP, EUR, and GBP. Every transaction is stored in both its original currency and its USD equivalent.

**How conversion works:**
1. When a transaction is saved, the app fetches the exchange rate for that date from exchangerate-api.com
2. The rate is cached in the database (so the same rate is used consistently for that date)
3. If the API is unavailable, fallback rates are used: SGD 0.74, PHP 0.017, EUR 1.08, GBP 1.27
4. All reports and totals are shown in USD

**FX transactions:** When you convert currency within Wise (e.g., selling GBP to buy USD), this shows as an FX transaction type and is excluded from revenue and expense totals. It does not affect the cash position calculation.

---

## 8. Roles & Access

| Role | Access |
|---|---|
| **Finance** | Full access — import, edit, reconcile, close months, manage clients, view all reports |
| **Investor** | Read-only access to the Investor View dashboard only |

Both roles use email + password login. The finance password and investor password are different. Sessions last 7 days.

Domain restriction: Only `@narrahealth.co` email addresses can log in.

---

## 9. Google Sheets Integration

The app reads from and writes to two Google Sheets using a service account.

### Invoice Sheet (source of truth for MRR)
**Sheet ID:** `1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k`  
**Tab:** "All time"

This is your master invoice tracker. The app reads rows 2–500 and uses the following columns:

| Column | Field |
|---|---|
| A | Invoice ID |
| B | Client Name |
| E | Issue Date |
| F | Amount |
| G | Status (Fully paid / Sent / Outstanding / Due) |
| H | Billing Type (Annual / Quarterly / Monthly / One-off) |

The MRR calculation runs directly from this sheet — no manual sync needed.

### MRR Tracking Sheet (receives pushed data)
**Sheet ID:** `1057EJCsrTPT7LFHBYqsqYVVERuwgZ7kScmHy8j1Or8s`  
**Tab:** "🟩 MRR"

After month-end close, the app writes the approved MRR snapshot to this sheet. Rows are clients (OFII, KLLP, KALP, KLAS, RIB, MBG, PERALTA, NAVC, RAYOMAR, KRBS, OMI, KMSM). Columns are months (Jan 2025 onwards).

### Google Drive
The app reads from your Drive to fetch invoice PDFs. The root folder ID is stored in the environment variables. Month subfolders must be named exactly: `January_2026`, `February_2026`, etc.

---

## 10. Data & Security

### Audit Trail
Every data change in the app is recorded in an immutable `audit_log` table:
- Who made the change (email)
- What changed (old value → new value)
- When it happened
- Which record was affected

This cannot be edited or deleted. It provides a full history for accounting and compliance purposes.

### Period Locking
Once a month is closed (locked), no data can be added, modified, or deleted for that period. This ensures reports are stable after close. Only finance team members can lock or unlock periods.

### Clear / Reset
The "Clear Period" button (top right) allows selective deletion of data within a period:
- **Bank** — deletes all bank transactions
- **Invoices** — deletes all expense invoices
- **MRR** — deletes synced MRR entries
- **Reconciliation** — deletes the reconciliation session
- **Entries** — deletes manual balance sheet entries
- **AI** — deletes cached AI insights
- **All** — deletes everything for the period

Use with caution. Cleared data cannot be recovered (you would need to re-import).

### Database
Data is stored in a Neon PostgreSQL database. Neon provides:
- Automatic backups
- Point-in-time recovery
- Encryption at rest and in transit
- Serverless scaling

### Authentication
- Passwords are not stored — only validated against the environment variable
- Session tokens (JWT) are stored in httpOnly cookies (not accessible to JavaScript)
- All API routes require authentication; unauthenticated requests return 401

---

## 11. Environment Variables

These must be set both in Vercel (production) and in `.env.local` (local development):

```
POSTGRES_URL                   PostgreSQL connection string (from Neon dashboard)
JWT_SECRET                     Any random string used to sign session tokens
FINANCE_PASSWORD               Shared password for the finance team
INVESTOR_PASSWORD              Separate read-only password for investors
ANTHROPIC_API_KEY              Claude API key (from console.anthropic.com)
GOOGLE_SERVICE_ACCOUNT_EMAIL   Service account email (from Google Cloud Console)
GOOGLE_PRIVATE_KEY             Private key (copy exactly, with \\n for newlines)
GOOGLE_DRIVE_ROOT_FOLDER_ID    ID of the top-level Drive folder for invoices
EXCHANGERATE_API_KEY           API key from exchangerate-api.com
```

---

## 12. Frequently Asked Questions

**Q: I imported the wrong bank statement — how do I undo it?**  
A: Go to the Reconciliation tab, open Costs Breakdown, expand the relevant group, and delete individual transactions using the ✕ button. Or use Clear Period → Bank to delete all bank transactions for the month and re-import.

**Q: The cash position looks wrong. What could cause this?**  
A: The most common reasons are: (1) a recent month's bank statement hasn't been imported yet, (2) some transactions are tagged with the wrong type (e.g., a founder deposit tagged as revenue), or (3) FX conversion transactions are being included. Check the Reconciliation → Unmatched tab to see if anything looks out of place.

**Q: The MRR number looks wrong. Where does it come from?**  
A: MRR is calculated live from your Google Invoice Sheet. Check the "All time" tab — make sure all invoices have the correct status (Fully paid / Sent / etc.), billing type (Annual / Monthly / etc.), and issue date. Any invoice with a blank or incorrect status will be excluded.

**Q: Can I edit a locked month?**  
A: Yes — unlock the period first using the padlock button at the top. Make your changes, then lock it again. All changes are recorded in the audit log.

**Q: How do I add a client that pays through a distributor (like Lawina)?**  
A: Add the end client normally (e.g., "Orient Freight International Inc") in the Clients tab. In the Reconciliation → Unmatched tab, when the Lawina payment arrives, use the Split function to divide it into the individual client amounts and tag each one.

**Q: What happens if I push MRR to Google Sheets twice?**  
A: The write is idempotent for the same period — it overwrites the same cell positions. No duplicate data is created.

**Q: The Balance Sheet doesn't balance. What should I check?**  
A: Most common causes: (1) Director account entries are missing or incorrect in the Adjustments tab, (2) A manual entry was set to an unexpected value, (3) Bank data for the month is incomplete. The Reports tab shows a balance check — if it's off by a small rounding amount that's usually FX conversion.

**Q: How do I add a new month for 2026 that isn't in the dropdown?**  
A: The year list is generated automatically up to "current year + 1". If you're in 2026, 2027 should already be available. If a year is missing, it means the dropdown range needs updating in `app/finance/page.tsx` (the `YEARS` constant).

**Q: Can two people use the app at the same time?**  
A: Yes. There are no user-level locks — only period-level locks (which prevent edits to closed months). If two people edit the same open month simultaneously, the last write wins. Communicate within your team when doing month-end work.

**Q: Where are the actual invoice PDFs stored?**  
A: In Google Drive, in the root folder specified in the environment variables. The app reads from Drive but does not store PDFs in the database — only the extracted data (vendor, amount, etc.) is saved.

---

*Document prepared May 2026 · Narra Finance v1.0*  
*For questions, contact the development team.*
