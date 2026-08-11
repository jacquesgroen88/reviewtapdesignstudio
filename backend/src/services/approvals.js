// Client-approval records (Feature F). One approval = one link covering one
// or more designs (stand + card together). Items live as JSONB:
// [{ design_id, name, product_id, variant_id, mockups: [storagePath,...],
//    snapshot: {assets:[...]}, response: null|'approved'|'changes',
//    responded_at, comment }]
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

const BUCKET = 'approval-mockups'

export function mockupPublicUrl(path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

// dataURL → storage; returns the storage path
export async function uploadMockup(path, dataUrl) {
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('invalid mockup data')
  const buffer = Buffer.from(base64, 'base64')
  const { error } = await getClient().storage.from(BUCKET)
    .upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (error) throw error
  return path
}

export async function createApproval(row) {
  const { data, error } = await getClient().from('approvals').insert(row).select().single()
  if (error) throw error
  return data
}

export async function getApproval(token) {
  const { data } = await getClient().from('approvals').select('*').eq('token', token).maybeSingle()
  return data
}

export async function markViewed(token) {
  await getClient().from('approvals')
    .update({ viewed_at: new Date().toISOString() })
    .eq('token', token).is('viewed_at', null)
}

export async function updateApprovalItems(token, items) {
  const { error } = await getClient().from('approvals').update({ items }).eq('token', token)
  if (error) throw error
}

// A new send (or a design edit) invalidates older open links for those designs.
//
// Runs entirely in Postgres via supersede_approvals_for_designs(). This used to
// `.select('token, items')` across every open approval and do the matching in JS,
// which dragged the full canvas snapshots over the wire on EVERY design save and
// delete: 86 MB across 129 rows as of 2026-08-11, and growing with each send.
// That is what took the database down on 11 Aug (statement timeouts, 190s
// checkpoints, every QR redirect 503 for ~2h) while Diane iterated on one design.
//
// Same rule as approvalSummaryByDesign below: never widen a projection on this
// table to include items. Fetch the ONE approval you need by token (getApproval).
//
// Errors now throw rather than being swallowed. The old code destructured `data`
// without checking `error`, so a failure here silently left stale links live.
export async function supersedeForDesigns(designIds, { exceptToken } = {}) {
  if (!designIds?.length) return 0
  const { data, error } = await getClient().rpc('supersede_approvals_for_designs', {
    p_design_ids: designIds,
    p_except_token: exceptToken ?? null,
  })
  if (error) throw error
  return data ?? 0
}

// design_id → latest approval summary, for order-card chips.
//
// Uses the approval_summary_by_design() RPC rather than selecting the rows here.
// This used to `.select('... , items')`, and items carries every design's full
// canvas snapshot (the version lock): 46 MB across 77 approvals, one row 5.4 MB,
// dragged over the wire on EVERY Orders tab switch and search to build an ~8 KB
// map, then discarded. Measured 12.9s — by far the biggest cost on the page.
// The RPC does the same flattening inside Postgres: ~0.1s, ~85 small rows.
//
// If you ever need the snapshot, fetch the ONE approval you need by token
// (getApproval). Never widen this projection — that's how the 46 MB happened.
export async function approvalSummaryByDesign() {
  const { data, error } = await getClient().rpc('approval_summary_by_design')
  if (error) throw error
  const map = {}
  for (const r of data ?? []) {
    // RPC returns sent_at DESC, so the first row per design is the latest.
    if (!r.design_id || map[r.design_id]) continue
    map[r.design_id] = {
      token: r.token,
      sent_at: r.sent_at,
      viewed_at: r.viewed_at,
      superseded: !!r.superseded,
      response: r.response || null,
      responded_at: r.responded_at || null,
      comment: r.comment || null,
    }
  }
  return map
}

// For the scheduled reminder: open, unanswered, sent >48h ago, not reminded.
//
// Same defect as supersedeForDesigns had: `.select('*')` includes items, so this
// pulled every matching approval's canvas snapshots into the function just to
// test `.some(i => !i.response)`. It runs @daily (netlify/functions/approval-chase.js),
// so it was a scheduled repeat of the query that caused the 11 Aug outage.
//
// approvals_awaiting_response() does the unanswered test in Postgres and returns
// only the four columns approval-chase actually reads. Verified against live data
// on 2026-08-11: 13 rows, identical set to the old JS filter.
export async function listChaseCandidates() {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data, error } = await getClient()
    .rpc('approvals_awaiting_response', { p_cutoff: cutoff })
  if (error) throw error
  return data ?? []
}

export async function markReminded(token) {
  await getClient().from('approvals')
    .update({ reminded_at: new Date().toISOString() }).eq('token', token)
}

// Record a client's response and automate the order status:
// every design approved → pending_print; any changes requested → pending.
import { setOrderStatus } from './database.js'
import { logActivity } from './activityLog.js'
import { orderLabel } from '../lib/orderNumber.js'

export async function handleApprovalResponse(token, designId, response, comment) {
  if (!['approved', 'changes'].includes(response)) throw new Error('invalid response')
  const approval = await getApproval(token)
  if (!approval) return null
  if (approval.superseded_at) return { superseded: true }

  const items = (approval.items || []).map(i => {
    if (i.design_id !== designId || i.response) return i   // first response wins
    return { ...i, response, responded_at: new Date().toISOString(), comment: comment || null }
  })
  await updateApprovalItems(token, items)

  // Client action — no team session, actor identified by the approval's own
  // client_name (this is the only source of "who" for a public, no-login page).
  logActivity({
    actorType: 'client', actorLabel: approval.client_name || null,
    action: response === 'approved' ? 'approval.approved' : 'approval.changesRequested',
    targetType: 'order', targetId: approval.owner_slug || token,
    targetLabel: orderLabel(approval.client_name, approval.order_number),
    metadata: { comment: comment || null, designId },
  })

  if (approval.owner_slug) {
    const anyChanges = items.some(i => i.response === 'changes')
    const allApproved = items.length > 0 && items.every(i => i.response === 'approved')
    if (anyChanges)       await setOrderStatus(approval.owner_slug, 'pending', `Client requested changes: ${comment || ''}`.trim())
    else if (allApproved) await setOrderStatus(approval.owner_slug, 'pending_print', 'Client approved via approval link')
  }
  return { ok: true }
}
