import { google } from 'googleapis'
import { Readable } from 'stream'

let driveClient = null

function getDrive() {
  if (driveClient) return driveClient

  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!credentials) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set')
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })

  driveClient = google.drive({ version: 'v3', auth })
  return driveClient
}

export async function uploadToDrive(buffer, filename, orderNumber, businessName) {
  const drive = getDrive()

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID env var not set')

  // Optionally create a per-client subfolder
  const clientFolderId = await ensureSubfolder(drive, folderId, businessName)

  const stream = Readable.from(buffer)

  const response = await drive.files.create({
    requestBody: {
      name:    filename,
      parents: [clientFolderId || folderId],
      description: `Order: ${orderNumber} | Client: ${businessName}`,
    },
    media: {
      mimeType: 'image/tiff',
      body:     stream,
    },
    fields: 'id, name, webViewLink',
  })

  console.log(`Uploaded to Drive: ${response.data.name} (${response.data.id})`)
  return response.data.id
}

async function ensureSubfolder(drive, parentId, folderName) {
  // Look for existing folder with this name under parent
  const safe = folderName.replace(/[/\\?%*:|"<>]/g, '_')

  const list = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${safe}' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
  }).catch(() => ({ data: { files: [] } }))

  if (list.data.files?.length > 0) return list.data.files[0].id

  // Create it
  const folder = await drive.files.create({
    requestBody: {
      name:     safe,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parentId],
    },
    fields: 'id',
  })
  return folder.data.id
}
