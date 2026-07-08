// Supabase auth client (frontend). The anon key is safe to ship once RLS
// denies anon access to data tables — it's only used for authentication here.
import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

// Fail closed: if the env vars are missing the app shows a config error
// screen instead of silently running unauthenticated.
export const authConfigured = !!(url && anon)

export const supabase = authConfigured ? createClient(url, anon) : null
