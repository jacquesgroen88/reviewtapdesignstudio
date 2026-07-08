import express from 'express'
import { fetchOrders, fetchOrder } from '../services/formaloo.js'
import { getOrderStatus, setOrderStatus, getAllOrderStatuses, listDesignsByOwner, getProfileNames } from '../services/database.js'
import { approvalSummaryByDesign } from '../services/approvals.js'

const router = express.Router()

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

    const [statuses, designsMap, names, approvalMap] = await Promise.all([
      getAllOrderStatuses(), listDesignsByOwner(), getProfileNames(),
      approvalSummaryByDesign().catch(() => ({})),
    ])
    const statusMap = Object.fromEntries(statuses.map(s => [s.row_slug, s]))

    const enriched = orders.map(order => ({
      ...order,
      status: statusMap[order.rowSlug]?.status ?? (order.orderedStand || order.orderedCard ? 'pending' : 'not_needed'),
      note:   statusMap[order.rowSlug]?.note   ?? null,
      designs: (designsMap[order.rowSlug] ?? []).map(d => ({
        ...d,
        created_by_name: d.created_by ? names[d.created_by] || null : null,
        approval: approvalMap[d.id] || null,
      })),
      hasDesign: !!designsMap[order.rowSlug]?.length,
    }))

    let result
    if (filter === 'done')              result = enriched.filter(o => o.status === 'done')
    else if (filter === 'needs_design') result = enriched.filter(o => !['done', 'skipped'].includes(o.status))
    else                                result = enriched   // 'all'

    if (search) {
      result = result.filter(o =>
        (o.companyName || '').toLowerCase().includes(search) ||
        String(o.orderNumber || '').toLowerCase().includes(search))
    }

    res.json({ orders: result, count: search ? result.length : count, page: fetchPage, pageSize: fetchPageSize })
  } catch (err) {
    console.error('Orders fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/:rowSlug', async (req, res) => {
  try {
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
  const valid = ['pending', 'pending_approval', 'pending_print', 'done', 'skipped']
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` })
  await setOrderStatus(req.params.rowSlug, status, note)
  res.json({ ok: true, rowSlug: req.params.rowSlug, status })
})

export default router
