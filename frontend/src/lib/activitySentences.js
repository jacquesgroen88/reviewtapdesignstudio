// Shared rendering vocabulary for activity entries, used by BOTH the global
// /activity feed (ActivityPanel) and the per-order timeline (OrderHistory).
// It lives here so the two cannot drift into describing the same event
// differently — the whole point of the history is that everyone reads the same
// story off the same row.
//
// Entries arrive in two shapes: the /activity feed returns raw DB columns
// (actor_type, actor_label, created_at) while /api/orders/:slug/history returns
// a camelCase projection (actorType, actorLabel, at). normalizeEntry() flattens
// both so the sentence map never has to care which endpoint it came from.

const STATUS_TEXT = {
  pending: 'Pending', ready: 'Ready', pending_approval: 'Pending Approval',
  pending_print: 'Approved', at_printer: 'Print Pending', done: 'Done', skipped: 'Skipped',
}

const CHANNEL_TEXT = { whatsapp: 'their own WhatsApp', copy: 'a copied link' }

const FIELD_TEXT = { company_name: 'name', whatsapp: 'WhatsApp', order_number: 'order #' }

// action → sentence fragment (goes after the actor's name). Keep these terse —
// the row already carries the target label and a timestamp.
//
// Wording rules, learned the hard way (see the 2026-07-17 spec):
//  - "sent" means the CLIENT WAS ACTUALLY MESSAGED. Nothing else may claim it.
//  - `*.link_created` = a link was minted and the share modal opened. That
//    contacts nobody. Historic rows (before 2026-07-17) were logged under the
//    old `*.sent` names for this same non-event, so those keys are kept below
//    and phrased with the ambiguity made explicit rather than rewritten away.
//  - `*.shared` = opened WhatsApp / copied the link. Proves INTENT, not
//    delivery: the sender can still close WhatsApp or edit the message.
//  - GHL "sent" means GHL accepted the workflow enrolment, not that WhatsApp
//    delivered it (board ab092). Never render it as "delivered".
export const SENTENCES = {
  'design.created':            e => `created a design for ${e.targetLabel || 'an order'}`,
  'design.updated':            e => `updated the design for ${e.targetLabel || 'an order'}`,
  'design.deleted':            e => `deleted a design for ${e.targetLabel || 'an order'}`,
  'design.duplicated':         e => `duplicated a design for ${e.targetLabel || 'an order'}`,
  'order.status_changed':      e => `changed ${e.targetLabel || 'an order'} to ${STATUS_TEXT[e.metadata?.to] || e.metadata?.to || 'another status'}`,
  'manualOrder.created':       e => `added a manual order for ${e.targetLabel || 'a client'}`,
  'manualOrder.updated':       e => `updated the order for ${e.targetLabel || 'a client'}`,
  'manualOrder.deleted':       e => `deleted the manual order for ${e.targetLabel || 'a client'}`,
  'qr.created':                e => `created QR code "${e.targetLabel || e.targetId}"`,
  'qr.updated':                e => `updated QR code "${e.targetLabel || e.targetId}"`,
  'qr.archived':               e => `archived QR code "${e.targetLabel || e.targetId}"`,
  'qr.deleted':                e => `permanently deleted QR code "${e.targetLabel || e.targetId}"`,
  'team.invited':              e => `invited ${e.targetLabel} to the team${e.metadata?.role === 'admin' ? ' as admin' : ''}`,
  'team.removed':              e => `removed ${e.targetLabel || 'a team member'} from the team`,
  'approval.approved':         () => 'approved their design',
  'approval.changesRequested': e => `requested changes${e.metadata?.comment ? `: "${e.metadata.comment}"` : ''}`,
  'logo.uploaded':             () => 'uploaded their logo',
  'setup.submitted':           e => `completed order setup${e.metadata?.destinations > 1 ? ` for ${e.metadata.destinations} businesses` : ''}${e.metadata?.mismatch ? ' (allocation doesn\'t match the order — check quantities)' : ''}`,

  // Link minted, nobody contacted yet.
  'approval.link_created':     e => `created an approval link for ${e.targetLabel || 'a client'}`,
  'logoRequest.link_created':  e => `created a logo-request link for ${e.targetLabel || 'a client'}`,

  // Real sends, through the Reviewtap System.
  'approval.sent':             e => e.metadata?.via === 'ghl'
    ? `sent the approval to ${e.targetLabel || 'the client'} via the Reviewtap System`
    // Pre-17-Jul rows used this action for mere link creation. Say so rather
    // than assert a send that may never have happened.
    : `created an approval link for ${e.targetLabel || 'a client'} (may not have been sent)`,
  'logoRequest.sent':          e => e.metadata?.via === 'ghl'
    ? `sent the logo request to ${e.targetLabel || 'the client'} via the Reviewtap System`
    : `created a logo-request link for ${e.targetLabel || 'a client'} (may not have been sent)`,

  // Shared outside the system. Intent, not delivery.
  'approval.shared':           e => `opened ${CHANNEL_TEXT[e.metadata?.channel] || 'a share'} to send the approval, outside the Reviewtap System`,
  'logoRequest.shared':        e => `opened ${CHANNEL_TEXT[e.metadata?.channel] || 'a share'} to send the logo request, outside the Reviewtap System`,

  'order.follow_up_logged':    e => `logged a follow-up${e.metadata?.text ? `: "${e.metadata.text}"` : ''}`,

  // Bulk fill of customer details from a Shopify CSV export.
  'orders.imported':           e => `imported customer details from Shopify (${e.metadata?.updated || 0} filled${e.metadata?.created ? `, ${e.metadata.created} added` : ''})`,

  // Client details feed the WhatsApp greeting and the GHL contact name, so a
  // change to them is worth seeing in the history.
  'order.details_corrected':   e => `corrected the client details for ${e.targetLabel || 'an order'}${e.metadata?.fields?.length ? ` (${e.metadata.fields.map(f => FIELD_TEXT[f] || f).join(', ')})` : ''}`,
  'order.details_reverted':    e => `reverted ${e.targetLabel || 'an order'} to the customer's original details`,
}

// Actions that mean a client was actually reached, or that we tried to reach
// them. Mirrors CONTACT_ACTIONS in backend/src/services/activityLog.js — keep
// the two in step. `*.link_created` is deliberately absent: minting a link
// contacts nobody, and treating it as contact is what caused duplicate chases.
export const CONTACT_ACTIONS = new Set([
  'approval.sent', 'logoRequest.sent',
  'approval.shared', 'logoRequest.shared',
  'order.follow_up_logged',
])

// Events that happened OUTSIDE GHL, i.e. on someone's personal phone. Rendered
// with a quiet marker so the leak is visible at a glance.
export const OUTSIDE_SYSTEM_ACTIONS = new Set(['approval.shared', 'logoRequest.shared'])

// Accepts either endpoint's shape (see file header).
export function normalizeEntry(e) {
  return {
    id: e.id,
    at: e.at || e.created_at,
    actorType: e.actorType || e.actor_type,
    actorLabel: e.actorLabel || e.actor_label,
    action: e.action,
    targetLabel: e.targetLabel ?? e.target_label,
    targetId: e.targetId ?? e.target_id,
    metadata: e.metadata,
  }
}

export function sentenceFor(entry) {
  const e = normalizeEntry(entry)
  const fn = SENTENCES[e.action]
  return fn ? fn(e) : e.action
}

export function actorNameFor(entry) {
  const e = normalizeEntry(entry)
  return e.actorLabel || (e.actorType === 'client' ? 'A client' : 'Someone')
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

export const fullTimestamp = iso => new Date(iso).toLocaleString('en-ZA')
