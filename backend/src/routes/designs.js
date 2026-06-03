import express from 'express'
import { nanoid } from 'nanoid'
import { listDesigns, getDesign, createDesign, updateDesign, deleteDesign } from '../services/database.js'

const router = express.Router()

// Library list (metadata only). ?owner=<slug> to scope to one order/job.
router.get('/', async (req, res) => {
  try {
    res.json(await listDesigns({ owner: req.query.owner }))
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

// Create
router.post('/', async (req, res) => {
  try {
    const { name, ownerSlug, productId, variantId, design } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name required' })
    if (!productId || !variantId || !design) return res.status(400).json({ error: 'productId, variantId, design required' })
    const id = `design_${nanoid(10)}`
    res.status(201).json(await createDesign({ id, name: name.trim(), ownerSlug: ownerSlug || null, productId, variantId, design }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Update (rename / replace canvas / change variant)
router.put('/:id', async (req, res) => {
  try {
    const d = await getDesign(req.params.id)
    if (!d) return res.status(404).json({ error: 'Not found' })
    res.json(await updateDesign(req.params.id, req.body))
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
    }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
