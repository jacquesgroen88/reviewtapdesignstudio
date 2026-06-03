import { getQRCode, incrementScanCount } from '../../backend/src/services/database.js'

// Netlify Function for QR redirect — /r/:code
export async function handler(event) {
  const code = event.path.replace(/^\/r\//, '').split('/')[0]

  if (!code) {
    return { statusCode: 400, body: 'Missing code' }
  }

  const qr = await getQRCode(code)

  if (!qr) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html' },
      body: `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>QR code not found</h2><p>This link may have been removed or is invalid.</p>
      </body></html>`,
    }
  }

  incrementScanCount(qr.id).catch(console.error)

  return {
    statusCode: 302,
    headers: { Location: qr.destination },
    body: '',
  }
}
