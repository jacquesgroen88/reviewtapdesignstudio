import { useState } from 'react'
import { apiFetch } from '../lib/api.js'

// Confirmation-gated "send via the Reviewtap System" control. An automated
// WhatsApp is irreversible and easy to fire by reflex (or to mistake for the
// manual wa.me button), so the first click only REVEALS a summary of exactly
// what will be sent and to whom; nothing goes out until the explicit
// "Yes, send now". Shared by the approval + logo-request share modals.
//
// `primary` (2026-07-17): this is now the DEFAULT send path — comms belong in
// GHL, on the contact record, not on someone's personal phone. When primary it
// renders as the modal's main action; the wa.me button below it is the
// fallback. Before this, wa.me was the big green button and this sat under it,
// so the UI recommended exactly the path we were trying to stop.
export default function GhlSendConfirm({ endpoint, title, recipientName, waUrl, whatFires, primary = false }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  // Pull the destination number out of the wa.me link purely for display, so the
  // operator can eyeball who it's going to before confirming.
  const number = (() => { const m = /wa\.me\/(\d+)/.exec(waUrl || ''); return m ? '+' + m[1] : null })()

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const res = await apiFetch(endpoint, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'send failed')
      setMsg({ type: 'ok', text: 'Sent via the Reviewtap System — logged on the contact.' })
      setConfirming(false)
    } catch (err) {
      setMsg({ type: 'err', text: err.message })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      {msg?.type === 'ok' ? (
        <p className="text-xs text-brand-600">✓ {msg.text}</p>
      ) : !confirming ? (
        <button className={`${primary ? 'btn-primary' : 'btn-secondary'} w-full justify-center`}
          onClick={() => { setMsg(null); setConfirming(true) }}>
          {primary ? 'Send via the Reviewtap System' : 'Auto-send via Reviewtap System'}
        </button>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-900">{title}</p>
          <p className="text-xs text-amber-800 leading-relaxed">
            This sends an automated WhatsApp through the <b>Reviewtap System</b> (not your own phone) to{' '}
            <b>{recipientName || 'the client'}</b>{number ? <> on <b>{number}</b></> : ''}. {whatFires} It goes out immediately and can't be unsent.
          </p>
          <div className="flex gap-2 pt-0.5">
            <button className="btn-secondary flex-1 justify-center" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            <button className="btn-primary flex-1 justify-center" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Yes, send now'}</button>
          </div>
        </div>
      )}
      {msg?.type === 'err' && <p className="text-xs text-red-500">{msg.text}</p>}
    </div>
  )
}
