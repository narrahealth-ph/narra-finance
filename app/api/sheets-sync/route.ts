import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { google } from 'googleapis'

const SPREADSHEET_ID = '1057EJCsrTPT7LFHBYqsqYVVERuwgZ7kScmHy8j1Or8s'
const SHEET_NAME = '🟩 MRR'

const MONTH_TO_COL: Record<string, string> = {
  'January_2025': 'E',   'February_2025': 'F',  'March_2025': 'G',    'April_2025': 'H',
  'May_2025': 'I',       'June_2025': 'J',       'July_2025': 'K',     'August_2025': 'L',
  'September_2025': 'M', 'October_2025': 'N',    'November_2025': 'O', 'December_2025': 'P',
  'January_2026': 'Y',   'February_2026': 'Z',   'March_2026': 'AA',   'April_2026': 'AB',
  'May_2026': 'AC',      'June_2026': 'AD',      'July_2026': 'AE',    'August_2026': 'AF',
  'September_2026': 'AG','October_2026': 'AH',   'November_2026': 'AI','December_2026': 'AJ',
}

const CLIENT_ROWS: Record<string, number> = {
  'OFII': 4, 'KLLP': 5, 'KALP': 6, 'KLAS': 7, 'RIB / KLMSI-UK': 8,
  'MBG': 11, 'Peralta Vet': 12, 'New Alabang Vet': 15,
  'RAYOMAR': 17, 'KRBS': 18, 'OMI': 19, 'KMSM': 21,
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { monthLabel, clients, costs } = await req.json()
  const col = MONTH_TO_COL[monthLabel]
  if (!col) {
    console.error(
      `[sheets-sync] No column mapping found.\n` +
      `  monthLabel received: "${monthLabel}"\n` +
      `  valid keys: ${Object.keys(MONTH_TO_COL).join(', ')}`
    )
    return NextResponse.json({ error: `No column mapping for "${monthLabel}". Valid keys: ${Object.keys(MONTH_TO_COL).join(', ')}` }, { status: 400 })
  }

  try {
    const sheets = getSheetsClient()
    const totalMrr   = clients.reduce((s: number, c: any) => s + Math.round(c.annualAmount / 12), 0)
    const totalCosts = costs.reduce((s: number, c: any) => s + c.amount, 0)
    const netRevenue = totalMrr - totalCosts

    // Wrap sheet name in single quotes to handle emoji/spaces
    const cell = (row: number) => `'${SHEET_NAME}'!${col}${row}`
    const data: { range: string; values: any[][] }[] = []

    // Total MRR
    data.push({ range: cell(3), values: [[totalMrr]] })

    // Clients
    for (const client of clients) {
      const row = CLIENT_ROWS[client.name]
      if (row) data.push({ range: cell(row), values: [[Math.round(client.annualAmount / 12)]] })
    }

    // Costs
    const payroll   = costs.find((c: any) => c.name === 'Payroll')?.amount || 0
    const subs      = costs.find((c: any) => c.name === 'Subscriptions')?.amount || 0
    const marketing = costs.find((c: any) => c.name === 'Sleek+Marketing')?.amount || 0
    data.push({ range: cell(29), values: [[payroll]]   })
    data.push({ range: cell(30), values: [[subs]]      })
    data.push({ range: cell(31), values: [[marketing]] })

    // Net revenue
    data.push({ range: cell(37), values: [[netRevenue]] })

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data },
    })

    return NextResponse.json({ success: true, updated: data.length, col, monthLabel })
  } catch (err: any) {
    console.error('Sheets sync error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
