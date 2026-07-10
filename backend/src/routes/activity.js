// Read-only feed for the Activity view — team-only (mounted behind requireAuth
// like everything else in this file's group).
import express from 'express'
import { listActivity } from '../services/activityLog.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const before = req.query.before || null
    const entries = await listActivity({ limit, before })
    res.json({ entries })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
