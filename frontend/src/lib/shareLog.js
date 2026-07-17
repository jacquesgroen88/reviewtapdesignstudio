import { apiFetch } from './api.js'

// Record that an approval / logo-request link was shared OUTSIDE the Reviewtap
// System — a wa.me click or a copied link.
//
// What this does and does not prove: clicking wa.me opens WhatsApp with a
// prefilled message. The sender can still edit it, send it to the wrong chat,
// or close WhatsApp without sending. So this is evidence of INTENT, never of
// delivery, and the UI says "opened WhatsApp to send", never "sent".
//
// Since GHL became the default send path (2026-07-17) this doubles as a leak
// signal: it tells us how often comms still bypass GHL onto a personal phone,
// and on which orders. Review the counts ~mid-Aug 2026 — heavy use is evidence
// of a real gap in the GHL path (most likely orders with no phone on file),
// not of anyone ignoring the decision.
//
// Deliberately fire-and-forget: logging is a side effect of sharing and must
// never block, delay, or fail the share itself. Unlike a user-facing action
// (Gotcha #12), there is nothing useful to tell the user if this fails — the
// share still happened — so it logs to console for us and stays silent to them.
export function logShare({ kind, token, channel }) {
  const base = kind === 'approval' ? '/api/approvals' : '/api/logo-requests'
  apiFetch(`${base}/${encodeURIComponent(token)}/shared`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  }).catch(err => console.error('share log failed:', err.message))
}
