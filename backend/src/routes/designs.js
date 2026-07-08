import express from 'express'
import { nanoid } from 'nanoid'
import { listDesigns, getDesign, createDesign, updateDesign, deleteDesign, getAllOrderStatuses, getProfileNames } from '../services/database.js'

const router = express.Router()

// Library list (metadata only). ?owner=<slug> to scope to one order/job.
// Each design linked to an order carries that order's status as order_status
// (e.g. pending_print = client approved, ready to print) for library filters.
router.get('/', async (req, res) => {
  try {
    const [designs, statuses, names] = await Promise.all([
      listDesigns({ owner: req.query.owner }),
      getAllOrderStatuses(),
      getProfileNames(),
    ])
    const statusBySlug = Object.fromEntries(statuses.map(s => [s.row_slug, s.status]))
    res.json(designs.map(d => ({
      ...d,
      order_status: d.owner_slug ? statusBySlug[d.owner_slug] || 'pending' : null,
      created_by_name: d.created_by ? names[d.created_by] || null : null,
      updated_by_name: d.updated_by ? names[d.updated_by] || null : null,
    })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Full design (includes the design JSONB)
router.get('/:id', async (req, res) => {
  try {
    const d = await getDesign(req.params.id)
    if (!d) return res.status(404).json({ error: 'Not found' })
    res.json(d)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Create — creator stamped server-side from the session, never client-sent
router.post('/', async (req, res) => {
  try {
    const { name, ownerSlug, productId, variantId, design, orderNumber } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name required' })
    if (!productId || !variantId || !design) return res.status(400).json({ error: 'productId, variantId, design required' })
    const id = `design_${nanoid(10)}`
    res.status(201).json(await createDesign({
      id, name: name.trim(), ownerSlug: ownerSlug || null, productId, variantId, design,
      orderNumber: (orderNumber || '').trim() || null,
      createdBy: req.user?.id,
    }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Update (rename / replace canvas / change variant) — stamps last editor
router.put('/:id', async (req, res) => {
  try {
    const d = await getDesign(req.params.id)
    if (!d) return res.status(404).json({ error: 'Not found' })
    res.json(await updateDesign(req.params.id, { ...req.body, updatedBy: req.user?.id }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', async (req, res) => {
  try {
    await deleteDesign(req.params.id)
    res.status(204).end()
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Duplicate an existing design (new id, copies everything)
router.post('/:id/duplicate', async (req, res) => {
  try {
    const src = await getDesign(req.params.id)
    if (!src) return res.status(404).json({ error: 'Not found' })
    const id = `design_${nanoid(10)}`
    const name = (req.body?.name || `${src.name} (copy)`).trim()
    res.status(201).json(await createDesign({
      id, name, ownerSlug: src.owner_slug, productId: src.product_id, variantId: src.variant_id, design: src.design,
      orderNumber: src.order_number, createdBy: req.user?.id,
    }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
