// Destinations — the unit of onboarding (spec 2026-07-17 §4.1).
//
// A destination is one business or branch: one Google listing, one logo, one
// QR, N units. An order (row_slug) is a payment that happens to contain
// several. Everything downstream — design, QR, approval, print — was already
// per-destination in practice (orders 1795/1811/1820/Umndeni); only the intake
// pretended otherwise. This table makes the reality first-class.
//
// row_slug is FK-by-convention to the order (a Formaloo rowSlug OR manual_*),
// the same key order_status / designs.owner_slug / approvals already join on —
// deliberately, so none of them had to change. See Gotcha #15 for why
// order_number can never be this key.
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { nanoid } from 'nanoid'

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

// Same bucket as manual-order logos, but the path is PER DESTINATION —
// `${rowSlug}/logo.ext` would make destination 2's upload silently overwrite
// destination 1's (spec Risk 4). manualOrders.uploadLogo keeps the old path for
// the single-logo token page; this one is used wherever a destination exists.
const BUCKET = 'manual-order-logos'

export function destLogoPublicUrl(path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

export async function uploadDestinationLogo(rowSlug, destId, dataUrl) {
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('invalid logo data')
  const buffer = Buffer.from(base64, 'base64')
  const ext = dataUrl.slice(5, dataUrl.indexOf(';')).split('/')[1] || 'png'
  const path = `${rowSlug}/${destId}.${ext}`
  const { error } = await getClient().storage.from(BUCKET)
    .upload(path, buffer, { contentType: `image/${ext}`, upsert: true })
  if (error) throw error
  return destLogoPublicUrl(path)
}

function toShape(d) {
  return {
    id: d.id, rowSlug: d.row_slug, position: d.position,
    businessName: d.business_name, placeId: d.google_place_id,
    googleReviewUrl: d.google_review_url, logoUrl: d.logo_url,
    qtyStand: d.qty_stand, qtyReviewCard: d.qty_review_card, qtySmartCard: d.qty_smart_card,
  }
}

// One grouped read for the whole Orders list — same join pattern as
// listDesignsByOwner. Position order within each slug.
export async function listDestinationsBySlug() {
  const { data, error } = await getClient()
    .from('order_destinations').select('*').order('position', { ascending: true })
  if (error) throw error
  const map = {}
  for (const d of data ?? []) (map[d.row_slug] ??= []).push(toShape(d))
  return map
}

export async function listDestinations(rowSlug) {
  const { data, error } = await getClient()
    .from('order_destinations').select('*').eq('row_slug', rowSlug)
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toShape)
}

// Full-replace upsert for one order: the /setup page always posts the complete
// set of cards it showed, so rows for this slug that are absent from the posted
// list are removed. Never called with an empty list (the page requires at least
// one destination), but guard anyway — an empty post must never wipe an order.
export async function upsertDestinations(rowSlug, destinations) {
  if (!destinations?.length) return listDestinations(rowSlug)
  const client = getClient()
  const rows = destinations.map((d, i) => ({
    id: d.id || `dst_${nanoid(12)}`,
    row_slug: rowSlug,
    position: i,
    business_name: (d.businessName || '').trim() || null,
    google_place_id: (d.placeId || '').trim() || null,
    google_review_url: (d.googleReviewUrl || '').trim() || null,
    logo_url: d.logoUrl || null,
    qty_stand: Number(d.qtyStand) || 0,
    qty_review_card: Number(d.qtyReviewCard) || 0,
    qty_smart_card: Number(d.qtySmartCard) || 0,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await client.from('order_destinations').upsert(rows)
  if (error) throw error
  const keep = rows.map(r => r.id)
  const { error: delErr } = await client.from('order_destinations')
    .delete().eq('row_slug', rowSlug).not('id', 'in', `(${keep.map(id => `"${id}"`).join(',')})`)
  if (delErr) throw delErr
  return listDestinations(rowSlug)
}

export async function setDestinationLogo(destId, logoUrl) {
  const { data, error } = await getClient().from('order_destinations')
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq('id', destId).select().single()
  if (error) throw error
  return toShape(data)
}

export async function getDestination(destId) {
  const { data } = await getClient().from('order_destinations')
    .select('*').eq('id', destId).maybeSingle()
  return data ? toShape(data) : null
}
