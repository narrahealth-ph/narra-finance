import { google } from 'googleapis'

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  return google.drive({ version: 'v3', auth })
}

// List all month folders inside the root invoices folder
// Folder names like: January_2026, February_2026, etc.
export async function listMonthFolders() {
  const drive = getDriveClient()
  const res = await drive.files.list({
    q: `'${process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
  })
  return res.data.files || []
}

// List all invoice files inside a specific month folder
export async function listInvoiceFiles(monthFolderId: string) {
  const drive = getDriveClient()
  const res = await drive.files.list({
    q: `'${monthFolderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, size, webViewLink)',
  })
  return res.data.files || []
}

// Download a file as base64 (for sending to Claude)
export async function downloadFileAsBase64(fileId: string, mimeType: string) {
  const drive = getDriveClient()

  // Google Docs/Sheets need export; PDFs and images download directly
  if (mimeType === 'application/pdf') {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    )
    const buffer = Buffer.from(res.data as ArrayBuffer)
    return { base64: buffer.toString('base64'), mimeType: 'application/pdf' }
  }

  if (mimeType.startsWith('image/')) {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    )
    const buffer = Buffer.from(res.data as ArrayBuffer)
    return { base64: buffer.toString('base64'), mimeType }
  }

  // For other types, try direct download
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  )
  const buffer = Buffer.from(res.data as ArrayBuffer)
  return { base64: buffer.toString('base64'), mimeType: 'application/octet-stream' }
}

// Find a specific month folder by name e.g. "January_2026"
// Lists all folders and matches client-side to avoid Drive API exact-match quirks
export async function findMonthFolder(monthLabel: string) {
  const folders = await listMonthFolders()
  // Exact match first, then case-insensitive fallback
  return (
    folders.find(f => f.name === monthLabel) ||
    folders.find(f => f.name?.toLowerCase() === monthLabel.toLowerCase()) ||
    null
  )
}
