import express from 'express'
import { fetchOrders, fetchOrder } from '../services/formaloo.js'
import { getOrderStatus, setOrderStatus, getAllOrderStatuses, getDesign, saveDesign, listDesignSlugs } from '../services/database.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const page     = parseInt(req.query.page)     || 1
    const pageSize = parseInt(req.query.pageSize) || 50
    const filter   = req.query.filter             || 'all'

    const onlyDesignNeeded = ['needs_design', 'pending', 'done'].includes(filter)
    const { orders, count } = await fetchOrders({ page, pageSize, onlyDesignNeeded })

    const statuses  = await getAllOrderStatuses()
    const statusMap = Object.fromEntries(statuses.map(s => [s.row_slug, s]))
    const designSlugs = new Set(await listDesignSlugs())

    const enriched = orders.map(order => ({
      ...order,
      status: statusMap[order.rowSlug]?.status ?? (order.orderedStand || order.orderedCard ? 'pending' : 'not_needed'),
      note:   statusMap[order.rowSlug]?.note   ?? null,
      hasDesign: designSlugs.has(order.rowSlug),
    }))

    const filtered = (filter === 'all' || filter === 'needs_design')
      ? enriched
      : enriched.filter(o => o.status === filter)

    res.json({ orders: filtered, count, page, pageSize })
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

// GET saved design (canvas state) for an order
router.get('/:rowSlug/design', async (req, res) => {
  try {
    const d = await getDesign(req.params.rowSlug)
    res.json(d || null)
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
  const valid = ['pending', 'in_progress', 'done', 'skipped']
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` })
  await setOrderStatus(req.params.rowSlug, status, note)
  res.json({ ok: true, rowSlug: req.params.rowSlug, status })
})

export default router
