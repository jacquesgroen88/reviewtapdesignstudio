import { useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { displayOrderNumber } from '../lib/orderNumber.js'

// Correct the client details on a FORMALOO order.
//
// Formaloo submissions are the customer's own words and can't be edited at
// source, but they feed the WhatsApp greeting and the GHL contact's name. Order
// 1820 is the case that prompted this: the company field arrived as
//   Two (2) Companies: "Witsieshoek Mountain Lodge" and "Thaba Adventures"
// and the client was greeted with that entire string, with no way to fix it.
//
// Corrections are stored separately and layered on top — the customer's original
// submission is never modified, and is always one click away via Revert.
//
// Manual orders don't come here: they're edited directly in ManualOrderModal.
export default function OrderDetailsModal({ order, onClose, onSaved }) {
  const [companyName, setCompanyName] = useState(order.companyName || '')
  const [whatsapp,    setWhatsapp]    = useState(order.whatsapp || '')
  const [orderNumber, setOrderNumber] = useState(displayOrderNumber(order.orderNumber) || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const original = order.original
  const changed =
    companyName !== (order.companyName || '') ||
    whatsapp !== (order.whatsapp || '') ||
    orderNumber !== (displayOrderNumber(order.orderNumber) || '')

  async function save() {
    setBusy(true); setError(null)
    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(order.rowSlug)}/override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, whatsapp, orderNumber }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'save failed')
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not save')
    } finally { setBusy(false) }
  }

  async function revert() {
    if (!confirm('Drop your corrections and go back to exactly what the customer submitted?')) return
    setBusy(true); setError(null)
    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(order.rowSlug)}/override`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not revert')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Client details</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              This is what the client sees in WhatsApp and what the Reviewtap System stores as their name.
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Client name</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)}
              className="input-field w-full" placeholder="e.g. Witsieshoek Mountain Lodge" />
            <p className="text-[11px] text-gray-400 mt-1">
              Used as the greeting: “Hi <span className="text-gray-600">{companyName.trim() || 'there'}</span>, your ReviewTap design is ready…”
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">WhatsApp number</label>
            <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
              className="input-field w-full font-mono text-sm" placeholder="e.g. 27829725609" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Order number</label>
            <input value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
              className="input-field w-full font-mono text-sm" placeholder="e.g. 1820" />
            <p className="text-[11px] text-gray-400 mt-1">No need for the “#”, it's added automatically.</p>
          </div>
        </div>

        {original && (
          // What the customer actually typed, kept visible so a correction is
          // never mistaken for the source record.
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1">
            <p className="text-[11px] font-semibold text-gray-500">The customer originally submitted</p>
            <p className="text-[11px] text-gray-500 break-words">
              Name: <span className="text-gray-700">{original.companyName || '(blank)'}</span>
            </p>
            {original.whatsapp !== order.whatsapp && (
              <p className="text-[11px] text-gray-500">WhatsApp: <span className="text-gray-700">{original.whatsapp || '(blank)'}</span></p>
            )}
            {original.orderNumber !== order.orderNumber && (
              <p className="text-[11px] text-gray-500">Order #: <span className="text-gray-700">{original.orderNumber || '(blank)'}</span></p>
            )}
            <button onClick={revert} disabled={busy}
              className="text-[11px] font-medium text-gray-500 hover:text-gray-700 underline pt-0.5">
              Revert to the original
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button className="btn-secondary flex-1 justify-center" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary flex-1 justify-center" onClick={save} disabled={busy || !changed}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 text-center">
          The customer's Formaloo submission isn't changed — this only affects what we show and send.
        </p>
      </div>
    </div>
  )
}
