// Authenticated fetch for /api calls — attaches the Supabase session token.
// supabase-js refreshes the session automatically; getSession() is local
// (no network) so this adds no per-request latency.
import { supabase } from './supabase.js'

export async function apiFetch(url, opts = {}) {
  let token = null
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token || null
  }
  const headers = { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  return fetch(url, { ...opts, headers })
}
