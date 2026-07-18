// /setup — the self-hosted onboarding front door (spec 2026-07-17 §4.2).
//
// The customer arrives from the Shopify order confirmation with nothing but an
// order number (§4.0: at order time we hold no phone and no email, so a
// tokenless URL the receipt can render is the only reachable channel). This
// service resolves that number to an ANCHOR row — the row_slug every other
// table joins on — and upserts the order's destinations against it.
//
// Anchor resolution, in order:
//   1. An existing manual_orders row with this order number (walk-ins, or a row
//      the missing-logo banner already created).
//   2. An existing Formaloo submission with this number — destinations attach
//      to the FORMALOO rowSlug, so no duplicate card is ever created for a
//      customer who used both intakes.
//   3. Neither → a new manual_orders row is created on first submit.
// The Shopify open-orders sync supplies what they bought (qty per product
// type); an order Shopify no longer lists (old/fulfilled) still renders from
// its anchor row. Matching is by bareOrderNumber on BOTH sides — the exact
// leading-'#' trap from the missing-logo false positives (Gotcha #15 family).
import { nanoid } from 'nanoid'
import { fetchAllOrders } from './formaloo.js'
import { fetchOpenShopifyOrders } from './shopify.js'
import {
  getManualOrder, createManualOrder, updateManualOrder,
} from './manualOrders.js'
import { listDestinations, upsertDestinations, uploadDestinationLogo, setDestinationLogo, getDestination } from './destinations.js'
import { setOrderOverride } from './database.js'
import { ghlConfigured, ghlLogoConfigured, upsertContact } from './ghl.js'
import { logActivity } from './activityLog.js'
import { bareOrderNumber } from '../lib/orderNumber.js'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

let _client = null
function getClient() {
  if (_client) return _client
  _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  })
  return _client
}

// A manual row for this number, tolerant of the '#' inconsistency.
async function findManualByNumber(bare) {
  const { data } = await getClient().from('manual_orders')
    .select('*').in('order_number', [bare, `#${bare}`]).limit(1).maybeSingle()
  return data
}

async function findFormalooByNumber(bare) {
  try {
    const all = await fetchAllOrders()
    return all.orders.find(o => bareOrderNumber(o.orderNumber) === bare) || null
  } catch (err) {
    // Formaloo down must never take /setup down — the page just can't dedupe
    // against Formaloo for one load, which at worst creates a manual row the
    // studio already knows how to reconcile.
    console.error('setup: formaloo lookup failed:', err.message)
    return null
  }
}

// Everything the page needs to render. Null = no such order anywhere.
export async function getSetupState(orderNumber) {
  const bare = bareOrderNumber(orderNumber)
  if (!bare || !/^\d{1,10}$/.test(bare)) return null

  const [shopifyMap, manual] = await Promise.all([
    fetchOpenShopifyOrders().catch(err => { console.error('setup: shopify lookup failed:', err.message); return {} }),
    findManualByNumber(bare),
  ])
  const shopify = shopifyMap[bare] || null
  const formaloo = manual ? null : await findFormalooByNumber(bare)

  const rowSlug = manual?.row_slug || formaloo?.rowSlug || null
  const destinations = rowSlug ? await listDestinations(rowSlug) : []

  if (!shopify && !rowSlug) return null

  return {
    bare,
    shopify,          // { qtyStand, qtyReviewCard, qtySmartCard, requiresSmartCard, ... } or null
    rowSlug,          // null until first submit creates the manual row
    anchorType: manual ? 'manual' : formaloo ? 'formaloo' : null,
    companyPrefill: manual?.company_name && !/^Order #/.test(manual.company_name)
      ? manual.company_name
      : (formaloo?.companyName || ''),
    whatsapp: manual?.whatsapp || formaloo?.whatsapp || '',
    destinations,
  }
}

// Phase 1 of the submit: metadata only (destinations without logo files), so no
// request ever approaches the serverless body limit — logos follow one-per-POST
// in phase 2, the same size class the token page already handles fine.
//
// Upsert semantics throughout: the page is RE-OPENABLE by design (§4.2). A
// franchise coordinator adds three branches tonight and three next week; every
// submit replaces the full set it was shown, never a one-shot.
export async function submitSetup(orderNumber, { whatsapp, destinations }) {
  const state = await getSetupState(orderNumber)
  if (!state) throw Object.assign(new Error('Order not found'), { status: 404 })

  const cleanDests = (Array.isArray(destinations) ? destinations : [])
    .slice(0, 20)
    .map(d => ({
      id: typeof d.id === 'string' && /^dst_[\w-]{6,20}$/.test(d.id) ? d.id : null,
      businessName: String(d.businessName || '').slice(0, 200),
      placeId: String(d.placeId || '').slice(0, 300),
      googleReviewUrl: String(d.googleReviewUrl || '').slice(0, 500),
      // Existing rows keep their stored logo; new logos arrive in phase 2.
      logoUrl: null,
      qtyStand: clampQty(d.qtyStand), qtyReviewCard: clampQty(d.qtyReviewCard), qtySmartCard: clampQty(d.qtySmartCard),
    }))
  if (!cleanDests.length) throw Object.assign(new Error('At least one business is required'), { status: 400 })

  // Preserve logos already stored on existing destinations — phase 1 must never
  // null a logo the customer uploaded on a previous visit.
  for (const d of cleanDests) {
    if (d.id) {
      const existing = await getDestination(d.id)
      if (existing && existing.logoUrl) d.logoUrl = existing.logoUrl
    }
  }

  const dest0 = cleanDests[0]
  const cleanWhatsapp = String(whatsapp || '').trim().slice(0, 30)

  // Resolve or create the anchor row.
  let rowSlug = state.rowSlug
  if (!rowSlug) {
    const row = await createManualOrder({
      row_slug: `manual_${nanoid(12)}`,
      order_number: state.bare,
      company_name: dest0.businessName || `Order #${state.bare}`,
      google_review_url: dest0.googleReviewUrl || null,
      whatsapp: cleanWhatsapp || null,
      ordered_stand: !!state.shopify?.requiresStand,
      ordered_card: !!state.shopify?.requiresCard,
      created_by: null,
    })
    rowSlug = row.row_slug
  } else if (state.anchorType === 'manual') {
    // Mirror destination 0 into the singular fields so the dual-run studio
    // reads the same truth from either shape (§4.4's back-compat rule).
    await updateManualOrder(rowSlug, {
      companyName: dest0.businessName || undefined,
      googleReviewUrl: dest0.googleReviewUrl || undefined,
      whatsapp: cleanWhatsapp || undefined,
    })
    await getClient().from('manual_orders')
      .update({ request_submitted_at: new Date().toISOString() }).eq('row_slug', rowSlug)
  } else if (state.anchorType === 'formaloo' && cleanWhatsapp) {
    // Formaloo rows are read-only; corrections live on order_overrides, which
    // enrichOrder already applies everywhere (WhatsApp greeting, GHL contact).
    await setOrderOverride(rowSlug, { whatsapp: cleanWhatsapp }, null).catch(err =>
      console.error('setup: whatsapp override failed:', err.message))
  }

  const saved = await upsertDestinations(rowSlug, cleanDests)

  // From this moment the customer is reachable: upsert the GHL contact so
  // approval + chasing run on WhatsApp exactly as today (§4.0 step 4). Contact
  // upsert ONLY — enrolling a workflow here would message them seconds after
  // they finished helping us.
  if (cleanWhatsapp && (ghlConfigured() || ghlLogoConfigured())) {
    try {
      await upsertContact({ name: dest0.businessName || `Order #${state.bare}`, phone: cleanWhatsapp })
    } catch (err) {
      console.error('setup: GHL contact upsert failed:', err.response?.data || err.message)
    }
  }

  // Soft validation, never a gate (D2): a mismatch is flagged for Giorgio on
  // the card (computed there from the same numbers), and recorded here.
  const allocated = saved.reduce((s, d) => s + d.qtyStand + d.qtyReviewCard + d.qtySmartCard, 0)
  const ordered = state.shopify ? state.shopify.quantity : null

  logActivity({
    actorType: 'client', actorLabel: dest0.businessName || `Order #${state.bare}`,
    action: 'setup.submitted', targetType: 'order', targetId: rowSlug,
    targetLabel: dest0.businessName || `Order #${state.bare}`,
    metadata: {
      orderNumber: state.bare, destinations: saved.length,
      allocated, ordered, mismatch: ordered != null && allocated !== ordered,
    },
  })

  return {
    rowSlug,
    destinations: saved,
    smartCardHandoff: !!state.shopify?.requiresSmartCard,
  }
}

// Phase 2: one logo per POST. `logo` is a dataURL upload; `copyFromDestId`
// instead copies an already-uploaded destination's logo (the "use the same
// logo" toggle) without re-uploading — and only ever from a sibling destination
// of the SAME order, so the public page can never graft a foreign URL in.
export async function submitSetupLogo(orderNumber, { destId, logo, copyFromDestId }) {
  const bare = bareOrderNumber(orderNumber)
  const dest = await getDestination(String(destId || ''))
  if (!dest) throw Object.assign(new Error('Destination not found'), { status: 404 })

  if (copyFromDestId) {
    // Only ever from a sibling of the same order — a public POST can never
    // graft a foreign URL onto a destination.
    const siblings = await listDestinations(dest.rowSlug)
    const source = siblings.find(s => s.id === copyFromDestId)
    if (!source?.logoUrl) throw Object.assign(new Error('No logo to copy'), { status: 400 })
    return setDestinationLogo(dest.id, source.logoUrl)
  }
  if (!logo) throw Object.assign(new Error('logo required'), { status: 400 })
  const url = await uploadDestinationLogo(dest.rowSlug, dest.id, logo)
  const updated = await setDestinationLogo(dest.id, url)
  logActivity({
    actorType: 'client', actorLabel: dest.businessName || `Order #${bare}`,
    action: 'logo.uploaded', targetType: 'order', targetId: dest.rowSlug,
    targetLabel: dest.businessName || null,
    metadata: { via: 'setup', destinationId: dest.id },
  })
  return updated
}

function clampQty(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999) : 0
}
