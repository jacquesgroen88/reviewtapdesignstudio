import express from 'express'
import { fetchOrders, fetchOrder } from '../services/formaloo.js'
import { getOrderStatus, setOrderStatus, getAllOrderStatuses, getDesignsForOrder, saveDesign, listDesignedProducts } from '../services/database.js'

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

    const statuses  = await getAllOrderStatuses()
    const statusMap = Object.fromEntries(statuses.map(s => [s.row_slug, s]))
    const designedMap = await listDesignedProducts()

    const enriched = orders.map(order => ({
      ...order,
      status: statusMap[order.rowSlug]?.status ?? (order.orderedStand || order.orderedCard ? 'pending' : 'not_needed'),
      note:   statusMap[order.rowSlug]?.note   ?? null,
      designedProducts: designedMap[order.rowSlug] ?? [],
      hasDesign: !!designedMap[order.rowSlug]?.length,
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

// GET all saved designs (one per product) for an order
router.get('/:rowSlug/designs', async (req, res) => {
  try {
    res.json(await getDesignsForOrder(req.params.rowSlug))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT saved design
router.put('/:rowSlug/design', async (req, res) => {
  try {
    const { productId, variantId, design } = req.body
    if (!productId || !variantId || !design) return res.status(400).json({ error: 'productId, variantId, design required' })
    await saveDesign(req.params.rowSlug, productId, variantId, design)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:rowSlug/status', async (req, res) => {
  const { status, note } = req.body
  const valid = ['pending', 'pending_approval', 'pending_print', 'done', 'skipped']
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` })
  await setOrderStatus(req.params.rowSlug, status, note)
  res.json({ ok: true, rowSlug: req.params.rowSlug, status })
})

export default router
