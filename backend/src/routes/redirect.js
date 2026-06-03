import express from 'express'
import { getQRCode, incrementScanCount } from '../services/database.js'

const router = express.Router()

router.get('/:code', async (req, res) => {
  const qr = await getQRCode(req.params.code)

  if (!qr) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>QR code not found</h2><p>This link may have been removed or is invalid.</p>
      </body></html>
    `)
  }

  // Fire-and-forget scan count — don't await so redirect is instant
  incrementScanCount(qr.id).catch(console.error)

  res.redirect(302, qr.destination)
})

export default router
