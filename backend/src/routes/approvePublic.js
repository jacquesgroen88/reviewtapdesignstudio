// PUBLIC client-facing approval page — local-dev Express version.
// On Netlify the standalone approve.js function serves this instead
// (same pattern as the /r redirect). NEVER behind auth: clients have no login.
import express from 'express'
import { getApproval, markViewed, handleApprovalResponse } from '../services/approvals.js'
import { renderApprovalPage } from '../services/approvalPage.js'

const router = express.Router()

const NOT_FOUND = `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h2>Link not found</h2><p>This approval link may have expired or is invalid.</p></body></html>`

router.get('/:token', async (req, res) => {
  try {
    const approval = await getApproval(req.params.token)
    if (!approval) return res.status(404).type('html').send(NOT_FOUND)
    markViewed(req.params.token).catch(() => {})   // seen tracking, non-blocking
    const publicBase = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
    res.type('html').send(renderApprovalPage(approval, publicBase))
  } catch (err) {
    console.error('approval page failed:', err.message)
    res.status(500).type('html').send(NOT_FOUND)
  }
})

router.post('/:token/respond', async (req, res) => {
  try {
    const { designId, response, comment } = req.body || {}
    const result = await handleApprovalResponse(req.params.token, designId, response, comment)
    if (!result) return res.status(404).json({ error: 'Not found' })
    if (result.superseded) return res.status(409).json({ error: 'superseded' })
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

export default router
