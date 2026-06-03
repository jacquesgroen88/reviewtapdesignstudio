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
    // We only use REST. Provide a WebSocket impl so Realtime init doesn't
    // throw on Node < 22 (Netlify Functions run Node 20).
    realtime: { transport: ws },
  })
  return _client
}

// ── QR codes ──────────────────────────────────────────────────────────────────

export async function listQRCodes() {
  const { data, error } = await getClient()
    .from('qr_codes').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getQRCode(id) {
  const { data } = await getClient()
    .from('qr_codes').select('*').eq('id', id).maybeSingle()
  return data
}

export async function createQRCode({ id, label, destination }) {
  const { data, error } = await getClient()
    .from('qr_codes').insert({ id, label, destination }).select().single()
  if (error) throw error
  return data
}

export async function updateQRCode(id, { label, destination }) {
  const updates = { updated_at: new Date().toISOString() }
  if (label       !== undefined) updates.label       = label
  if (destination !== undefined) updates.destination = destination
  const { data, error } = await getClient()
    .from('qr_codes').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteQRCode(id) {
  await getClient().from('qr_codes').delete().eq('id', id)
}

export async function incrementScanCount(id) {
  await getClient().rpc('increment_scan_count', { qr_id: id })
}

export async function bulkImport(entries) {
  const { error } = await getClient()
    .from('qr_codes').upsert(entries, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

// ── Order status ──────────────────────────────────────────────────────────────

export async function getOrderStatus(rowSlug) {
  const { data } = await getClient()
    .from('order_status').select('*').eq('row_slug', rowSlug).maybeSingle()
  return data
}

export async function setOrderStatus(rowSlug, status, note = null) {
  const { error } = await getClient().from('order_status').upsert(
    { row_slug: rowSlug, status, note, updated_at: new Date().toISOString() },
    { onConflict: 'row_slug' }
  )
  if (error) throw error
}

export async function getAllOrderStatuses() {
  const { data, error } = await getClient().from('order_status').select('*')
  if (error) throw error
  return data ?? []
}

// ── Saved designs ─────────────────────────────────────────────────────────────

export async function getDesignsForOrder(rowSlug) {
  const { data, error } = await getClient()
    .from('order_designs').select('*').eq('row_slug', rowSlug)
  if (error) throw error
  return data ?? []
}

export async function saveDesign(rowSlug, productId, variantId, design) {
  const { error } = await getClient().from('order_designs').upsert(
    { row_slug: rowSlug, product_id: productId, variant_id: variantId, design, updated_at: new Date().toISOString() },
    { onConflict: 'row_slug,product_id' }
  )
  if (error) throw error
}

// Map of row_slug → [product_id, ...] for every order that has a design
export async function listDesignedProducts() {
  const { data, error } = await getClient().from('order_designs').select('row_slug, product_id')
  if (error) throw error
  const map = {}
  for (const d of data ?? []) (map[d.row_slug] ||= []).push(d.product_id)
  return map
}
