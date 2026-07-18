// PUBLIC standalone function: /setup/:orderNumber — the self-hosted onboarding
// front door. Standalone like redirect.js/approve.js/logo-request.js: no SPA,
// no auth, no chunk-rotation risk, works in WhatsApp's in-app browser.
// TWIN of backend/src/routes/setupPublic.js — keep the route surface in step.
// This is the file that runs in PRODUCTION (Gotcha #14's family).
import { getSetupState, submitSetup, submitSetupLogo } from '../../backend/src/services/setup.js'
import { renderSetupPage, renderSetupNotFound } from '../../backend/src/services/setupPage.js'

// Best-effort per-IP throttle (D1: the tokenless URL's only real abuse surface
// is enumeration, and there is no PII behind it — §4.0's constraint is also
// its mitigation). In-memory, so it only holds per warm container; that is
// fine for "slow a scraper", which is all it needs to do.
const hits = new Map()
function throttled(ip) {
  const now = Date.now()
  const rec = hits.get(ip)
  if (!rec || now > rec.reset) { hits.set(ip, { count: 1, reset: now + 5 * 60_000 }); return false }
  rec.count += 1
  return rec.count > 60
}

const HTML = { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

export async function handler(event) {
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown'
  if (throttled(ip)) return { statusCode: 429, headers: HTML, body: 'Too many requests — please try again in a few minutes.' }

  const parts = event.path.replace(/^\/setup\//, '').split('/')
  const orderNumber = parts[0]
  if (!orderNumber) return { statusCode: 404, headers: HTML, body: renderSetupNotFound() }

  if (event.httpMethod === 'POST' && parts[1] === 'submit') {
    try {
      const result = await submitSetup(orderNumber, JSON.parse(event.body || '{}'))
      return json(200, result)
    } catch (err) {
      return json(err.status || 400, { error: err.message })
    }
  }

  if (event.httpMethod === 'POST' && parts[1] === 'logo') {
    try {
      const result = await submitSetupLogo(orderNumber, JSON.parse(event.body || '{}'))
      return json(200, result)
    } catch (err) {
      return json(err.status || 400, { error: err.message })
    }
  }

  try {
    const state = await getSetupState(orderNumber)
    if (!state) return { statusCode: 404, headers: HTML, body: renderSetupNotFound() }
    const publicBase = process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'
    return { statusCode: 200, headers: HTML, body: renderSetupPage(state, publicBase) }
  } catch (err) {
    console.error('setup page failed:', err.message)
    return { statusCode: 500, headers: HTML, body: renderSetupNotFound() }
  }
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
