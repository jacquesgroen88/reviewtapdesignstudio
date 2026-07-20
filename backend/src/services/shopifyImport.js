// Import customer details from a Shopify orders_export.csv into manual orders.
//
// WHY THIS EXISTS: the studio cannot read Shopify customer PII. The Dev-Dashboard
// custom app has `read_orders` only and cannot request protected customer data
// (platform limitation, recorded 2026-07-09), so `services/shopify.js` fetches no
// customer fields at all. Orders created from the missing-logo banner therefore
// land with a placeholder name ("Order #1837") and NO phone number.
//
// That empty phone is what breaks the send: `routes/logoRequests.js` gates the
// auto-send on `ghlLogoConfigured() && !!whatsapp`, so with no number the share
// modal can only offer a copy-link, and the team falls back to building the GHL
// contact by hand and typing the template variables in. Diane hit exactly this on
// order #1837 (two link-creations and two copies inside 35 seconds, 2026-07-20).
//
// The CSV export Jacques already downloads DOES carry name, phone and email for
// every order. This closes the loop: import once, and every logo-less order has a
// number, which makes the existing one-click "Send via the Reviewtap System" work
// (it upserts the GHL contact and fills the custom fields itself — see ghl.js).
//
// SAFETY RULE: fill blanks, never clobber. A value already in the studio may have
// been corrected by hand (order 1820's client details, the overrides work), and a
// CSV re-import must never undo that. The ONE exception is the "Order #1837"
// placeholder, which exists precisely to be replaced.
import { listManualOrders, createManualOrder, updateManualOrder } from './manualOrders.js'
import { fetchAllOrders } from './formaloo.js'
import { normalizePhone } from './ghl.js'
import { bareOrderNumber } from '../lib/orderNumber.js'
import { nanoid } from 'nanoid'

// Same test `services/shopify.js` uses to decide an order needs artwork.
const CUSTOM_TITLE_RE = /custom/i

// Names the banner generates when it has nothing better. Safe to overwrite.
const PLACEHOLDER_NAME_RE = /^Order #/i

const blank = v => !String(v ?? '').trim()

// One CSV row per line item, so callers group by order before sending. Kept
// server-side too as a guard: a caller that forgets to group would otherwise
// propose the same order several times.
function pickCompanyName(row) {
  // A company field is the business name we actually want on the design and in
  // the WhatsApp greeting. Sole traders leave it empty, so fall back to the
  // person — better "Hi Jaco" than the "Hi Order" the placeholder produces.
  return String(row.companyName || '').trim() || String(row.personName || '').trim() || ''
}

export function planImport({ rows, manualOrders, formalooNumbers }) {
  const byNumber = new Map()
  for (const m of manualOrders) {
    const bare = bareOrderNumber(m.order_number)
    if (bare) byNumber.set(bare, m)
  }

  const updates = []
  const creates = []
  const skipped = []

  for (const row of rows) {
    const bare = bareOrderNumber(row.orderNumber)
    if (!bare) { skipped.push({ orderNumber: row.orderNumber, reason: 'no order number' }); continue }

    if (row.cancelled) { skipped.push({ orderNumber: bare, reason: 'cancelled order' }); continue }

    const existing = byNumber.get(bare)
    const companyName = pickCompanyName(row)
    const whatsapp = row.whatsapp ? (normalizePhone(row.whatsapp) || row.whatsapp) : ''
    const email = String(row.email || '').trim()

    if (existing) {
      const changes = {}
      // Placeholder names are the whole reason this import exists — replace them.
      // A real name already in place is left alone, it may be a hand correction.
      if (companyName && (blank(existing.company_name) || PLACEHOLDER_NAME_RE.test(existing.company_name))) {
        if (existing.company_name !== companyName) changes.company_name = { from: existing.company_name || null, to: companyName }
      }
      if (whatsapp && blank(existing.whatsapp)) changes.whatsapp = { from: null, to: whatsapp }
      if (email && blank(existing.email)) changes.email = { from: null, to: email }

      if (Object.keys(changes).length) {
        updates.push({ orderNumber: bare, rowSlug: existing.row_slug, companyName: existing.company_name, changes })
      } else {
        skipped.push({ orderNumber: bare, reason: 'nothing to fill' })
      }
      continue
    }

    // No studio row. A Formaloo submission already covers this order, so creating
    // a manual one would duplicate it on the Orders tab (the same '#'-stripping
    // trap that made orders look "missing" in the 2026-07-09 investigation).
    if (formalooNumbers.has(bare)) { skipped.push({ orderNumber: bare, reason: 'already has a Formaloo submission' }); continue }

    // Only orders that actually need artwork are worth creating. Everything else
    // is a plain stand/card sale with no design step.
    if (!row.needsLogo) { skipped.push({ orderNumber: bare, reason: 'no custom item — no design needed' }); continue }
    if (!row.paid) { skipped.push({ orderNumber: bare, reason: 'not paid yet' }); continue }

    creates.push({
      orderNumber: bare,
      companyName: companyName || `Order #${bare}`,
      whatsapp, email,
      orderedStand: !!row.orderedStand,
      orderedCard: !!row.orderedCard,
    })
  }

  return { updates, creates, skipped }
}

export async function buildPlan(rows) {
  const [manualOrders, formaloo] = await Promise.all([
    listManualOrders().catch(() => []),
    fetchAllOrders().catch(() => ({ orders: [] })),
  ])
  const formalooNumbers = new Set(
    (formaloo.orders || []).map(o => bareOrderNumber(o.orderNumber)).filter(Boolean)
  )
  return planImport({ rows, manualOrders, formalooNumbers })
}

// Applies a plan. Sequential on purpose: this runs a handful of rows at most and
// a burst of parallel writes against Supabase buys nothing here but rate-limit risk.
export async function applyPlan(plan, { createdBy = null } = {}) {
  const applied = { updated: [], created: [], failed: [] }

  for (const u of plan.updates) {
    try {
      const fields = {}
      for (const [k, v] of Object.entries(u.changes)) {
        // updateManualOrder takes camelCase field names.
        if (k === 'company_name') fields.companyName = v.to
        if (k === 'whatsapp') fields.whatsapp = v.to
        if (k === 'email') fields.email = v.to
      }
      await updateManualOrder(u.rowSlug, fields)
      applied.updated.push({ orderNumber: u.orderNumber, rowSlug: u.rowSlug, fields: Object.keys(u.changes) })
    } catch (err) {
      applied.failed.push({ orderNumber: u.orderNumber, error: err.message })
    }
  }

  for (const c of plan.creates) {
    try {
      const rowSlug = `manual_${nanoid(12)}`
      await createManualOrder({
        row_slug: rowSlug,
        order_number: c.orderNumber,
        company_name: c.companyName,
        whatsapp: c.whatsapp || null,
        email: c.email || null,
        ordered_stand: c.orderedStand,
        ordered_card: c.orderedCard,
        created_by: createdBy,
      })
      applied.created.push({ orderNumber: c.orderNumber, rowSlug })
    } catch (err) {
      applied.failed.push({ orderNumber: c.orderNumber, error: err.message })
    }
  }

  return applied
}
