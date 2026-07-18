// PUBLIC /setup/:orderNumber — the self-hosted onboarding front door
// (local-dev Express version; netlify/functions/setup.js serves production —
// TWIN files, keep the route surface in step).
// Tokenless by design (spec §4.0: the Shopify receipt can render an order
// number but not a token) and NEVER behind auth: customers have no login.
import express from 'express'
import { getSetupState, submitSetup, submitSetupLogo } from '../services/setup.js'
import { renderSetupPage, renderSetupNotFound } from '../services/setupPage.js'

const router = express.Router()

router.get('/:orderNumber', async (req, res) => {
  try {
    const state = await getSetupState(req.params.orderNumber)
    if (!state) return res.status(404).type('html').send(renderSetupNotFound())
    const publicBase = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
    res.set('X-Robots-Tag', 'noindex').type('html').send(renderSetupPage(state, publicBase))
  } catch (err) {
    console.error('setup page failed:', err.message)
    res.status(500).type('html').send(renderSetupNotFound())
  }
})

router.post('/:orderNumber/submit', async (req, res) => {
  try {
    const result = await submitSetup(req.params.orderNumber, req.body || {})
    res.json(result)
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

router.post('/:orderNumber/logo', async (req, res) => {
  try {
    const result = await submitSetupLogo(req.params.orderNumber, req.body || {})
    res.json(result)
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

export default router
