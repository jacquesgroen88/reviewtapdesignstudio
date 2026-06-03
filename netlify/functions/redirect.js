import { getQRCode, incrementScanCount } from '../../backend/src/services/database.js'

const NOT_FOUND_HTML = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h2>QR code not found</h2><p>This link may have been removed or is invalid.</p></body></html>`

const ERROR_HTML = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h2>Temporary issue</h2><p>Please try scanning again in a moment.</p></body></html>`

// /r/:code → 302 redirect to the stored destination.
export async function handler(event) {
  const code = event.path.replace(/^\/r\//, '').split('/')[0]
  if (!code) return { statusCode: 400, body: 'Missing code' }

  let qr
  try {
    // Guard against a slow/paused DB hanging the scanner — fail fast instead.
    qr = await Promise.race([
      getQRCode(code),
      new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout')), 5000)),
    ])
  } catch (err) {
    console.error('redirect lookup failed:', err.message)
    return { statusCode: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '2' }, body: ERROR_HTML }
  }

  if (!qr) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: NOT_FOUND_HTML }
  }

  // Count the scan without blocking the redirect
  incrementScanCount(qr.id).catch(console.error)

  return {
    statusCode: 302,
    headers: {
      Location: qr.destination,
      // Cache the redirect briefly so repeat scans are instant and resilient
      // to DB hiccups. Destination edits propagate within this window.
      'Cache-Control': 'public, max-age=300',
    },
    body: '',
  }
}
