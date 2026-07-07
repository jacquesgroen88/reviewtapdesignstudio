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

export async function createQRCode({ id, label, destination, defaultStyle }) {
  const row = { id, label, destination }
  if (defaultStyle !== undefined) row.default_style = defaultStyle
  const { data, error } = await getClient()
    .from('qr_codes').insert(row).select().single()
  if (error) throw error
  return data
}

export async function updateQRCode(id, { label, destination, defaultStyle }) {
  const updates = { updated_at: new Date().toISOString() }
  if (label        !== undefined) updates.label         = label
  if (destination  !== undefined) updates.destination   = destination
  if (defaultStyle !== undefined) updates.default_style = defaultStyle
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

// ── Designs (first-class, reusable; an order/job can have many) ───────────────

const DESIGN_META = 'id, name, owner_slug, product_id, variant_id, created_at, updated_at'

export async function listDesigns({ owner } = {}) {
  let q = getClient().from('designs').select(DESIGN_META).order('updated_at', { ascending: false })
  if (owner) q = q.eq('owner_slug', owner)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getDesign(id) {
  const { data } = await getClient().from('designs').select('*').eq('id', id).maybeSingle()
  return data
}

export async function createDesign({ id, name, ownerSlug, productId, variantId, design }) {
  const { data, error } = await getClient().from('designs')
    .insert({ id, name, owner_slug: ownerSlug, product_id: productId, variant_id: variantId, design })
    .select().single()
  if (error) throw error
  return data
}

export async function updateDesign(id, fields) {
  const patch = { updated_at: new Date().toISOString() }
  if (fields.name       !== undefined) patch.name = fields.name
  if (fields.variantId  !== undefined) patch.variant_id = fields.variantId
  if (fields.design     !== undefined) patch.design = fields.design
  const { data, error } = await getClient().from('designs').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteDesign(id) {
  await getClient().from('designs').delete().eq('id', id)
}

// Map of owner_slug → [{id,name,product_id,variant_id}] for list views (no JSONB)
export async function listDesignsByOwner() {
  const { data, error } = await getClient().from('designs').select(DESIGN_META)
  if (error) throw error
  const map = {}
  for (const d of data ?? []) (map[d.owner_slug] ||= []).push(d)
  return map
}

// ── Standalone jobs (not tied to a Formaloo order) ────────────────────────────

export async function createJob(id, name) {
  const { data, error } = await getClient()
    .from('jobs').insert({ id, name }).select().single()
  if (error) throw error
  return data
}

export async function listJobs() {
  const { data, error } = await getClient()
    .from('jobs').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getJob(id) {
  const { data } = await getClient().from('jobs').select('*').eq('id', id).maybeSingle()
  return data
}

export async function renameJob(id, name) {
  const { data, error } = await getClient()
    .from('jobs').update({ name, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteJob(id) {
  await getClient().from('order_designs').delete().eq('row_slug', id)
  await getClient().from('order_status').delete().eq('row_slug', id)
  await getClient().from('jobs').delete().eq('id', id)
}
