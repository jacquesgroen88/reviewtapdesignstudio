// PUBLIC standalone function: /approve/:token (client approval page).
// Standalone like redirect.js — no SPA, no auth, no chunk-rotation risk,
// OG tags render in WhatsApp link previews.
import { getApproval, markViewed, handleApprovalResponse } from '../../backend/src/services/approvals.js'
import { renderApprovalPage } from '../../backend/src/services/approvalPage.js'

const NOT_FOUND = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h2>Link not found</h2><p>This approval link may have expired or is invalid.</p></body></html>`

export async function handler(event) {
  const parts = event.path.replace(/^\/approve\//, '').split('/')
  const token = parts[0]
  if (!token) return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: NOT_FOUND }

  // POST /approve/:token/respond — record the client's answer
  if (event.httpMethod === 'POST' && parts[1] === 'respond') {
    try {
      const { designId, response, comment } = JSON.parse(event.body || '{}')
      const result = await handleApprovalResponse(token, designId, response, comment)
      if (!result) return json(404, { error: 'Not found' })
      if (result.superseded) return json(409, { error: 'superseded' })
      return json(200, result)
    } catch (err) {
      return json(400, { error: err.message })
    }
  }

  // GET /approve/:token — the page
  try {
    const approval = await getApproval(token)
    if (!approval) return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: NOT_FOUND }
    markViewed(token).catch(console.error)   // seen tracking, non-blocking
    const publicBase = process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      body: renderApprovalPage(approval, publicBase),
    }
  } catch (err) {
    console.error('approval page failed:', err.message)
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: NOT_FOUND }
  }
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
