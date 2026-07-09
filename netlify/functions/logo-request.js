// PUBLIC standalone function: /logo-request/:token (client logo-upload page).
// Standalone like redirect.js/approve.js — no SPA, no auth, no chunk-rotation
// risk, works in WhatsApp's in-app browser.
import { getManualOrderByToken, fulfillLogoRequest, uploadLogo } from '../../backend/src/services/manualOrders.js'
import { renderLogoRequestPage } from '../../backend/src/services/logoRequestPage.js'

const NOT_FOUND = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h2>Link not found</h2><p>This link may have expired or is invalid.</p></body></html>`

export async function handler(event) {
  const parts = event.path.replace(/^\/logo-request\//, '').split('/')
  const token = parts[0]
  if (!token) return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: NOT_FOUND }

  // POST /logo-request/:token/submit — the customer's upload
  if (event.httpMethod === 'POST' && parts[1] === 'submit') {
    try {
      const order = await getManualOrderByToken(token)
      if (!order) return json(404, { error: 'Not found' })
      const { logo, businessName } = JSON.parse(event.body || '{}')
      if (!logo) return json(400, { error: 'logo required' })
      const logoUrl = await uploadLogo(order.row_slug, logo)
      await fulfillLogoRequest(token, { logoUrl, businessName })
      return json(200, { ok: true })
    } catch (err) {
      return json(400, { error: err.message })
    }
  }

  // GET /logo-request/:token — the page
  try {
    const order = await getManualOrderByToken(token)
    if (!order) return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: NOT_FOUND }
    const publicBase = process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      body: renderLogoRequestPage(order, publicBase),
    }
  } catch (err) {
    console.error('logo request page failed:', err.message)
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: NOT_FOUND }
  }
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
