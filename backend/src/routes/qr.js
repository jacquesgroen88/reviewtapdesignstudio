import express from 'express'
import { nanoid } from 'nanoid'
import { listQRCodes, getQRCode, createQRCode, updateQRCode, deleteQRCode, bulkImport } from '../services/database.js'

const router = express.Router()

// List all QR codes
router.get('/', (req, res) => {
  res.json(listQRCodes())
})

// Get single QR code
router.get('/:id', (req, res) => {
  const qr = getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  res.json(qr)
})

// Create new QR code
router.post('/', (req, res) => {
  const { label, destination, id: customId } = req.body
  if (!label?.trim())       return res.status(400).json({ error: 'label is required' })
  if (!destination?.trim()) return res.status(400).json({ error: 'destination is required' })

  const id = customId?.trim() || nanoid(7)  // short random ID, e.g. "xk9p2Qm"
  try {
    const qr = createQRCode({ id, label: label.trim(), destination: destination.trim() })
    res.status(201).json(qr)
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'ID already exists' })
    throw err
  }
})

// Update QR code (label and/or destination)
router.patch('/:id', (req, res) => {
  const { label, destination } = req.body
  const qr = getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  res.json(updateQRCode(req.params.id, { label, destination }))
})

// Delete QR code
router.delete('/:id', (req, res) => {
  const qr = getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  deleteQRCode(req.params.id)
  res.status(204).end()
})

// Bulk import (from QR-Me or CSV)
// Body: { entries: [{ label, destination, id? }] }
router.post('/bulk-import', (req, res) => {
  const { entries } = req.body
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' })
  }
  const prepared = entries
    .filter(e => e.label && e.destination)
    .map(e => ({
      id:          e.id?.trim() || nanoid(7),
      label:       e.label.trim(),
      destination: e.destination.trim(),
    }))
  bulkImport(prepared)
  res.json({ imported: prepared.length })
})

export default router
