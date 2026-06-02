import express  from 'express'
import axios    from 'axios'
import FormData from 'form-data'

const router = express.Router()

router.post('/', async (req, res) => {
  try {
    const { image } = req.body
    if (!image) return res.status(400).json({ error: 'No image provided' })

    const apiKey = process.env.REMOVE_BG_API_KEY
    if (!apiKey) {
      // Fallback: return the original image unchanged with a warning
      console.warn('REMOVE_BG_API_KEY not set — returning original image')
      return res.json({ image, warning: 'Background removal not configured' })
    }

    // Convert data URL to buffer
    const base64Data  = image.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')

    const formData = new FormData()
    formData.append('image_file', imageBuffer, { filename: 'image.png', contentType: 'image/png' })
    formData.append('size', 'auto')

    const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
      headers: { 'X-Api-Key': apiKey, ...formData.getHeaders() },
      responseType: 'arraybuffer',
      timeout: 30000,
    })

    const resultBase64 = Buffer.from(response.data).toString('base64')
    res.json({ image: `data:image/png;base64,${resultBase64}` })
  } catch (err) {
    const status = err.response?.status
    const msg    = status === 402 ? 'remove.bg credits exhausted'
                 : status === 403 ? 'remove.bg API key invalid'
                 : err.message
    console.error('BG removal error:', msg)
    res.status(500).json({ error: msg || 'Background removal failed' })
  }
})

export default router
