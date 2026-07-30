import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { query } from '@/lib/db'
import { google } from 'googleapis'
import { cachedSheet } from '@/lib/sheets-cache'
import { namesMatch } from '@/lib/name-match'

const INVOICE_SHEET_ID = '1qYn8BxBfSNsYMAXeqN84dsoxIbd7pszglt4YDbsJO2k'

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

function parseNum(val: any): number {
  if (!val) return 0
  return parseFloat(val.toString().replace(/[$,\s]/g, '')) || 0
}

async function fetchSheetInvoices() {
  const sheets = getSheetsClient()
  const rows = await cachedSheet('invoice-sheet', async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: INVOICE_SHEET_ID,
      range: 'All time!A2:I500',
    })
    return res.data.values || []
  })

  return rows
    .map((r: any[]) => ({
      invoice_id:        (r[0] || '').trim(),
      vendor:            (r[1] || '').trim(),
      description:       (r[2] || '').trim(),
      notes:             (r[3] || '').trim(),
      issue_date:        (r[4] || '').trim(),
      amount_usd:        parseNum(r[5]),
      status:            (r[6] || '').trim(),
      billing_type:      (r[7] || 'annual').trim(),
      sheet_client_name: (r[8] || '').trim(),  // Col I: Client Name
    }))
    .filter((r: any) => r.invoice_id && r.amount_usd > 0)
}

// GET /api/clients/invoices?clientId=X  — invoices matched by client name from the sheet
// GET /api/clients/invoices              — all sheet invoices
export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(req.url).searchParams.get('clientId')
  const sheetInvoices = await fetchSheetInvoices()

  if (!clientId) {
    return NextResponse.json({ invoices: sheetInvoices })
  }

  // Fetch client name + holding company info + sibling count in one query
  const clientRes = await query(`
    SELECT c.name, hc.name AS holding_company_name,
           (SELECT COUNT(*) FROM clients c2
            WHERE c2.holding_company_id = c.holding_company_id
              AND c2.active = TRUE
              AND c.holding_company_id IS NOT NULL) AS sibling_count
    FROM clients c
    LEFT JOIN holding_companies hc ON hc.id = c.holding_company_id
    WHERE c.id = $1
  `, [clientId])

  if (!clientRes.rows[0]) return NextResponse.json({ invoices: [] })

  const client       = clientRes.rows[0]
  const siblingCount = parseInt(client.sibling_count || 0) || 1

  const invoices = sheetInvoices
    .filter((inv: any) => {
      const invName = inv.sheet_client_name || inv.vendor || ''
      return namesMatch(invName, client.name) || (client.holding_company_name && namesMatch(invName, client.holding_company_name))
    })
    .map((inv: any) => {
      const invName        = inv.sheet_client_name || inv.vendor || ''
      const isHoldingSplit = client.holding_company_name && namesMatch(invName, client.holding_company_name) && !namesMatch(invName, client.name)
      return {
        ...inv,
        original_amount_usd: inv.amount_usd,
        amount_usd:          isHoldingSplit ? inv.amount_usd / siblingCount : inv.amount_usd,
        is_holding_split:    isHoldingSplit || false,
      }
    })

  return NextResponse.json({ invoices })
}
