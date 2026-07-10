// Orders entered by hand in the studio (not sourced from Formaloo) — e.g. a
// walk-in client or a one-off job with no Formaloo submission. Same row_slug
// shape as Formaloo orders so the existing status/designs/approvals joins
// (keyed by row_slug) work identically for both sources.
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { logActivity } from './activityLog.js'

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

const BUCKET = 'manual-order-logos'

export function logoPublicUrl(path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

export async function uploadLogo(rowSlug, dataUrl) {
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('invalid logo data')
  const buffer = Buffer.from(base64, 'base64')
  const ext = dataUrl.slice(5, dataUrl.indexOf(';')).split('/')[1] || 'png'
  const path = `${rowSlug}/logo.${ext}`
  const { error } = await getClient().storage.from(BUCKET)
    .upload(path, buffer, { contentType: `image/${ext}`, upsert: true })
  if (error) throw error
  return logoPublicUrl(path)
}

export async function listManualOrders() {
  const { data, error } = await getClient().from('manual_orders').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getManualOrder(rowSlug) {
  const { data } = await getClient().from('manual_orders').select('*').eq('row_slug', rowSlug).maybeSingle()
  return data
}

export async function createManualOrder(row) {
  const { data, error } = await getClient().from('manual_orders').insert(row).select().single()
  if (error) throw error
  return data
}

export async function updateManualOrder(rowSlug, fields) {
  const patch = { updated_at: new Date().toISOString() }
  const map = {
    orderNumber: 'order_number', companyName: 'company_name', logoUrl: 'logo_url',
    googleReviewUrl: 'google_review_url', whatsapp: 'whatsapp', email: 'email',
    phone: 'phone', address: 'address', orderedStand: 'ordered_stand', orderedCard: 'ordered_card',
  }
  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) patch[col] = fields[key]
  }
  const { data, error } = await getClient().from('manual_orders').update(patch).eq('row_slug', rowSlug).select().single()
  if (error) throw error
  return data
}

export async function deleteManualOrder(rowSlug) {
  await getClient().from('manual_orders').delete().eq('row_slug', rowSlug)
}

// Logo-request link: let the customer upload their own logo + confirm the
// exact business name (as it appears on Google) instead of Jacques chasing
// them for it, or guessing the name from an order confirmation (Feature J).
export async function setLogoRequestToken(rowSlug, token) {
  const { data, error } = await getClient().from('manual_orders')
    .update({ request_token: token, request_sent_at: new Date().toISOString() })
    .eq('row_slug', rowSlug).select().single()
  if (error) throw error
  return data
}

export async function getManualOrderByToken(token) {
  const { data } = await getClient().from('manual_orders').select('*').eq('request_token', token).maybeSingle()
  return data
}

// The public form takes ONE flexible field — a business name as it appears on
// Google, or a pasted Google review link — since customers have whichever one
// handy. Anything URL-shaped goes to google_review_url; otherwise company_name.
export async function fulfillLogoRequest(token, { logoUrl, nameOrLink }) {
  const patch = { logo_url: logoUrl, request_submitted_at: new Date().toISOString() }
  const trimmed = (nameOrLink || '').trim()
  if (/^https?:\/\//i.test(trimmed)) patch.google_review_url = trimmed
  else if (trimmed) patch.company_name = trimmed
  const { data, error } = await getClient().from('manual_orders').update(patch).eq('request_token', token).select().single()
  if (error) throw error
  logActivity({
    actorType: 'client', actorLabel: data.company_name || null,
    action: 'logo.uploaded', targetType: 'order', targetId: data.row_slug, targetLabel: data.company_name || null,
  })
  return data
}
