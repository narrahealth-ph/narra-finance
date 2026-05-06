import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listMonthFolders, findMonthFolder, listInvoiceFiles, downloadFileAsBase64 } from '@/lib/drive'
import { extractInvoiceData } from '@/lib/ai'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'debug') {
    const key = process.env.GOOGLE_PRIVATE_KEY || 'NOT SET'
    return NextResponse.json({
      email:     process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'NOT SET',
      folder:    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID  || 'NOT SET',
      keyStart:  key.substring(0, 50),
      keyLength: key.length,
    })
  }

  if (action === 'folders') {
    try {
      const folders = await listMonthFolders()
      return NextResponse.json({ folders })
    } catch (err: any) {
      console.error('Drive folders error:', err.message)
      return NextResponse.json({ error: err.message, folders: [] }, { status: 500 })
    }
  }

  if (action === 'files') {
    const month = searchParams.get('month')
    if (!month) return NextResponse.json({ error: 'month required' }, { status: 400 })
    try {
      const folder = await findMonthFolder(month)
      if (!folder) return NextResponse.json({ files: [], folder: null })
      const files = await listInvoiceFiles(folder.id!)
      return NextResponse.json({ files, folder })
    } catch (err: any) {
      console.error('Drive files error:', err.message)
      return NextResponse.json({ error: err.message, files: [], folder: null }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const session = await requireRole('finance')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodId, fileId, fileName, mimeType } = await req.json()

  if (!fileId || !fileName) {
    return NextResponse.json({ status: 'error', error: 'fileId and fileName are required' }, { status: 400 })
  }

  try {
    // Check if already extracted
    const existing = await query(
      'SELECT id FROM invoices WHERE drive_file_id = $1',
      [fileId]
    )
    if (existing.rows.length > 0) {
      return NextResponse.json({ status: 'already_exists', id: existing.rows[0].id })
    }

    // Determine MIME type — default to PDF if unknown
    const resolvedMimeType = mimeType || 'application/pdf'

    console.log(`Downloading ${fileName} (${resolvedMimeType}) from Drive...`)

    // Download from Drive
    let base64: string
    let detectedType: string
    try {
      const result = await downloadFileAsBase64(fileId, resolvedMimeType)
      base64       = result.base64
      detectedType = result.mimeType
    } catch (err: any) {
      console.error(`Drive download failed for ${fileName}:`, err.message)
      return NextResponse.json({
        status: 'error',
        error: `Could not download file from Drive: ${err.message}. Make sure the Drive folder is shared with the service account.`
      })
    }

    if (!base64 || base64.length < 100) {
      return NextResponse.json({
        status: 'error',
        error: `File downloaded but appears empty (${base64?.length || 0} bytes). Check file permissions.`
      })
    }

    console.log(`Downloaded ${fileName} — ${base64.length} chars base64 — sending to Claude...`)

    // Extract with Claude
    let extracted: any
    try {
      extracted = await extractInvoiceData(base64, detectedType, fileName)
    } catch (err: any) {
      console.error(`Claude extraction failed for ${fileName}:`, err.message)
      return NextResponse.json({
        status: 'error',
        error: `AI extraction failed: ${err.message}`
      })
    }

    if (extracted.error) {
      console.error(`Extraction returned error for ${fileName}:`, extracted.error)
      return NextResponse.json({ status: 'error', error: extracted.error })
    }

    console.log(`Extracted from ${fileName}:`, JSON.stringify(extracted))

    // Validate extracted data
    if (!extracted.amount && extracted.amount !== 0) {
      return NextResponse.json({
        status: 'error',
        error: `Could not extract amount from ${fileName}. The file may be corrupted or not an invoice.`
      })
    }

    // Save to DB
    const result = await query(
      `INSERT INTO invoices
        (period_id, drive_file_id, drive_file_name, vendor, date, amount, currency, amount_usd,
         account_name, status, ai_extracted, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'unmatched',true,$10)
       RETURNING id`,
      [
        periodId,
        fileId,
        fileName,
        extracted.vendor         || 'Unknown',
        extracted.date           || new Date().toISOString().split('T')[0],
        extracted.amount         || 0,
        extracted.currency       || 'USD',
        extracted.amount         || 0,
        extracted.suggested_account || '427 - General Expenses',
        extracted.description    || '',
      ]
    )

    return NextResponse.json({
      status: 'extracted',
      id: result.rows[0].id,
      data: extracted
    })

  } catch (err: any) {
    console.error(`Unexpected error processing ${fileName}:`, err.message, err.stack)
    return NextResponse.json({
      status: 'error',
      error: `Unexpected error: ${err.message}`
    }, { status: 500 })
  }
}
