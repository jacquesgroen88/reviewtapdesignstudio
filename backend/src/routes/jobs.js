import express from 'express'
import { nanoid } from 'nanoid'
import { createJob, listJobs, getJob, renameJob, deleteJob,
         listDesignedProducts, getAllOrderStatuses } from '../services/database.js'

const router = express.Router()

// List standalone jobs, enriched with their designed products + status
router.get('/', async (req, res) => {
  try {
    const jobs = await listJobs()
    const designedMap = await listDesignedProducts()
    const statuses = await getAllOrderStatuses()
    const statusMap = Object.fromEntries(statuses.map(s => [s.row_slug, s]))
    res.json(jobs.map(j => ({
      ...j,
      designedProducts: designedMap[j.id] ?? [],
      status: statusMap[j.id]?.status ?? 'pending',
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create a new job — id is prefixed so it never collides with Formaloo slugs
router.post('/', async (req, res) => {
  try {
    const name = (req.body.name || '').trim() || 'Untitled job'
    const id = `job_${nanoid(8)}`
    res.status(201).json(await createJob(id, name))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Rename a job
router.patch('/:id', async (req, res) => {
  try {
    const name = (req.body.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name required' })
    const job = await getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'Not found' })
    res.json(await renameJob(req.params.id, name))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a job (and its designs/status)
router.delete('/:id', async (req, res) => {
  try {
    await deleteJob(req.params.id)
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
