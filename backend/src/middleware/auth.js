// Auth middleware: every /api route (except /api/health) requires a valid
// Supabase session token. NEVER applied to /r/:code redirects or keepalive —
// printed QR codes must stay public (CLAUDE.md QR-uptime rules).
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

let _client = null
function client() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set')
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  })
  return _client
}

// Short-lived token → user cache so each API call doesn't cost a round trip
const cache = new Map()
const CACHE_TTL = 60_000

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Not signed in' })

    const hit = cache.get(token)
    if (hit && hit.exp > Date.now()) {
      req.user = hit.user
      req.profile = hit.profile
      return next()
    }

    const { data, error } = await client().auth.getUser(token)
    if (error || !data?.user) return res.status(401).json({ error: 'Session expired — sign in again' })

    const { data: profile } = await client()
      .from('profiles').select('*').eq('id', data.user.id).maybeSingle()

    const user = { id: data.user.id, email: data.user.email, metadata: data.user.user_metadata || {} }
    if (cache.size > 500) cache.clear()
    cache.set(token, { user, profile: profile || null, exp: Date.now() + CACHE_TTL })
    req.user = user
    req.profile = profile || null
    next()
  } catch (err) {
    console.error('auth check failed:', err.message)
    res.status(401).json({ error: 'Auth check failed' })
  }
}

export function requireAdmin(req, res, next) {
  if (req.profile?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  next()
}

// Drop a user's cached entries after profile changes so role/name updates apply fast
export function bustAuthCache() { cache.clear() }

export function getAuthAdminClient() { return client() }
