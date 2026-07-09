import { apiFetch } from './api.js'

// Generates (or re-fetches) the "send us your logo" link for a manual order.
export async function createLogoRequest(rowSlug) {
  const res = await apiFetch('/api/logo-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowSlug }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create the logo-request link')
  return res.json()   // { token, url, waUrl }
}
