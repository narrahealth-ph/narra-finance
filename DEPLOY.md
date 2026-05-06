# Narra Finance — Deployment Guide
## Complete step-by-step from zero to live

---

## WHAT YOU'LL NEED (all free or you already have it)
- A computer with internet
- Your Vercel account (hello@narrahealth.co)
- Your Claude API key
- Your Google Drive access
- About 45 minutes

---

## PHASE 1 — Install tools on your computer

### Step 1: Install Node.js
1. Go to https://nodejs.org
2. Click the big green "LTS" button to download
3. Open the downloaded file and click through the installer (just keep clicking Next)
4. When done, open Terminal (Mac: press Cmd+Space, type "Terminal", press Enter)
5. Type this and press Enter to confirm it worked:
   ```
   node --version
   ```
   You should see something like `v20.0.0`. If you do, ✅ move on.

### Step 2: Install Vercel CLI
In Terminal, paste this and press Enter:
```
npm install -g vercel
```
Wait for it to finish (takes ~30 seconds).

---

## PHASE 2 — Set up your project

### Step 3: Copy the project files
1. Download the `narra-finance` folder I gave you
2. Move it to your Desktop or Documents — somewhere easy to find
3. In Terminal, navigate to it:
   ```
   cd ~/Desktop/narra-finance
   ```
   (If you put it in Documents, use `cd ~/Documents/narra-finance` instead)

### Step 4: Install dependencies
In Terminal (still in the narra-finance folder), run:
```
npm install
```
This downloads all the libraries. Takes 1-2 minutes. You'll see a lot of text — that's normal.

---

## PHASE 3 — Set up your database (Neon Postgres on Vercel)

### Step 5: Create database in Vercel
1. Go to https://vercel.com and log in with hello@narrahealth.co
2. Click **"Storage"** in the left sidebar
3. Click **"Create Database"**
4. Choose **"Neon Serverless Postgres"** (it's free)
5. Name it: `narra-finance-db`
6. Choose region: **Singapore (sin1)** — closest to you
7. Click **"Create"**
8. On the next screen, click **"Connect to project"** OR just copy the `POSTGRES_URL` value shown — it looks like:
   `postgresql://neondb_owner:xxxxx@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

### Step 6: Add database URL to your local config
1. Open the file `.env.local` in the narra-finance folder (use TextEdit on Mac or Notepad on Windows)
2. Paste your `POSTGRES_URL` value after the `=` sign on the first line
3. Fill in your other values:
   ```
   POSTGRES_URL=postgresql://... (what you copied)
   FINANCE_PASSWORD=choose_a_strong_password_for_your_team
   INVESTOR_PASSWORD=choose_a_different_password_for_investors
   JWT_SECRET=any_long_random_text_like_narra2026financesecretkey999
   ANTHROPIC_API_KEY=sk-ant-... (your Claude API key)
   ```
4. Save the file

### Step 7: Create your database tables
In Terminal (in the narra-finance folder), run:
```
npm run db:push
```
You should see: `✅ All tables created.`

---

## PHASE 4 — Set up Google Drive access

### Step 8: Create Google Service Account
This lets the app read your Drive folders automatically.

1. Go to https://console.cloud.google.com
2. At the top, click the project dropdown → **"New Project"**
3. Name it `Narra Finance` → click **Create**
4. In the left menu: **APIs & Services → Library**
5. Search for **"Google Drive API"** → click it → click **"Enable"**
6. Go to **APIs & Services → Credentials**
7. Click **"+ Create Credentials" → "Service Account"**
8. Name: `narra-finance-reader` → click **Create and Continue** → click **Done**
9. Click on the service account you just created
10. Go to the **"Keys"** tab → **"Add Key" → "Create new key" → JSON** → click **Create**
11. A JSON file downloads — open it in TextEdit/Notepad
12. Copy the value of `"client_email"` (looks like `narra-finance-reader@narra-finance-xxx.iam.gserviceaccount.com`)
13. Copy the value of `"private_key"` (the long block starting with `-----BEGIN PRIVATE KEY-----`)

### Step 9: Add Google credentials to your config
In `.env.local`, fill in:
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=narra-finance-reader@...iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
```
⚠️ For the private key: keep it all on one line, replace actual newlines with `\n`

### Step 10: Share your Drive folder with the service account
1. Go to Google Drive
2. Navigate to: `1. Narra Confidential / Finance / Incoming Invoices & Receipts`
3. Right-click the **"Incoming Invoices & Receipts"** folder → **Share**
4. Paste the service account email from Step 12 above
5. Set permission to **"Viewer"**
6. Click **Share**

### Step 11: Get the folder ID
1. Open the **"Incoming Invoices & Receipts"** folder in Drive
2. Look at the URL in your browser — it looks like:
   `https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74`
3. Copy that last part: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74`
4. Add it to `.env.local`:
   ```
   GOOGLE_DRIVE_ROOT_FOLDER_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74
   ```

---

## PHASE 5 — Test locally

### Step 12: Run the app on your computer
In Terminal, run:
```
npm run dev
```
Open your browser and go to: http://localhost:3000

You should see the Narra login page! Try logging in with your finance password.
If it works, ✅ you're ready to deploy.

Press Ctrl+C in Terminal to stop the local server.

---

## PHASE 6 — Deploy to Vercel

### Step 13: Push to GitHub (Vercel deploys from GitHub)
In Terminal, run these one by one:
```
git init
git add .
git commit -m "Initial Narra Finance deploy"
```

Then:
1. Go to https://github.com and create a new repository called `narra-finance`
2. Make it **Private** ⚠️ (this contains financial code)
3. GitHub will show you commands — run the ones under "push an existing repository":
   ```
   git remote add origin https://github.com/YOUR_USERNAME/narra-finance.git
   git branch -M main
   git push -u origin main
   ```

### Step 14: Connect to Vercel
1. Go to https://vercel.com (logged in as hello@narrahealth.co)
2. Click **"Add New Project"**
3. Click **"Import Git Repository"**
4. Select your `narra-finance` repo
5. Click **"Deploy"**

### Step 15: Add environment variables to Vercel
After the first deploy (it will fail — that's OK, we need to add the env vars):
1. Go to your project in Vercel
2. Click **Settings → Environment Variables**
3. Add each variable from your `.env.local` file one by one:
   - `POSTGRES_URL`
   - `FINANCE_PASSWORD`
   - `INVESTOR_PASSWORD`
   - `JWT_SECRET`
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID`
4. After adding all of them, go to **Deployments** → click the three dots on the latest → **"Redeploy"**

### Step 16: Your app is live! 🎉
Vercel gives you a URL like: `https://narra-finance.vercel.app`

- **Finance team**: goes to the main URL, uses the FINANCE_PASSWORD
- **Investors**: goes to `https://narra-finance.vercel.app/investor`, uses the INVESTOR_PASSWORD

---

## USING THE APP

### Every month close:
1. Log in → select the month from the dropdown
2. **Invoices tab** → click "Refresh from Drive" → click "AI Extract All"
   → Claude reads every invoice and fills in vendor, amount, account
3. **Bank tab** → upload your Sleek/DBS CSV export
   → transactions are auto-matched to invoices
4. **Reconciliation tab** → see what's matched and what needs follow-up
   → export unmatched list as CSV to chase your team
5. **Reports tab** → download GL, Balance Sheet, P&L as CSV
6. **AI Insights tab** → generate investor narrative, check anomalies
7. **MRR tab** → update client MRR, export

---

## TROUBLESHOOTING

**"Cannot connect to database"** → Check POSTGRES_URL in Vercel env vars, make sure it has `?sslmode=require` at the end

**"Google Drive folder not found"** → Make sure the folder is named exactly `January_2026` (with underscore, capital M and Y)

**"Invoice extraction failed"** → The file might be a format Claude can't read (e.g. Excel .xlsx). Convert to PDF first.

**Something else broken?** → In Vercel dashboard → your project → Logs → you'll see the exact error

---

## QUESTIONS?
Message me anytime and I'll walk you through it step by step. 🚀
