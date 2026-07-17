import { useState } from 'react'
import GhlSendConfirm from './GhlSendConfirm.jsx'
import { logShare } from '../lib/shareLog.js'

// Shown right after a logo-request link is created.
//
// Order matters here (2026-07-17): the Reviewtap System send is the PRIMARY
// action, because comms must live in GHL on the contact record rather than on
// someone's personal phone. wa.me and copy-link are the fallback, and both are
// logged so the card can show the client was contacted and so we can measure
// how often the GHL path is bypassed.
//
// Nothing in this modal has contacted the customer yet — creating the link
// alone is logged as `logoRequest.link_created`, never as a send.
export default function LogoRequestShareModal({ result, companyName, hasPhone, onClose }) {
  const [copied, setCopied] = useState(false)
  const canUseSystem = result.ghlAvailable

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* the visible input is selectable as fallback */ }
    logShare({ kind: 'logo', token: result.token, channel: 'copy' })
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Logo request link ready</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {companyName ? `For ${companyName} — ` : ''}the customer uploads their logo, no account needed. You'll see it land on the order automatically.
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex gap-2">
          <input readOnly value={result.url} onFocus={e => e.target.select()}
            className="input-field font-mono text-xs flex-1" />
          <button className="btn-secondary shrink-0" onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>

        {canUseSystem && (
          <GhlSendConfirm
            primary
            endpoint={`/api/logo-requests/${result.token}/send-ghl`}
            title="Send the automated logo-request WhatsApp?"
            recipientName={companyName}
            waUrl={result.waUrl}
            whatFires="They'll get the logo-request template with the upload link."
          />
        )}

        {hasPhone ? (
          <div className="space-y-1">
            <a href={result.waUrl} target="_blank" rel="noopener noreferrer"
              onClick={() => logShare({ kind: 'logo', token: result.token, channel: 'whatsapp' })}
              className={canUseSystem
                // Demoted to a plain link once the system path is available:
                // still one click away, but no longer the button your thumb
                // goes to by default.
                ? 'flex items-center justify-center gap-2 w-full py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors'
                // No system path available, so this IS the best option. Don't
                // hide it behind a warning — that would just push the work
                // off-platform entirely with no record at all.
                : 'btn-primary w-full justify-center !bg-[#25D366] hover:!bg-[#1fb958]'}>
              <svg width={canUseSystem ? 14 : 16} height={canUseSystem ? 14 : 16} viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              Send from my own WhatsApp instead
            </a>
            {canUseSystem && (
              // The tradeoff, stated at the moment of choosing.
              <p className="text-[11px] text-gray-400 text-center">This won't appear in the Reviewtap System</p>
            )}
          </div>
        ) : !canUseSystem && (
          <p className="text-xs text-gray-400 text-center">No phone number on file for this order yet — copy the link above and send it however you're already in touch with them.</p>
        )}
      </div>
    </div>
  )
}
