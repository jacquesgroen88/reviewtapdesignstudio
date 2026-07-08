// Authenticated approval management (creating + sending).
// The CLIENT-facing page lives on the public /approve/:token route instead.
import express from 'express'
import { nanoid } from 'nanoid'
import { getDesign, setOrderStatus } from '../services/database.js'
import { fetchOrder } from '../services/formaloo.js'
import {
  createApproval, getApproval, uploadMockup, supersedeForDesigns,
} from '../services/approvals.js'
import { ghlConfigured, upsertContact, sendApprovalTemplate, normalizePhone } from '../services/ghl.js'

const router = express.Router()

const PUBLIC_BASE = () => process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'

function buildWaUrl({ whatsapp, clientName, orderNumber, url, count }) {
  const phone = normalizePhone(whatsapp)
  const plural = count > 1
  const msg = `Hi ${clientName || 'there'}, your ReviewTap design${plural ? 's are' : ' is'} ready to view!${orderNumber ? ` (Order #${orderNumber})` : ''} Open the link to approve or request changes: ${url}`
  const base = phone ? `https://wa.me/${phone.replace('+', '')}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(msg)}`
}

// Create an approval link for one or more designs.
// body: { items: [{designId, mockups: [dataURL,...]}], ownerSlug?, clientName?, whatsapp?, orderNumber? }
router.post('/', async (req, res) => {
  try {
    const { items, ownerSlug } = req.body
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' })

    // Enrich client details from the linked Formaloo order when not supplied
    let { clientName, whatsapp, orderNumber } = req.body
    if (ownerSlug && (!clientName || !whatsapp)) {
      try {
        const order = await fetchOrder(ownerSlug)
        clientName  = clientName  || order?.companyName
        whatsapp    = whatsapp    || order?.whatsapp
        orderNumber = orderNumber || order?.orderNumber
      } catch { /* order enrichment is best-effort */ }
    }

    const token = nanoid(21)
    const storedItems = []
    for (const it of items) {
      const design = await getDesign(it.designId)
      if (!design) return res.status(404).json({ error: `design ${it.designId} not found` })
      if (!Array.isArray(it.mockups) || !it.mockups.length) return res.status(400).json({ error: 'each item needs mockups' })
      const paths = []
      for (let f = 0; f < it.mockups.length; f++) {
        paths.push(await uploadMockup(`${token}/${design.id}_${f}.png`, it.mockups[f]))
      }
      storedItems.push({
        design_id: design.id,
        name: design.name,
        product_id: design.product_id,
        variant_id: design.variant_id,
        mockups: paths,
        snapshot: design.design,        // version lock: exactly what the client saw
        response: null, responded_at: null, comment: null,
      })
      orderNumber = orderNumber || design.order_number
    }

    // Older open links for these designs are now stale
    await supersedeForDesigns(storedItems.map(i => i.design_id))

    const approval = await createApproval({
      token,
      owner_slug: ownerSlug || null,
      order_number: (orderNumber || '').toString().replace(/^#/, '') || null,
      client_name: clientName || null,
      whatsapp: whatsapp || null,
      items: storedItems,
      sent_by: req.user?.id || null,
    })

    // Sending an approval means the order is now awaiting the client
    if (ownerSlug) setOrderStatus(ownerSlug, 'pending_approval', 'Approval link sent').catch(() => {})

    const url = `${PUBLIC_BASE()}/approve/${token}`
    res.status(201).json({
      token,
      url,
      waUrl: buildWaUrl({ whatsapp, clientName, orderNumber: approval.order_number, url, count: storedItems.length }),
      ghlAvailable: ghlConfigured() && !!whatsapp,
    })
  } catch (err) {
    console.error('approval create failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Auto-send via the Reviewtap System (GHL) — requires the approved template
router.post('/:token/send-ghl', async (req, res) => {
  try {
    if (!ghlConfigured()) return res.status(503).json({ error: 'Reviewtap System sending not configured yet — use the WhatsApp button' })
    const approval = await getApproval(req.params.token)
    if (!approval) return res.status(404).json({ error: 'Not found' })
    if (!approval.whatsapp) return res.status(400).json({ error: 'No WhatsApp number on this approval' })
    const contact = await upsertContact({ name: approval.client_name, phone: approval.whatsapp })
    const url = `${PUBLIC_BASE()}/approve/${approval.token}`
    await sendApprovalTemplate({
      contactId: contact.id,
      clientName: approval.client_name,
      orderNumber: approval.order_number,
      url,
    })
    res.json({ ok: true, contactId: contact.id })
  } catch (err) {
    console.error('GHL send failed:', err.response?.data || err.message)
    res.status(502).json({ error: `Reviewtap System send failed: ${err.response?.data?.message || err.message}` })
  }
})

export default router
