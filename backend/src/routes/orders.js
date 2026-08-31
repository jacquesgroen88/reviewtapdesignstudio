import express from 'express'
import { nanoid } from 'nanoid'
import { fetchAllOrders, fetchOrder } from '../services/formaloo.js'
import {
  getOrderStatus, setOrderStatus, getAllOrderStatuses, listDesignsByOwner, getProfileNames,
  getOrderOverrides, setOrderOverride, deleteOrderOverride,
} from '../services/database.js'
import { approvalSummaryByDesign } from '../services/approvals.js'
import {
  listManualOrders, getManualOrder, createManualOrder, updateManualOrder, deleteManualOrder, uploadLogo,
} from '../services/manualOrders.js'
import { fetchOpenShopifyOrders } from '../services/shopify.js'
import { listDestinationsBySlug, listDestinations } from '../services/destinations.js'
import { logActivity, listActivityForOrder, getLastContactBySlug } from '../services/activityLog.js'
import { buildPlan, applyPlan } from '../services/shopifyImport.js'
import { orderLabel, bareOrderNumber } from '../lib/orderNumber.js'

const router = express.Router()

function actorFrom(req) {
  return { actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null }
}

// Ladder: pending → ready → pending_approval → pending_print (UI "Approved",
// set automatically when the client approves) → at_printer (UI "Print
// Pending", set manually when the job is sent to the printer) → done.
const VALID_STATUSES = ['pending', 'ready', 'pending_approval', 'pending_print', 'at_printer', 'done', 'skipped']

// Shared enrichment for BOTH Formaloo and manually-entered orders — one place
// joins status/designs/approvals so the two sources behave identically.
// Studio corrections layered over a read-only Formaloo submission. `?? ` not
// `|| `: an override of '' is an intentional blank and must win, while null
// means "no override, use what the customer sent".
//
// Manual orders are skipped — they're editable in place via manual_orders, so
// letting an override shadow them would create two editable homes for one field
// and no clear winner.
//
// This is the ONE place corrections are applied, which is why everything
// downstream (the WhatsApp greeting, the GHL contact name, design names, log
// labels) gets them for free: they all read the enriched order.
function applyOverride(order, override) {
  if (!override || order.source === 'manual') return order
  return {
    ...order,
    companyName: override.company_name ?? order.companyName,
    whatsapp:    override.whatsapp     ?? order.whatsapp,
    orderNumber: override.order_number ?? order.orderNumber,
    // Kept so the UI can show what the customer originally submitted and offer
    // to revert. Never send these to a client.
    original: {
      companyName: order.companyName,
      whatsapp:    order.whatsapp,
      orderNumber: order.orderNumber,
    },
    isOverridden: true,
  }
}

function enrichOrder(rawOrder, { statusMap, designsMap, names, approvalMap, shopifyMap = {}, contactMap = {}, overrideMap = {}, destinationsMap = {} }) {
  const order = applyOverride(rawOrder, overrideMap[rawOrder.rowSlug])
  // Destinations (spec 2026-07-17 §4.4): the businesses this order is FOR.
  // Destination 0 FILLS GAPS in the singular fields (`??`), it never clobbers
  // them — Formaloo's submission, manual edits and staff overrides all outrank
  // it. The write path keeps manual_orders' singulars mirrored to destination 0
  // anyway, so for /setup-created orders the two never disagree; this fallback
  // exists for orders whose only data arrived per-destination. Everything
  // downstream (WhatsApp greeting, GHL contact, design names, log labels)
  // reads the enriched order, so this one spot covers all of them.
  const destinations = destinationsMap[order.rowSlug] ?? []
  const dest0 = destinations[0]
  return {
    ...order,
    companyName:     order.companyName     || dest0?.businessName    || order.companyName,
    logoUrl:         order.logoUrl         || dest0?.logoUrl         || order.logoUrl,
    googleReviewUrl: order.googleReviewUrl || dest0?.googleReviewUrl || order.googleReviewUrl,
    destinations,
    status: statusMap[order.rowSlug]?.status ?? (order.orderedStand || order.orderedCard ? 'pending' : 'not_needed'),
    note:   statusMap[order.rowSlug]?.note   ?? null,
    designs: (designsMap[order.rowSlug] ?? []).map(d => ({
      ...d,
      created_by_name: d.created_by ? names[d.created_by] || null : null,
      approval: approvalMap[d.id] || null,
    })),
    hasDesign: !!designsMap[order.rowSlug]?.length,
    shopify: shopifyMap[String(order.orderNumber || '').replace(/^#/, '')] || null,
    // null = nobody has contacted this client through the studio. NOT the same
    // as "nobody has contacted them" for orders worked before 2026-07-10, when
    // the log did not exist — the UI distinguishes the two.
    lastContact: contactMap[order.rowSlug] || null,
  }
}

function toOrderShape(m) {
  return {
    rowSlug: m.row_slug, orderNumber: m.order_number, companyName: m.company_name,
    logoUrl: m.logo_url, googleReviewUrl: m.google_review_url, whatsapp: m.whatsapp,
    cardEmail: m.email, cardPhone: m.phone, cardAddress: m.address,
    orderedStand: m.ordered_stand, orderedCard: m.ordered_card,
    submittedAt: m.created_at, source: 'manual',
    // Authoritative "we asked them for a logo" record. Predates activity_log
    // (which only starts 2026-07-10), so the Awaiting-client filter anchors on
    // this column rather than on log entries and stays correct for old orders.
    logoRequestSentAt: m.request_sent_at || null,
  }
}

// Filter tabs map to real order_status values, except 'awaiting_logo' which is
// about the order having no logo file at all (independent of status) and
// 'all'/'' which means no filter. 'approved' reads as 'pending_print' — that's
// the status set when a client approves via the approval link; the UI label
// is friendlier than the internal print-queue name. 'print_pending' reads
// as 'at_printer' — jobs sent to the printer, awaiting the physical print.
const STATUS_FILTER_MAP = {
  ready: 'ready',
  pending_approval: 'pending_approval',
  approved: 'pending_print',
  print_pending: 'at_printer',
  done: 'done',
}

const orderedSomething = o => o.orderedStand || o.orderedCard

// Finished or abandoned — never chase these, whatever else is outstanding.
const TERMINAL_STATUSES = ['done', 'skipped']

// An approval link is out and the client has not answered it.
//
// NOT the same as status === 'pending_approval', which is a trap: that status
// is also set automatically whenever a DESIGN IS UPDATED ("needs (re)approval",
// designs.js) — i.e. on work we have not sent to anyone yet. Keying the chase
// list on it put our own to-do list in front of the client's (verified against
// live data: King Chicken sat in pending_approval having never been contacted).
// The approval record itself is the only honest signal that we actually asked.
const hasOpenApproval = o => (o.designs || []).some(
  d => d.approval && !d.approval.superseded && !d.approval.response
)

// "This order still needs a logo." With destinations, that means ANY
// destination missing one. Destination 0 may inherit the order-level logo (a
// Formaloo submission's single upload belongs to the primary business); later
// destinations cannot — order 1820 has Witsieshoek's logo on the order, but
// Thaba Adventures' destination has none, and that gap is real work, not noise.
// Without destinations it stays the old single-logo test.
const missingLogo = o => o.destinations?.length
  ? o.destinations.some((d, i) => !d.logoUrl && !(i === 0 && o.logoUrl))
  : !o.logoUrl

// We asked for a logo and it never arrived. request_sent_at is authoritative
// and predates activity_log, so this stays correct for pre-10-Jul orders.
const hasOpenLogoRequest = o => missingLogo(o) && !!o.logoRequestSentAt

function isAwaitingClient(order) {
  if (!orderedSomething(order)) return false
  if (TERMINAL_STATUSES.includes(order.status)) return false
  return hasOpenApproval(order) || hasOpenLogoRequest(order)
}

function matchesFilter(order, filter, search) {
  // The default view is a worklist, not an archive: done orders are hidden so
  // open work is findable at a glance (Jacques, 2026-08-31). They stay on the
  // Done tab — and a SEARCH still finds them, because hiding an order someone
  // is explicitly searching for would read as the search being broken.
  if (!filter || filter === 'all') return search ? true : order.status !== 'done'
  // Must ALSO have ordered a stand/card — plenty of Formaloo submissions never
  // ordered anything (orderedStand/orderedCard both false) and legitimately
  // have no logo; without this check they flooded the tab (found while
  // testing search: 132 "awaiting logo" results instead of the real ~30).
  if (filter === 'awaiting_logo') return missingLogo(order) && orderedSomething(order)
  // The ball is in the CLIENT's court: we asked for something and are waiting.
  // Deliberately excludes work we simply have not done or sent yet — that is
  // our own to-do (Awaiting Logo / Ready), not a chase.
  if (filter === 'awaiting_client') return isAwaitingClient(order)
  const target = STATUS_FILTER_MAP[filter]
  return target ? order.status === target : true
}

// Longest-since-contact first: the top row is the one most overdue a nudge.
// This ordering IS the feature — it is what answers "who do I chase" without
// opening every card. Never-contacted sorts first (nothing is more overdue
// than a client we have no record of ever reaching).
function byStalestContact(a, b) {
  const at = a.lastContact?.at ? new Date(a.lastContact.at).getTime() : -Infinity
  const bt = b.lastContact?.at ? new Date(b.lastContact.at).getTime() : -Infinity
  return at - bt
}

// Newest submission first — the default browse order. Manual and Formaloo
// orders sort as ONE timeline; before this, manual orders (which is what
// /setup creates) rode along as a separate block, so a brand-new order could
// render mid-page instead of at the top. Missing dates sort last.
function bySubmittedDesc(a, b) {
  const at = a.submittedAt ? new Date(a.submittedAt).getTime() : -Infinity
  const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : -Infinity
  return bt - at
}

function matchesSearch(order, search) {
  if (!search) return true
  return (order.companyName || '').toLowerCase().includes(search) ||
    String(order.orderNumber || '').toLowerCase().includes(search)
}

router.get('/', async (req, res) => {
  try {
    const page     = parseInt(req.query.page)     || 1
    const pageSize = parseInt(req.query.pageSize) || 50
    const filter   = req.query.filter             || 'all'
    const search   = (req.query.search || '').trim().toLowerCase()

    // One shape for every request: the whole form, cached, sliced in memory.
    // This used to fetch 50-row pages for 'all' and a separate 500-row page for
    // any filter/search — two Formaloo round-trips of ~9s each, neither cached.
    // Only the Refresh button forces a live fetch.
    const needsFullScan  = filter !== 'all' || !!search
    const onlyDesignNeeded = filter !== 'all'
    const all = await fetchAllOrders({ force: req.query.refresh === '1' })
    const orders = onlyDesignNeeded
      ? all.orders.filter(o => o.orderedStand || o.orderedCard)
      : all.orders

    const [statuses, designsMap, names, approvalMap, manualRaw, shopifyMap, contactMap, overrideMap, destinationsMap] = await Promise.all([
      getAllOrderStatuses(), listDesignsByOwner(), getProfileNames(),
      approvalSummaryByDesign().catch(() => ({})),
      listManualOrders().catch(() => []),
      fetchOpenShopifyOrders().catch(err => { console.error('Shopify sync error:', err.message); return {} }),
      // One grouped read for every order, not one per card. Same
      // fail-soft posture as the other joins: a history hiccup must never take
      // the Orders tab down, it just costs the "Last contacted" line.
      getLastContactBySlug().catch(err => { console.error('last-contact fetch error:', err.message); return {} }),
      // Fail-soft like the rest: if this read hiccups, the list still renders —
      // it just shows the customer's original wording for one load.
      getOrderOverrides().catch(err => { console.error('order overrides fetch error:', err.message); return {} }),
      // Fail-soft: a destinations hiccup costs the destination children on the
      // card, never the Orders tab itself.
      listDestinationsBySlug().catch(err => { console.error('destinations fetch error:', err.message); return {} }),
    ])
    const statusMap = Object.fromEntries(statuses.map(s => [s.row_slug, s]))
    const ctx = { statusMap, designsMap, names, approvalMap, shopifyMap, contactMap, overrideMap, destinationsMap }

    // Enrich EVERYTHING before filtering or paging — it's all in-memory map
    // joins, and both the done-hidden default view (status is enrichment) and
    // the merged newest-first sort need the full enriched set. The old path
    // sliced the Formaloo page first and stacked manual orders on top as a
    // separate block, which is why a brand-new /setup order could land at the
    // bottom of page 1 next to months-old rows.
    const enriched = orders.map(order => enrichOrder(order, ctx))
    const manualResult = manualRaw.map(toOrderShape).map(o => enrichOrder(o, ctx))

    let result = [...manualResult, ...enriched]
      .filter(o => matchesFilter(o, filter, search))
      .filter(o => matchesSearch(o, search))

    // Awaiting-client is a worklist, not a browse: order it by who is most
    // overdue a nudge rather than by submission date.
    if (filter === 'awaiting_client') result.sort(byStalestContact)
    else result.sort(bySubmittedDesc)

    const total = result.length
    // 'all' pages; a filter/search returns the full scan result.
    if (!needsFullScan) result = result.slice((page - 1) * pageSize, page * pageSize)

    res.json({ orders: result, count: total, page, pageSize })
  } catch (err) {
    console.error('Orders fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Shopify has orders Formaloo/manual entry never captured (customer paid, never
// filled in the logo form). Cross-reference: every unfulfilled Shopify order that
// needs a logo, with no matching order_number anywhere in Formaloo or manual orders.
// Registered before the '/:rowSlug' catch-all below so it isn't shadowed.
router.get('/missing-logo', async (req, res) => {
  try {
    const [shopifyMap, formalooAll, manualRaw] = await Promise.all([
      fetchOpenShopifyOrders(),
      fetchAllOrders(),
      listManualOrders().catch(() => []),
    ])
    // Normalize away a leading '#' — Formaloo submissions sometimes record it
    // (e.g. "#1817"), Shopify's order.name always has it, shopifyMap's keys never
    // do. Without stripping it here, those orders looked "missing" even though
    // they already have a Formaloo submission (found while investigating #1817).
    const knownNumbers = new Set([
      ...formalooAll.orders.map(o => String(o.orderNumber || '').trim().replace(/^#/, '')),
      ...manualRaw.map(m => String(m.order_number || '').trim().replace(/^#/, '')),
    ])
    // Unpaid orders (pending, voided, etc.) aren't confirmed sales yet — chasing
    // a logo for one is premature, so only paid orders are worth surfacing here.
    const missing = Object.values(shopifyMap)
      .filter(o => o.requiresLogo && ['UNFULFILLED', 'PARTIALLY_FULFILLED'].includes(o.fulfillmentStatus))
      .filter(o => o.financialStatus === 'PAID')
      .filter(o => !knownNumbers.has(o.orderNumber))
      .sort((a, b) => new Date(b.shopifyCreatedAt) - new Date(a.shopifyCreatedAt))
    res.json({ orders: missing, count: missing.length })
  } catch (err) {
    console.error('Missing-logo check failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/:rowSlug', async (req, res) => {
  try {
    // Fail-soft, same as the list join: a destinations hiccup costs the
    // children, never the order itself.
    const destinations = await listDestinations(req.params.rowSlug)
      .catch(err => { console.error('destinations fetch error:', err.message); return [] })
    const manual = await getManualOrder(req.params.rowSlug)
    if (manual) {
      const local = await getOrderStatus(req.params.rowSlug)
      return res.json({ ...toOrderShape(manual), destinations, status: local?.status ?? 'pending', note: local?.note ?? null })
    }
    const order = await fetchOrder(req.params.rowSlug)
    const local = await getOrderStatus(req.params.rowSlug)
    res.json({ ...order, destinations, status: local?.status ?? 'pending', note: local?.note ?? null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// (Design read/write moved to /api/designs — designs are first-class now.)

// ── Order overrides (correct a Formaloo submission's client details) ──────────

// Formaloo rows are the customer's own words and can't be edited at source, but
// they feed the client-facing WhatsApp and the GHL contact name. This lets the
// studio correct them without touching the submission.
//
// Body keys are OPTIONAL and only the present ones are written (unlike the
// manual-order PATCH, which is a full replace where omitting a field nulls it).
// An explicit null reverts that field to the customer's original.
router.put('/:rowSlug/override', async (req, res) => {
  try {
    const fields = {}
    for (const [key, col] of [['companyName', 'company_name'], ['whatsapp', 'whatsapp'], ['orderNumber', 'order_number']]) {
      if (key in (req.body || {})) {
        const v = req.body[key]
        // null = revert to Formaloo's value. A string is trimmed; a blank string
        // is treated as "revert" too, since an intentionally empty client name
        // isn't a thing anyone wants sent.
        fields[col] = v === null ? null : (String(v).trim() || null)
      }
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'nothing to update' })

    const row = await setOrderOverride(req.params.rowSlug, fields, req.user?.id || null)
    logActivity({
      ...actorFrom(req), action: 'order.details_corrected', targetType: 'order',
      targetId: req.params.rowSlug, targetLabel: row.company_name || req.params.rowSlug,
      metadata: { fields: Object.keys(fields) },
    })
    // Client details feed the WhatsApp greeting — worth seeing who changed them.
    res.json({
      rowSlug: row.row_slug,
      companyName: row.company_name, whatsapp: row.whatsapp, orderNumber: row.order_number,
    })
  } catch (err) {
    console.error('order override failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Drop every correction and go back to exactly what the customer submitted.
router.delete('/:rowSlug/override', async (req, res) => {
  try {
    await deleteOrderOverride(req.params.rowSlug)
    logActivity({
      ...actorFrom(req), action: 'order.details_reverted', targetType: 'order',
      targetId: req.params.rowSlug, targetLabel: req.body?.companyName || null,
    })
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Shopify CSV import ────────────────────────────────────────────────────────

// Fill customer details onto logo-less orders from a Shopify orders_export.csv.
// The studio cannot read Shopify PII (see services/shopifyImport.js for why), and
// an order with no phone number cannot use the one-click "Send via the Reviewtap
// System" — which is what forces the hand-built GHL contact. This closes that gap.
//
// body: { rows: [...parsed CSV rows...], apply?: boolean }
// Without `apply` it returns the PLAN only, so the UI can show exactly what will
// change before anything is written. The plan is always re-derived server-side on
// apply — never trust a client-sent plan, it may be stale or edited.
router.post('/import-shopify', async (req, res) => {
  try {
    const { rows, apply } = req.body || {}
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows required' })
    if (rows.length > 2000) return res.status(400).json({ error: 'too many rows (max 2000)' })

    const plan = await buildPlan(rows)
    if (!apply) return res.json({ plan })

    const applied = await applyPlan(plan, { createdBy: req.user?.id || null })
    if (applied.updated.length || applied.created.length) {
      logActivity({
        ...actorFrom(req), action: 'orders.imported', targetType: 'order', targetId: 'shopify-csv',
        targetLabel: `${applied.updated.length} filled, ${applied.created.length} created`,
        metadata: {
          updated: applied.updated.length,
          created: applied.created.length,
          failed: applied.failed.length,
          orderNumbers: [...applied.updated, ...applied.created].map(o => o.orderNumber).slice(0, 50),
        },
      })
    }
    res.json({ plan, applied })
  } catch (err) {
    console.error('shopify import failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Per-order history ─────────────────────────────────────────────────────────

// Everything that happened to one order, newest first. Visible to every
// authed team member by design (decision 4, 2026-07-17): Giorgio is the person
// most likely to duplicate a follow-up, so hiding this from designers would
// defeat the point. No history exists before 2026-07-10 (the log did not exist);
// the UI says so explicitly rather than implying nothing happened.
router.get('/:rowSlug/history', async (req, res) => {
  try {
    const entries = await listActivityForOrder(req.params.rowSlug)
    res.json(entries.map(e => ({
      id: e.id, at: e.created_at, actorType: e.actor_type, actorLabel: e.actor_label,
      action: e.action, targetLabel: e.target_label, metadata: e.metadata,
    })))
  } catch (err) {
    console.error('order history failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// "I chased them myself" — for a phone call or an email, i.e. contact that
// happens off-platform and no click can capture. A fallback, not the main path:
// since GHL became the default send method, real sends log themselves.
router.post('/:rowSlug/note', async (req, res) => {
  try {
    const text = (req.body?.text || '').trim()
    if (!text) return res.status(400).json({ error: 'text required' })
    if (text.length > 500) return res.status(400).json({ error: 'text too long (max 500 chars)' })
    logActivity({
      ...actorFrom(req), action: 'order.follow_up_logged', targetType: 'order',
      targetId: req.params.rowSlug, targetLabel: req.body?.companyName || null,
      metadata: { text },
    })
    res.status(201).json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:rowSlug/status', async (req, res) => {
  const { status, note, companyName, orderNumber } = req.body
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })
  const previous = await getOrderStatus(req.params.rowSlug)
  await setOrderStatus(req.params.rowSlug, status, note)
  // companyName/orderNumber come from the order card already in view — avoids
  // an extra Formaloo round-trip just to label the log entry.
  const label = orderLabel(companyName, orderNumber) || req.params.rowSlug
  logActivity({
    ...actorFrom(req), action: 'order.status_changed', targetType: 'order', targetId: req.params.rowSlug, targetLabel: label,
    metadata: { from: previous?.status || 'pending', to: status, note: note || null },
  })
  res.json({ ok: true, rowSlug: req.params.rowSlug, status })
})

// ── Manually-entered orders (not sourced from Formaloo) ────────────────────────

router.post('/manual', async (req, res) => {
  try {
    const { companyName, orderNumber, googleReviewUrl, whatsapp, email, phone, address, orderedStand, orderedCard, logo } = req.body
    if (!companyName?.trim()) return res.status(400).json({ error: 'companyName is required' })
    const rowSlug = `manual_${nanoid(12)}`
    let logoUrl = null
    if (logo) logoUrl = await uploadLogo(rowSlug, logo)
    const row = await createManualOrder({
      row_slug: rowSlug,
      order_number: (orderNumber || '').trim() || null,
      company_name: companyName.trim(),
      logo_url: logoUrl,
      google_review_url: (googleReviewUrl || '').trim() || null,
      whatsapp: (whatsapp || '').trim() || null,
      email: (email || '').trim() || null,
      phone: (phone || '').trim() || null,
      address: (address || '').trim() || null,
      ordered_stand: !!orderedStand,
      ordered_card: !!orderedCard,
      created_by: req.user?.id || null,
    })
    logActivity({ ...actorFrom(req), action: 'manualOrder.created', targetType: 'order', targetId: rowSlug, targetLabel: row.company_name })
    res.status(201).json(toOrderShape(row))
  } catch (err) {
    console.error('manual order create failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/manual/:rowSlug', async (req, res) => {
  try {
    const existing = await getManualOrder(req.params.rowSlug)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const { companyName, orderNumber, googleReviewUrl, whatsapp, email, phone, address, orderedStand, orderedCard, logo } = req.body
    const fields = {
      companyName: companyName?.trim(), orderNumber: (orderNumber ?? '').trim() || null,
      googleReviewUrl: (googleReviewUrl ?? '').trim() || null, whatsapp: (whatsapp ?? '').trim() || null,
      email: (email ?? '').trim() || null, phone: (phone ?? '').trim() || null, address: (address ?? '').trim() || null,
      orderedStand: orderedStand !== undefined ? !!orderedStand : undefined,
      orderedCard: orderedCard !== undefined ? !!orderedCard : undefined,
    }
    if (logo) fields.logoUrl = await uploadLogo(req.params.rowSlug, logo)
    const row = await updateManualOrder(req.params.rowSlug, fields)
    logActivity({ ...actorFrom(req), action: 'manualOrder.updated', targetType: 'order', targetId: req.params.rowSlug, targetLabel: row.company_name })
    res.json(toOrderShape(row))
  } catch (err) {
    console.error('manual order update failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/manual/:rowSlug', async (req, res) => {
  try {
    const existing = await getManualOrder(req.params.rowSlug)
    await deleteManualOrder(req.params.rowSlug)
    if (existing) logActivity({ ...actorFrom(req), action: 'manualOrder.deleted', targetType: 'order', targetId: req.params.rowSlug, targetLabel: existing.company_name })
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
