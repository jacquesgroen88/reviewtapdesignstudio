// Orders entered by hand in the studio (not sourced from Formaloo) — e.g. a
// walk-in client or a one-off job with no Formaloo submission. Same row_slug
// shape as Formaloo orders so the existing status/designs/approvals joins
// (keyed by row_slug) work identically for both sources.
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
