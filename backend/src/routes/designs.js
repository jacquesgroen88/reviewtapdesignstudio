import express from 'express'
import { nanoid } from 'nanoid'
import { listDesigns, getDesign, createDesign, updateDesign, deleteDesign, getAllOrderStatuses, getProfileNames, setOrderStatus } from '../services/database.js'
import { supersedeForDesigns } from '../services/approvals.js'
import { logActivity } from '../services/activityLog.js'

function actorFrom(req) {
  return { actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null }
}

// Design events target the DESIGN, but the order-history endpoint queries by
// order. Stamp the owning order into metadata at write time so the link
// survives the design being deleted later (target_id would no longer resolve).
// Historic rows were backfilled from designs.owner_slug on 2026-07-17.
// Deliberately NOT falling back to order_number: it is not a reliable key to an
// order (see CLAUDE.md "order_number is not an order key").
const ownerMeta = (ownerSlug, extra = null) =>
  ownerSlug ? { ...(extra || {}), ownerSlug } : extra

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
    const created = await createDesign({
      id, name: name.trim(), ownerSlug: ownerSlug || null, productId, variantId, design,
      orderNumber: (orderNumber || '').trim() || null,
      createdBy: req.user?.id,
    })
    logActivity({ ...actorFrom(req), action: 'design.created', targetType: 'design', targetId: id, targetLabel: created.name, metadata: ownerMeta(created.owner_slug) })
    res.status(201).json(created)
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
    logActivity({ ...actorFrom(req), action: 'design.updated', targetType: 'design', targetId: req.params.id, targetLabel: updated.name, metadata: ownerMeta(updated.owner_slug ?? d.owner_slug) })
    res.json(updated)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', async (req, res) => {
  try {
    const d = await getDesign(req.params.id)
    await deleteDesign(req.params.id)
    if (d) logActivity({ ...actorFrom(req), action: 'design.deleted', targetType: 'design', targetId: req.params.id, targetLabel: d.name, metadata: ownerMeta(d.owner_slug) })
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
    const created = await createDesign({
      id, name, ownerSlug: src.owner_slug, productId: src.product_id, variantId: src.variant_id, design: src.design,
      orderNumber: src.order_number, createdBy: req.user?.id,
    })
    logActivity({ ...actorFrom(req), action: 'design.duplicated', targetType: 'design', targetId: id, targetLabel: created.name, metadata: ownerMeta(created.owner_slug, { fromDesignId: src.id }) })
    res.status(201).json(created)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
