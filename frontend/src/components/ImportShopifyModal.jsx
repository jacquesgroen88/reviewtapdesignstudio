import { useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { parseShopifyOrders } from '../lib/shopifyCsv.js'

// Fill customer details onto logo-less orders from a Shopify orders_export.csv.
//
// The studio can't read Shopify customer PII, so orders created from the
// missing-logo banner have a placeholder name and no phone — and with no phone
// the one-click "Send via the Reviewtap System" never appears, which is what
// forces building the GHL contact by hand. This is the shortcut back.
//
// Always previews before writing: the plan comes from the server, is shown in
// full, and only applies on an explicit confirm. Existing values are never
// overwritten (only blanks are filled, plus "Order #1234" placeholder names).
export default function ImportShopifyModal({ onClose, onImported }) {
  const [rows, setRows]       = useState(null)
  const [plan, setPlan]       = useState(null)
  const [applied, setApplied] = useState(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [fileName, setFileName] = useState('')
  const [showSkipped, setShowSkipped] = useState(false)

  async function handleFile(file) {
    if (!file) return
    setError(null); setPlan(null); setApplied(null); setFileName(file.name); setBusy(true)
    try {
      const text = await file.text()
      const { orders, error: parseError } = parseShopifyOrders(text)
      if (parseError) throw new Error(parseError)
      if (!orders.length) throw new Error('No orders found in that file.')
      setRows(orders)

      const res = await apiFetch('/api/orders/import-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: orders }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'could not read the orders')
      setPlan((await res.json()).plan)
    } catch (err) {
      setError(err.message || 'Could not read that file')
    } finally { setBusy(false) }
  }

  async function apply() {
    setBusy(true); setError(null)
    try {
      const res = await apiFetch('/api/orders/import-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, apply: true }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'import failed')
      const data = await res.json()
      setApplied(data.applied)
      onImported?.()
    } catch (err) {
      setError(err.message || 'Import failed')
    } finally { setBusy(false) }
  }

  const nothingToDo = plan && !plan.updates.length && !plan.creates.length

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Import customer details from Shopify</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Fills in the names and WhatsApp numbers we can't read from Shopify directly, so orders can be sent through the Reviewtap System.
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {!applied && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-500 leading-relaxed">
            In Shopify: <b className="text-gray-700">Orders → Export → Current page (or All orders) → CSV for Excel</b>, then pick the downloaded <code className="font-mono">orders_export.csv</code> below.
            Use a <b className="text-gray-700">fresh export</b> — an old one won't contain your newest orders.
          </div>
        )}

        {!applied && (
          <div>
            <label className="btn-secondary w-full justify-center cursor-pointer">
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={e => handleFile(e.target.files?.[0])} />
              {fileName || 'Choose orders_export.csv'}
            </label>
            {busy && !plan && <p className="text-xs text-gray-400 mt-2 text-center">Reading…</p>}
          </div>
        )}

        {error && <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-600">{error}</div>}

        {plan && !applied && (
          <div className="space-y-3">
            {nothingToDo ? (
              <p className="text-sm text-gray-500">
                Nothing to fill — every order in this file already has its details.
                {plan.skipped.length > 0 && ' If you expected a newer order here, export again from Shopify.'}
              </p>
            ) : (
              <>
                {plan.updates.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-1.5">
                      Fill in details on {plan.updates.length} existing {plan.updates.length === 1 ? 'order' : 'orders'}
                    </p>
                    <div className="space-y-1">
                      {plan.updates.map(u => (
                        <div key={u.rowSlug} className="text-xs px-3 py-2 rounded-lg bg-gray-50">
                          <span className="font-semibold text-gray-700">#{u.orderNumber}</span>
                          <span className="text-gray-400"> {u.companyName}</span>
                          <div className="mt-0.5 space-y-0.5">
                            {Object.entries(u.changes).map(([field, v]) => (
                              <div key={field} className="text-gray-500">
                                {field.replace('company_name', 'name').replace('_', ' ')}:{' '}
                                {v.from ? <span className="line-through text-gray-300">{v.from}</span> : <span className="text-gray-300">(blank)</span>}
                                {' → '}<span className="text-gray-700 font-medium">{v.to}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {plan.creates.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-1.5">
                      Add {plan.creates.length} new {plan.creates.length === 1 ? 'order that needs' : 'orders that need'} a design
                    </p>
                    <div className="space-y-1">
                      {plan.creates.map(c => (
                        <div key={c.orderNumber} className="text-xs px-3 py-2 rounded-lg bg-brand-50 text-gray-600">
                          <span className="font-semibold text-gray-700">#{c.orderNumber}</span> {c.companyName}
                          <span className="text-gray-400"> · {c.whatsapp || 'no number'} · {[c.orderedStand && 'Stand', c.orderedCard && 'Card'].filter(Boolean).join(' + ') || 'custom item'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {plan.skipped.length > 0 && (
              <div>
                <button onClick={() => setShowSkipped(s => !s)} className="text-xs text-gray-400 hover:text-gray-600">
                  {showSkipped ? '▲' : '▼'} {plan.skipped.length} skipped
                </button>
                {showSkipped && (
                  <div className="mt-1 space-y-0.5 pl-3">
                    {plan.skipped.map((s, i) => (
                      <p key={i} className="text-xs text-gray-400">#{s.orderNumber} — {s.reason}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!nothingToDo && (
              <div className="flex gap-2 pt-1">
                <button className="btn-secondary flex-1 justify-center" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn-primary flex-1 justify-center" onClick={apply} disabled={busy}>
                  {busy ? 'Importing…' : `Import ${plan.updates.length + plan.creates.length}`}
                </button>
              </div>
            )}
          </div>
        )}

        {applied && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              ✓ Filled {applied.updated.length} {applied.updated.length === 1 ? 'order' : 'orders'}
              {applied.created.length > 0 && `, added ${applied.created.length}`}.
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Orders with a WhatsApp number now show <b className="text-gray-600">Send via the Reviewtap System</b> when you request a logo — one click, no GHL contact to build by hand.
            </p>
            {applied.failed.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-600">
                {applied.failed.length} failed: {applied.failed.map(f => `#${f.orderNumber} (${f.error})`).join(', ')}
              </div>
            )}
            <button className="btn-primary w-full justify-center" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}
