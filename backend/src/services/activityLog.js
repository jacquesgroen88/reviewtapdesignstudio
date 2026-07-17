// Audit trail: who did what, when — team actions (design created, status
// changed, QR made, team invited...) and client actions (logo uploaded,
// design approved/changes requested). Written from route handlers and from
// shared services that both the local-dev and public-page Netlify functions
// call through (see CLAUDE.md Gotcha #14 — putting the write here instead of
// in the route files means it's automatically covered on both entry points).
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

let _client = null
function getClient() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set')
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  })
  return _client
}

// Never let a logging failure break the action it's logging — swallow and
// console.error, same discipline as the other fire-and-forget side effects
// in this codebase (e.g. setOrderStatus(...).catch(() => {})).
export async function logActivity({ actorType, actorId = null, actorLabel = null, action, targetType = null, targetId = null, targetLabel = null, metadata = null }) {
  try {
    const { error } = await getClient().from('activity_log').insert({
      actor_type: actorType, actor_id: actorId, actor_label: actorLabel,
      action, target_type: targetType, target_id: targetId, target_label: targetLabel,
      metadata,
    })
    if (error) throw error
  } catch (err) {
    console.error('activity log write failed:', err.message)
  }
}

export async function listActivity({ limit = 50, before = null } = {}) {
  let query = getClient().from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

// Contact events, newest first. These are the only actions that mean a client
// was actually reached (or that we tried to reach them). `link_created` is
// deliberately NOT here — minting a link contacts nobody, and treating it as
// contact is exactly what caused duplicate follow-ups. See the 2026-07-17 spec.
export const CONTACT_ACTIONS = [
  'approval.sent', 'logoRequest.sent',        // real sends via GHL
  'approval.shared', 'logoRequest.shared',    // shared outside the system (intent)
  'order.follow_up_logged',                   // phoned/emailed, recorded by hand
]

// Everything that happened to ONE order, newest first.
// Two sources, because design events target the DESIGN, not the order:
//   1. target_type='order' AND target_id=<rowSlug>
//   2. target_type='design' AND metadata->>'ownerSlug'=<rowSlug>
// Both are covered by the (target_type, target_id) index / a metadata filter.
// Design rows before 2026-07-17 were backfilled; designs never linked to an
// order (owner_slug null) correctly never appear on any card.
export async function listActivityForOrder(rowSlug, { limit = 100 } = {}) {
  const client = getClient()
  const [ownRes, designRes] = await Promise.all([
    client.from('activity_log').select('*')
      .eq('target_type', 'order').eq('target_id', rowSlug)
      .order('created_at', { ascending: false }).limit(limit),
    client.from('activity_log').select('*')
      .eq('target_type', 'design').eq('metadata->>ownerSlug', rowSlug)
      .order('created_at', { ascending: false }).limit(limit),
  ])
  if (ownRes.error) throw ownRes.error
  if (designRes.error) throw designRes.error

  return [...(ownRes.data ?? []), ...(designRes.data ?? [])]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
}

// Most recent contact event per order, for the "Last contacted" line and the
// Awaiting-client sort. ONE grouped read for every order rather than N calls —
// the Orders list already does a full in-memory scan for any non-'all' filter,
// so this joins that pass instead of adding a request per card.
// Is this row PROOF we tried to reach the client, or only that a link exists?
//
// Before 2026-07-17, `approval.sent` / `logoRequest.sent` were written when the
// link was minted, so a pre-rename row proves nothing was sent. After the
// rename those actions are only ever written by the send-ghl handlers, which
// always stamp `via: 'ghl'` — so the presence of `via` cleanly separates the
// two eras with no date arithmetic. Ambiguous rows still surface (they carry a
// real timestamp worth seeing) but are flagged so the UI never claims contact
// that may not have happened. Claiming contact falsely is the exact failure
// this whole feature exists to kill.
function isConfirmedContact(r) {
  if (r.action === 'order.follow_up_logged') return true   // a human states it happened
  if (r.action.endsWith('.shared')) return true            // intent: WhatsApp/copy actually opened
  return !!r.metadata?.via                                 // a real GHL send
}

export async function getLastContactBySlug() {
  const { data, error } = await getClient()
    .from('activity_log')
    .select('target_id, action, actor_label, created_at, metadata')
    .eq('target_type', 'order')
    .in('action', CONTACT_ACTIONS)
    .order('created_at', { ascending: false })
  if (error) throw error
  const map = {}
  // Rows arrive newest-first, so the first sighting of a slug is its latest.
  for (const r of data ?? []) {
    if (!map[r.target_id]) {
      map[r.target_id] = {
        at: r.created_at,
        by: r.actor_label,
        action: r.action,
        channel: r.metadata?.channel || r.metadata?.via || null,
        confirmed: isConfirmedContact(r),
        // Did it go through GHL, or someone's personal phone? Drives the
        // "outside the system" marker and the leak review (~mid-Aug 2026).
        viaSystem: r.metadata?.via === 'ghl',
      }
    }
  }
  return map
}
