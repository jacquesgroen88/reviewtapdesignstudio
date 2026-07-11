// Authenticated: generate a "send us your logo" link for a manual order.
// The CLIENT-facing page lives on the public /logo-request/:token route instead.
import express from 'express'
import { nanoid } from 'nanoid'
import { setLogoRequestToken, getManualOrder, getManualOrderByToken } from '../services/manualOrders.js'
import { normalizePhone, ghlLogoConfigured, sendLogoRequestViaGhl } from '../services/ghl.js'
import { logActivity } from '../services/activityLog.js'

const router = express.Router()

const PUBLIC_BASE = () => process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'

function buildWaUrl({ whatsapp, companyName, orderNumber, url }) {
  const phone = normalizePhone(whatsapp)
  const msg = `Hi ${companyName || 'there'}, thanks for your ReviewTap order${orderNumber ? ` (#${orderNumber})` : ''}! We just need your logo to get your design started — pop it in here: ${url}`
  const base = phone ? `https://wa.me/${phone.replace('+', '')}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(msg)}`
}

// body: { rowSlug }
router.post('/', async (req, res) => {
  try {
    const { rowSlug } = req.body || {}
    if (!rowSlug) return res.status(400).json({ error: 'rowSlug required' })
    const order = await getManualOrder(rowSlug)
    if (!order) return res.status(404).json({ error: 'Order not found' })

    const token = order.request_token || nanoid(21)
    const updated = order.request_token ? order : await setLogoRequestToken(rowSlug, token)

    const url = `${PUBLIC_BASE()}/logo-request/${token}`
    logActivity({
      actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null,
      action: 'logoRequest.sent', targetType: 'order', targetId: rowSlug, targetLabel: updated.company_name,
    })
    res.status(201).json({
      token,
      url,
      waUrl: buildWaUrl({ whatsapp: updated.whatsapp, companyName: updated.company_name, orderNumber: updated.order_number, url }),
      ghlAvailable: ghlLogoConfigured() && !!updated.whatsapp,
    })
  } catch (err) {
    console.error('logo request create failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Auto-send via the Reviewtap System (GHL): writes the upload link to the
// contact's rt_logo_upload field and enrolls them in the logo-request
// workflow, which sends the logo_request WhatsApp template. The manual
// wa.me/copy-link options stay available regardless.
router.post('/:token/send-ghl', async (req, res) => {
  try {
    if (!ghlLogoConfigured()) return res.status(503).json({ error: 'Reviewtap System sending not configured yet — use the WhatsApp button' })
    const order = await getManualOrderByToken(req.params.token)
    if (!order) return res.status(404).json({ error: 'Not found' })
    if (!order.whatsapp) return res.status(400).json({ error: 'No WhatsApp number on this order' })
    const url = `${PUBLIC_BASE()}/logo-request/${order.request_token}`
    const contact = await sendLogoRequestViaGhl({ clientName: order.company_name, phone: order.whatsapp, url })
    logActivity({
      actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null,
      action: 'logoRequest.sent', targetType: 'order', targetId: order.row_slug, targetLabel: order.company_name,
      metadata: { via: 'ghl' },
    })
    res.json({ ok: true, contactId: contact.id })
  } catch (err) {
    console.error('GHL logo-request send failed:', err.response?.data || err.message)
    res.status(502).json({ error: `Reviewtap System send failed: ${err.response?.data?.message || err.message}` })
  }
})

export default router
