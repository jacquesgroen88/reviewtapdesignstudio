import express from 'express'
import axios   from 'axios'

const router = express.Router()

// Only allow proxying from trusted hosts (Formaloo's S3 + Formaloo domains)
const ALLOWED_HOSTS = [
  's3.amazonaws.com',
  'amazonaws.com',
  'formaloo.me',
  'formaloo.com',
  'formaloo-en.s3.amazonaws.com',
]

// GET /api/proxy-image?url=<encoded remote image url>
// Fetches a remote image server-side and streams it back from our own origin.
// This avoids CORS taint so the image can be placed on the Fabric canvas
// AND included in the exported PDF/TIFF.
router.get('/', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).json({ error: 'url query param required' })

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ error: 'invalid url' })
  }

  const allowed = ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))
  if (!allowed) {
    return res.status(403).json({ error: 'host not allowed' })
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
    })
    const contentType = upstream.headers['content-type'] || 'image/png'
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('Access-Control-Allow-Origin', '*')
    res.send(Buffer.from(upstream.data))
  } catch (err) {
    console.error('Proxy image error:', err.message)
    res.status(502).json({ error: 'could not fetch image' })
  }
})

export default router
