// Team management: who can use the studio.
// Invite flow: admin invites an email → Supabase sends a magic link →
// invitee lands on /welcome, sets display name + password (POST /profile).
import express from 'express'
import { requireAdmin, getAuthAdminClient, bustAuthCache } from '../middleware/auth.js'
import { logActivity } from '../services/activityLog.js'

const router = express.Router()

const WELCOME_URL = `${process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'}/welcome`

// Current user + profile (null profile = needs /welcome setup)
router.get('/me', (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email }, profile: req.profile })
})

// First-login setup / profile update: display name (+ role fixed server-side)
router.post('/profile', async (req, res) => {
  try {
    // Only genuinely invited users may create a first profile — invited_role
    // metadata is set exclusively by admin.inviteUserByEmail below, never by
    // a self-registered account. Existing team members (req.profile already
    // set) can still update their own name/password freely.
    if (!req.profile && !req.user.metadata?.invited_role) {
      return res.status(403).json({ error: 'This account was never invited. Ask an admin to invite you from the Team page.' })
    }
    const displayName = (req.body?.displayName || '').trim()
    if (!displayName) return res.status(400).json({ error: 'displayName required' })
    const supa = getAuthAdminClient()
    // Role: keep existing, else honour the role the admin chose at invite
    // time (stored in user metadata), else default designer. Never client-set.
    const role = req.profile?.role || req.user.metadata?.invited_role || 'designer'
    const { data, error } = await supa.from('profiles')
      .upsert({ id: req.user.id, display_name: displayName, role }, { onConflict: 'id' })
      .select().single()
    if (error) throw error
    bustAuthCache()
    res.json(data)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Admin only ────────────────────────────────────────────────────────────────

// List team: auth users merged with profiles
router.get('/', requireAdmin, async (req, res) => {
  try {
    const supa = getAuthAdminClient()
    const [{ data: users, error: uerr }, { data: profiles, error: perr }] = await Promise.all([
      supa.auth.admin.listUsers({ perPage: 200 }),
      supa.from('profiles').select('*'),
    ])
    if (uerr) throw uerr
    if (perr) throw perr
    const bySlug = Object.fromEntries((profiles || []).map(p => [p.id, p]))
    res.json((users?.users || []).map(u => ({
      id: u.id,
      email: u.email,
      displayName: bySlug[u.id]?.display_name || null,
      role: bySlug[u.id]?.role || u.user_metadata?.invited_role || 'designer',
      lastSignInAt: u.last_sign_in_at,
      invitedPending: !bySlug[u.id],
    })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Invite by email (magic link → /welcome)
router.post('/invite', requireAdmin, async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase()
    const role = req.body?.role === 'admin' ? 'admin' : 'designer'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' })
    const supa = getAuthAdminClient()
    const { data, error } = await supa.auth.admin.inviteUserByEmail(email, {
      redirectTo: WELCOME_URL,
      data: { invited_role: role },
    })
    if (error) throw error
    logActivity({
      actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null,
      action: 'team.invited', targetType: 'team_member', targetId: data.user.id, targetLabel: email, metadata: { role },
    })
    res.status(201).json({ id: data.user.id, email, role })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Remove a team member (deletes their login; their designs stay)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove yourself" })
    const supa = getAuthAdminClient()
    const { data: removedUser } = await supa.auth.admin.getUserById(req.params.id).catch(() => ({ data: null }))
    const { error } = await supa.auth.admin.deleteUser(req.params.id)
    if (error) throw error
    logActivity({
      actorType: 'team', actorId: req.user?.id || null, actorLabel: req.profile?.display_name || req.user?.email || null,
      action: 'team.removed', targetType: 'team_member', targetId: req.params.id, targetLabel: removedUser?.user?.email || null,
    })
    bustAuthCache()
    res.status(204).end()
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
