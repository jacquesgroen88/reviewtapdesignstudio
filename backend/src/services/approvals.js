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

// A new send (or a design edit) invalidates older open links for those designs
export async function supersedeForDesigns(designIds, { exceptToken } = {}) {
  if (!designIds?.length) return
  const { data } = await getClient().from('approvals')
    .select('token, items').is('superseded_at', null)
  const now = new Date().toISOString()
  for (const a of data ?? []) {
    if (exceptToken && a.token === exceptToken) continue
    const hits = (a.items || []).some(i => designIds.includes(i.design_id))
    if (hits) await getClient().from('approvals').update({ superseded_at: now }).eq('token', a.token)
  }
}

// design_id → latest approval summary, for order-card chips
export async function approvalSummaryByDesign() {
  const { data, error } = await getClient().from('approvals')
    .select('token, sent_at, viewed_at, superseded_at, items')
    .order('sent_at', { ascending: false })
  if (error) throw error
  const map = {}
  for (const a of data ?? []) {
    for (const item of a.items || []) {
      if (map[item.design_id]) continue   // newest first — keep the latest only
      map[item.design_id] = {
        token: a.token,
        sent_at: a.sent_at,
        viewed_at: a.viewed_at,
        superseded: !!a.superseded_at,
        response: item.response || null,
        responded_at: item.responded_at || null,
        comment: item.comment || null,
      }
    }
  }
  return map
}

// For the scheduled reminder: open, unseen-or-unanswered, sent >48h ago, not reminded
export async function listChaseCandidates() {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data, error } = await getClient().from('approvals')
    .select('*')
    .is('superseded_at', null)
    .is('reminded_at', null)
    .lt('sent_at', cutoff)
  if (error) throw error
  return (data ?? []).filter(a => (a.items || []).some(i => !i.response))
}

export async function markReminded(token) {
  await getClient().from('approvals')
    .update({ reminded_at: new Date().toISOString() }).eq('token', token)
}

// Record a client's response and automate the order status:
// every design approved → pending_print; any changes requested → pending.
import { setOrderStatus } from './database.js'

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

  if (approval.owner_slug) {
    const anyChanges = items.some(i => i.response === 'changes')
    const allApproved = items.length > 0 && items.every(i => i.response === 'approved')
    if (anyChanges)       await setOrderStatus(approval.owner_slug, 'pending', `Client requested changes: ${comment || ''}`.trim())
    else if (allApproved) await setOrderStatus(approval.owner_slug, 'pending_print', 'Client approved via approval link')
  }
  return { ok: true }
}
