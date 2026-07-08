import express from 'express'
import { nanoid } from 'nanoid'
import { listDesigns, getDesign, createDesign, updateDesign, deleteDesign, getAllOrderStatuses, getProfileNames, setOrderStatus } from '../services/database.js'
import { supersedeForDesigns } from '../services/approvals.js'

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

// Update (rename / replace canvas / change variant) — stamps last editor.
// Version lock (Feature F): changing the ARTWORK invalidates open approval
// links for this design, and the order goes back to needing approval —
// nothing ever prints against a stale client "yes".
router.put('/:id', async (req, res) => {
  try {
    const d = await getDesign(req.params.id)
    if (!d) return res.status(404).json({ error: 'Not found' })
    const updated = await updateDesign(req.params.id, { ...req.body, updatedBy: req.user?.id })
    if (req.body.design !== undefined) {
      supersedeForDesigns([req.params.id]).catch(err => console.error('supersede failed:', err.message))
      if (d.owner_slug) setOrderStatus(d.owner_slug, 'pending_approval', 'Design updated — needs (re)approval').catch(() => {})
    }
    res.json(updated)
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
