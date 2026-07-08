import express from 'express'
import { nanoid } from 'nanoid'
import { fetchOrders, fetchOrder } from '../services/formaloo.js'
import { getOrderStatus, setOrderStatus, getAllOrderStatuses, listDesignsByOwner, getProfileNames } from '../services/database.js'
import { approvalSummaryByDesign } from '../services/approvals.js'
import {
  listManualOrders, getManualOrder, createManualOrder, updateManualOrder, deleteManualOrder, uploadLogo,
} from '../services/manualOrders.js'

const router = express.Router()

const VALID_STATUSES = ['pending', 'ready', 'pending_approval', 'pending_print', 'done', 'skipped']

// Shared enrichment for BOTH Formaloo and manually-entered orders — one place
// joins status/designs/approvals so the two sources behave identically.
function enrichOrder(order, { statusMap, designsMap, names, approvalMap }) {
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

router.get('/', async (req, res) => {
  try {
    const page     = parseInt(req.query.page)     || 1
    const pageSize = parseInt(req.query.pageSize) || 50
    const filter   = req.query.filter             || 'all'
    const search   = (req.query.search || '').trim().toLowerCase()

    // When searching, pull a large batch so we match across all submissions
    const onlyDesignNeeded = filter !== 'all'
    const fetchPage     = search ? 1   : page
    const fetchPageSize = search ? 300 : pageSize
    const { orders, count } = await fetchOrders({ page: fetchPage, pageSize: fetchPageSize, onlyDesignNeeded })

    const [statuses, designsMap, names, approvalMap, manualRaw] = await Promise.all([
      getAllOrderStatuses(), listDesignsByOwner(), getProfileNames(),
      approvalSummaryByDesign().catch(() => ({})),
      listManualOrders().catch(() => []),
    ])
    const statusMap = Object.fromEntries(statuses.map(s => [s.row_slug, s]))
    const ctx = { statusMap, designsMap, names, approvalMap }

    const enriched = orders.map(order => enrichOrder(order, ctx))
    let result
    if (filter === 'done')              result = enriched.filter(o => o.status === 'done')
    else if (filter === 'needs_design') result = enriched.filter(o => !['done', 'skipped'].includes(o.status))
    else                                result = enriched   // 'all'
    if (search) {
      result = result.filter(o =>
        (o.companyName || '').toLowerCase().includes(search) ||
        String(o.orderNumber || '').toLowerCase().includes(search))
    }

    // Manually-entered orders aren't part of Formaloo's server-side pagination
    // (there are typically only a handful), so they're shown in full — on
    // page 1 of a normal browse, and always when searching — rather than
    // sliced into Formaloo's page windows. The total count includes them.
    let manualResult = manualRaw.map(toOrderShape).map(o => enrichOrder(o, ctx))
    if (filter === 'done')              manualResult = manualResult.filter(o => o.status === 'done')
    else if (filter === 'needs_design') manualResult = manualResult.filter(o => !['done', 'skipped'].includes(o.status))
    if (search) {
      manualResult = manualResult.filter(o =>
        (o.companyName || '').toLowerCase().includes(search) ||
        String(o.orderNumber || '').toLowerCase().includes(search))
    }
    if (search || fetchPage === 1) result = [...manualResult, ...result]

    res.json({ orders: result, count: (search ? result.length : count + manualResult.length), page: fetchPage, pageSize: fetchPageSize })
  } catch (err) {
    console.error('Orders fetch error:', err.message)
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
  const { status, note } = req.body
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })
  await setOrderStatus(req.params.rowSlug, status, note)
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
    res.json(toOrderShape(row))
  } catch (err) {
    console.error('manual order update failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/manual/:rowSlug', async (req, res) => {
  try {
    await deleteManualOrder(req.params.rowSlug)
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
