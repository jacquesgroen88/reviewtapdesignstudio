// Client-approval send helper: renders MOCKUP-mode images (the client view —
// never the print background, spec §6b rule) and creates the approval link.
import { renderDesignFaces, canvasToDataURL } from './renderDesign.js'
import { apiFetch } from './api.js'

// designs: array of full design rows { id, product_id, variant_id, design }
export async function createApprovalRequest({ designs, ownerSlug, clientName, whatsapp, orderNumber }) {
  const items = []
  for (const d of designs) {
    const faces = await renderDesignFaces(d, { mode: 'mockup' })
    items.push({ designId: d.id, mockups: faces.map(f => canvasToDataURL(f.canvas, 1000)) })
  }
  const res = await apiFetch('/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, ownerSlug: ownerSlug || null, clientName, whatsapp, orderNumber }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create the approval link')
  return res.json()   // { token, url, waUrl, ghlAvailable }
}
