import express  from 'express'
import multer   from 'multer'
import sharp    from 'sharp'
import { uploadToDrive } from '../services/googleDrive.js'

const router  = express.Router()
const storage = multer.memoryStorage()
const upload  = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } })

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { businessName, orderNumber, productId, filename } = req.body
    const fileBuffer = req.file?.buffer

    if (!fileBuffer) return res.status(400).json({ error: 'No file provided' })
    if (!businessName) return res.status(400).json({ error: 'Missing fields' })

    // The incoming PNG is already full print resolution from the canvas.
    // Just tag 300 DPI and convert to LZW TIFF — no resize (faces vary in size).
    const tiffBuffer = await sharp(fileBuffer)
      .withMetadata({ density: 300 })
      .tiff({ compression: 'lzw' })
      .toBuffer()

    const safeName = filename || sanitizeFilename(`${businessName}_Design.tiff`)

    // Upload to Google Drive
    const fileId = await uploadToDrive(tiffBuffer, safeName, orderNumber, businessName)

    res.json({ ok: true, fileId, filename: safeName })
  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).json({ error: 'Failed to process or upload file', details: err.message })
  }
})

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_.\- ]/g, '_').replace(/\s+/g, '_')
}

export default router
