// PUBLIC client-facing logo-request page — local-dev Express version.
// On Netlify the standalone logo-request.js function serves this instead
// (same pattern as /approve and /r). NEVER behind auth: clients have no login.
import express from 'express'
import { getManualOrderByToken, fulfillLogoRequest, uploadLogo } from '../services/manualOrders.js'
import { renderLogoRequestPage } from '../services/logoRequestPage.js'

const router = express.Router()

const NOT_FOUND = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h2>Link not found</h2><p>This link may have expired or is invalid.</p></body></html>`

router.get('/:token', async (req, res) => {
  try {
    const order = await getManualOrderByToken(req.params.token)
    if (!order) return res.status(404).type('html').send(NOT_FOUND)
    const publicBase = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
    res.type('html').send(renderLogoRequestPage(order, publicBase))
  } catch (err) {
    console.error('logo request page failed:', err.message)
    res.status(500).type('html').send(NOT_FOUND)
  }
})

router.post('/:token/submit', async (req, res) => {
  try {
    const order = await getManualOrderByToken(req.params.token)
    if (!order) return res.status(404).json({ error: 'Not found' })
    const { logo, businessName } = req.body || {}
    if (!logo) return res.status(400).json({ error: 'logo required' })
    const logoUrl = await uploadLogo(order.row_slug, logo)
    await fulfillLogoRequest(req.params.token, { logoUrl, businessName })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

export default router
