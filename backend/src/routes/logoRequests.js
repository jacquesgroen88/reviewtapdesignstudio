// Authenticated: generate a "send us your logo" link for a manual order.
// The CLIENT-facing page lives on the public /logo-request/:token route instead.
import express from 'express'
import { nanoid } from 'nanoid'
import { setLogoRequestToken, getManualOrder, getManualOrderByToken } from '../services/manualOrders.js'
import { normalizePhone, ghlLogoConfigured, sendLogoRequestViaGhl } from '../services/ghl.js'
import { logActivity } from '../services/activityLog.js'
import { bareOrderNumber } from '../lib/orderNumber.js'

const router = express.Router()

const PUBLIC_BASE = () => process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'

function buildWaUrl({ whatsapp, companyName, orderNumber, url }) {
  const phone = normalizePhone(whatsapp)
  const msg = `Hi ${companyName || 'there'}, thanks for your ReviewTap order${bareOrderNumber(orderNumber) ? ` (#${bareOrderNumber(orderNumber)})` : ''}! We just need your logo to get your design started — pop it in here: ${url}`
  const base = phone ? `https://wa.me/${phone.replace('+', '')}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(msg)}`
}

// Which page a chase link points at (spec 2026-07-17 step 6): orders with an
// order number get the tokenless /setup page — the same front door the Shopify
// receipt now carries, which also handles multi-location orders. Walk-ins with
// no order number keep the token page: /setup has nothing to resolve them by.
function chaseUrl(order, token) {
  const bare = bareOrderNumber(order.order_number)
  return bare ? `${PUBLIC_BASE()}/setup/${bare}` : `${PUBLIC_BASE()}/logo-request/${token}`
}

// body: { rowSlug }
router.post('/', async (req, res) => {
  try {
    const { rowSlug } = req.body || {}
    if (!rowSlug) return res.status(400).json({ error: 'rowSlug required' })
    const order = await getManualOrder(rowSlug)
    if (!order) return res.status(404).json({ error: 'Order not found' })

    // The token is still minted even when /setup is the link — it keeps the
    // request_sent_at trail (which the Awaiting Client tab anchors on) and the
    // token page working as a fallback.
    const token = order.request_token || nanoid(21)
    const updated = order.request_token ? order : await setLogoRequestToken(rowSlug, token)

    const url = chaseUrl(updated, token)
    // NOT 'logoRequest.sent' — this only mints the link and opens the share
    // modal; nothing has reached the customer yet. See the 2026-07-17 spec §G2.
    logActivity({
      actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null,
      action: 'logoRequest.link_created', targetType: 'order', targetId: rowSlug, targetLabel: updated.company_name,
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
// workflow, which sends the logo_request WhatsApp template. This is the DEFAULT
// send path as of 2026-07-17; wa.me/copy-link remain as a demoted fallback and
// log *.shared when used.
router.post('/:token/send-ghl', async (req, res) => {
  try {
    if (!ghlLogoConfigured()) return res.status(503).json({ error: 'Reviewtap System sending not configured yet — use the WhatsApp button' })
    const order = await getManualOrderByToken(req.params.token)
    if (!order) return res.status(404).json({ error: 'Not found' })
    if (!order.whatsapp) return res.status(400).json({ error: 'No WhatsApp number on this order' })
    const url = chaseUrl(order, order.request_token)
    const contact = await sendLogoRequestViaGhl({ clientName: order.company_name, phone: order.whatsapp, url, orderNumber: order.order_number })
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

// The team clicked "copy link" or the wa.me button — i.e. shared this OUTSIDE
// the Reviewtap System, from a personal WhatsApp. Records that a share was
// ATTEMPTED: a wa.me click opens WhatsApp with a prefilled message and proves
// intent, never delivery (the sender can still close it or edit the text), so
// the UI must never render this as "delivered". Since GHL became the default
// send path (2026-07-17), this doubles as a leak signal — it tells us how often
// comms still bypass GHL, and on which orders. Review the counts ~mid-Aug 2026.
router.post('/:token/shared', async (req, res) => {
  try {
    const channel = req.body?.channel === 'whatsapp' ? 'whatsapp' : 'copy'
    const order = await getManualOrderByToken(req.params.token)
    if (!order) return res.status(404).json({ error: 'Not found' })
    logActivity({
      actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null,
      action: 'logoRequest.shared', targetType: 'order', targetId: order.row_slug, targetLabel: order.company_name,
      metadata: { channel },
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('logo-request share log failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
