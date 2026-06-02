import express from 'express'
import { getQRCode, incrementScanCount } from '../services/database.js'

const router = express.Router()

// GET /r/:code  →  redirect to destination + count the scan
router.get('/:code', (req, res) => {
  const qr = getQRCode(req.params.code)

  if (!qr) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>QR code not found</h2>
        <p>This link may have been removed or is invalid.</p>
      </body></html>
    `)
  }

  // Count asynchronously — don't delay the redirect
  setImmediate(() => incrementScanCount(qr.id))

  res.redirect(302, qr.destination)
})

export default router
