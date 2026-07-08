import express from 'express'
import { nanoid } from 'nanoid'
import { listQRCodes, getQRCode, createQRCode, updateQRCode, deleteQRCode, archiveQRCode, bulkImport, getProfileNames } from '../services/database.js'
import { requireAdmin } from '../middleware/auth.js'

const router = express.Router()

// Presentation-only styling saved with a code. Whitelist keys so arbitrary
// JSON can't be stored; null clears the style (back to plain black/white).
function sanitizeStyle(style) {
  if (style === null) return null
  if (typeof style !== 'object' || Array.isArray(style)) return undefined
  const { styleId, fg, bg, transparent, ec } = style
  const out = {}
  if (typeof styleId === 'string')     out.styleId = styleId.slice(0, 20)
  if (typeof fg === 'string')          out.fg = fg.slice(0, 30)
  if (typeof bg === 'string')          out.bg = bg.slice(0, 30)
  if (typeof transparent === 'boolean') out.transparent = transparent
  if (typeof ec === 'string')          out.ec = ec.slice(0, 1)
  return Object.keys(out).length ? out : undefined
}

router.get('/', async (req, res) => {
  const [codes, names] = await Promise.all([listQRCodes(), getProfileNames()])
  res.json(codes.map(q => ({ ...q, created_by_name: q.created_by ? names[q.created_by] || null : null })))
})

router.get('/:id', async (req, res) => {
  const qr = await getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  res.json(qr)
})

// Make a label unique against existing codes: "Name" → "Name (1)" → "Name (2)"…
function uniqueLabel(label, existing) {
  const taken = new Set(existing.map(q => q.label))
  if (!taken.has(label)) return label
  // Strip an existing " (n)" suffix so copies of copies don't stack
  const base = label.replace(/\s*\(\d+\)\s*$/, '')
  let n = 1
  while (taken.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

router.post('/', async (req, res) => {
  const { label, destination, id: customId, style } = req.body
  if (!label?.trim())       return res.status(400).json({ error: 'label is required' })
  if (!destination?.trim()) return res.status(400).json({ error: 'destination is required' })
  const id = customId?.trim() || nanoid(7)
  try {
    const existing = await listQRCodes()
    const finalLabel = uniqueLabel(label.trim(), existing)
    const qr = await createQRCode({ id, label: finalLabel, destination: destination.trim(), defaultStyle: sanitizeStyle(style), createdBy: req.user?.id })
    res.status(201).json(qr)
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ID already exists' })
    throw err
  }
})

router.patch('/:id', async (req, res) => {
  const { label, destination, style } = req.body
  const qr = await getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  res.json(await updateQRCode(req.params.id, { label, destination, defaultStyle: sanitizeStyle(style) }))
})

// "Delete" = archive: the code vanishes from lists/pickers but /r/:id keeps
// redirecting, so printed cards in the field stay alive. True deletion is
// admin-only (?hard=true) for codes that were never printed.
router.delete('/:id', async (req, res, next) => {
  const qr = await getQRCode(req.params.id)
  if (!qr) return res.status(404).json({ error: 'Not found' })
  if (req.query.hard === 'true') {
    return requireAdmin(req, res, async () => {
      await deleteQRCode(req.params.id)
      res.status(204).end()
    })
  }
  await archiveQRCode(req.params.id)
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
