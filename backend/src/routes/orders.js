import express from 'express'
import { nanoid } from 'nanoid'
import { fetchOrders, fetchOrder } from '../services/formaloo.js'
import { getOrderStatus, setOrderStatus, getAllOrderStatuses, listDesignsByOwner, getProfileNames } from '../services/database.js'
import { approvalSummaryByDesign } from '../services/approvals.js'
import {
  listManualOrders, getManualOrder, createManualOrder, updateManualOrder, deleteManualOrder, uploadLogo,
} from '../services/manualOrders.js'
import { fetchOpenShopifyOrders } from '../services/shopify.js'
import { logActivity } from '../services/activityLog.js'

const router = express.Router()

function actorFrom(req) {
  return { actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null }
}

const VALID_STATUSES = ['pending', 'ready', 'pending_approval', 'pending_print', 'done', 'skipped']

// Shared enrichment for BOTH Formaloo and manually-entered orders — one place
// joins status/designs/approvals so the two sources behave identically.
function enrichOrder(order, { statusMap, designsMap, names, approvalMap, shopifyMap = {} }) {
  return {
    ...order,
    status: statusMap[order.rowSlug]?.status ?? (order.orderedStand || order.orderedCard ? 'pending' : 'not_needed'),
    note:   statusMap[order.rowSlug]?.note   ?? null,
    designs: (designsMap[order.rowSlug] ?? []).map(d => ({
      ...d,
      created_by_name: d.created_by ? names[d.created_by] || null : null,
      approval: approvalMap[d.id] || null,
    })),
    hasDesign: !!designsMap[order.rowSlug]?.length,
    shopify: shopifyMap[String(order.orderNumber || '').replace(/^#/, '')] || null,
  }
}

function toOrderShape(m) {
  return {
    rowSlug: m.row_slug, orderNumber: m.order_number, companyName: m.company_name,
    logoUrl: m.logo_url, googleReviewUrl: m.google_review_url, whatsapp: m.whatsapp,
    cardEmail: m.email, cardPhone: m.phone, cardAddress: m.address,
    orderedStand: m.ordered_stand, orderedCard: m.ordered_card,
    submittedAt: m.created_at, source: 'manual',
  }
}

// Filter tabs map to real order_status values, except 'awaiting_logo' which is
// about the order having no logo file at all (independent of status) and
// 'all'/'' which means no filter. 'approved' reads as 'pending_print' — that's
// the status set when a client approves via the approval link; the UI label
// is friendlier than the internal print-queue name.
const STATUS_FILTER_MAP = {
  ready: 'ready',
  pending_approval: 'pending_approval',
  approved: 'pending_print',
  done: 'done',
}

function matchesFilter(order, filter) {
  if (!filter || filter === 'all') return true
  // Must ALSO have ordered a stand/card — plenty of Formaloo submissions never
  // ordered anything (orderedStand/orderedCard both false) and legitimately
  // have no logo; without this check they flooded the tab (found while
  // testing search: 132 "awaiting logo" results instead of the real ~30).
  if (filter === 'awaiting_logo') return !order.logoUrl && (order.orderedStand || order.orderedCard)
  const target = STATUS_FILTER_MAP[filter]
  return target ? order.status === target : true
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

    // A specific status/awaiting-logo filter (or a search) needs to scan
    // beyond one page's chronological window of Formaloo submissions — pull a
    // large batch and filter in-memory instead of relying on Formaloo's own
    // pagination, same as search already did.
    const needsFullScan  = filter !== 'all' || !!search
    const onlyDesignNeeded = filter !== 'all'
    const fetchPage     = needsFullScan ? 1   : page
    const fetchPageSize = needsFullScan ? 500 : pageSize
    const { orders, count } = await fetchOrders({ page: fetchPage, pageSize: fetchPageSize, onlyDesignNeeded })

    const [statuses, designsMap, names, approvalMap, manualRaw, shopifyMap] = await Promise.all([
      getAllOrderStatuses(), listDesignsByOwner(), getProfileNames(),
      approvalSummaryByDesign().catch(() => ({})),
      listManualOrders().catch(() => []),
      fetchOpenShopifyOrders().catch(err => { console.error('Shopify sync error:', err.message); return {} }),
    ])
    const statusMap = Object.fromEntries(statuses.map(s => [s.row_slug, s]))
    const ctx = { statusMap, designsMap, names, approvalMap, shopifyMap }

    const enriched = orders.map(order => enrichOrder(order, ctx))
      .filter(o => matchesFilter(o, filter)).filter(o => matchesSearch(o, search))

    // Manually-entered orders aren't part of Formaloo's server-side pagination
    // (there are typically only a handful), so they're shown in full — on
    // page 1 of a normal browse, and always when searching/filtering — rather
    // than sliced into Formaloo's page windows.
    let manualResult = manualRaw.map(toOrderShape).map(o => enrichOrder(o, ctx))
      .filter(o => matchesFilter(o, filter)).filter(o => matchesSearch(o, search))

    let result, total
    if (needsFullScan) {
      result = [...manualResult, ...enriched]
      total = result.length
    } else {
      result = fetchPage === 1 ? [...manualResult, ...enriched] : enriched
      total = count + manualResult.length
    }

    res.json({ orders: result, count: total, page: fetchPage, pageSize: fetchPageSize })
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
      fetchOrders({ page: 1, pageSize: 500 }),
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
    const manual = await getManualOrder(req.params.rowSlug)
    if (manual) {
      const local = await getOrderStatus(req.params.rowSlug)
      return res.json({ ...toOrderShape(manual), status: local?.status ?? 'pending', note: local?.note ?? null })
    }
    const order = await fetchOrder(req.params.rowSlug)
    const local = await getOrderStatus(req.params.rowSlug)
    res.json({ ...order, status: local?.status ?? 'pending', note: local?.note ?? null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// (Design read/write moved to /api/designs — designs are first-class now.)

router.patch('/:rowSlug/status', async (req, res) => {
  const { status, note, companyName, orderNumber } = req.body
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })
  const previous = await getOrderStatus(req.params.rowSlug)
  await setOrderStatus(req.params.rowSlug, status, note)
  // companyName/orderNumber come from the order card already in view — avoids
  // an extra Formaloo round-trip just to label the log entry.
  const label = companyName ? `${companyName}${orderNumber ? ` (#${orderNumber})` : ''}` : req.params.rowSlug
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
