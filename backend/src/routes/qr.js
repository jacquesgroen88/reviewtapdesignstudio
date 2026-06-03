import express from 'express'
import { nanoid } from 'nanoid'
import { listQRCodes, getQRCode, createQRCode, updateQRCode, deleteQRCode, bulkImport } from '../services/database.js'

const router = express.Router()

router.get('/', async (req, res) => {
  res.json(await listQRCodes())
})

router.get('/:id', async (req, res) => {
  const qr = await getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  res.json(qr)
})

router.post('/', async (req, res) => {
  const { label, destination, id: customId } = req.body
  if (!label?.trim())       return res.status(400).json({ error: 'label is required' })
  if (!destination?.trim()) return res.status(400).json({ error: 'destination is required' })
  const id = customId?.trim() || nanoid(7)
  try {
    const qr = await createQRCode({ id, label: label.trim(), destination: destination.trim() })
    res.status(201).json(qr)
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ID already exists' })
    throw err
  }
})

router.patch('/:id', async (req, res) => {
  const { label, destination } = req.body
  const qr = await getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  res.json(await updateQRCode(req.params.id, { label, destination }))
})

router.delete('/:id', async (req, res) => {
  const qr = await getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  await deleteQRCode(req.params.id)
  res.status(204).end()
})

router.post('/bulk-import', async (req, res) => {
  const { entries } = req.body
  if (!Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'entries array required' })
  const prepared = entries
    .filter(e => e.label && e.destination)
    .map(e => ({ id: e.id?.trim() || nanoid(7), label: e.label.trim(), destination: e.destination.trim() }))
  await bulkImport(prepared)
  res.json({ imported: prepared.length })
})

export default router
