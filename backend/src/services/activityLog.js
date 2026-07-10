// Audit trail: who did what, when — team actions (design created, status
// changed, QR made, team invited...) and client actions (logo uploaded,
// design approved/changes requested). Written from route handlers and from
// shared services that both the local-dev and public-page Netlify functions
// call through (see CLAUDE.md Gotcha #14 — putting the write here instead of
// in the route files means it's automatically covered on both entry points).
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

let _client = null
function getClient() {
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

// Never let a logging failure break the action it's logging — swallow and
// console.error, same discipline as the other fire-and-forget side effects
// in this codebase (e.g. setOrderStatus(...).catch(() => {})).
export async function logActivity({ actorType, actorId = null, actorLabel = null, action, targetType = null, targetId = null, targetLabel = null, metadata = null }) {
  try {
    const { error } = await getClient().from('activity_log').insert({
      actor_type: actorType, actor_id: actorId, actor_label: actorLabel,
      action, target_type: targetType, target_id: targetId, target_label: targetLabel,
      metadata,
    })
    if (error) throw error
  } catch (err) {
    console.error('activity log write failed:', err.message)
  }
}

export async function listActivity({ limit = 50, before = null } = {}) {
  let query = getClient().from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
