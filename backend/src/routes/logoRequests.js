// Authenticated: generate a "send us your logo" link for a manual order.
// The CLIENT-facing page lives on the public /logo-request/:token route instead.
import express from 'express'
import { nanoid } from 'nanoid'
import { setLogoRequestToken, getManualOrder } from '../services/manualOrders.js'
import { normalizePhone } from '../services/ghl.js'
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
    })
  } catch (err) {
    console.error('logo request create failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
