import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'

const BASE_URL = import.meta.env.VITE_QR_BASE_URL || `${window.location.origin}/r`

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'
const isoDay = (iso) => (iso ? new Date(iso) : new Date()).toISOString().slice(0, 10)

export default function AdminPanel() {
  const [qrCodes,   setQrCodes]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [showForm,  setShowForm]  = useState(false)
  const [editTarget, setEditTarget] = useState(null)   // qr object being edited
  const [showImport, setShowImport] = useState(false)
  const [msg, setMsg] = useState(null)
  const [sortDesc, setSortDesc] = useState(true)       // created_at sort direction

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/qr')
      if (!res.ok) throw new Error(await res.text())
      setQrCodes(await res.json())
    } catch { setError('Could not connect to backend. Is it running?') }
    finally  { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function showMsg(type, text) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  async function handleDelete(id, label) {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/qr/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      showMsg('success', `"${label}" deleted`)
    } catch (err) {
      showMsg('error', `Delete failed: ${err.message || 'network error'}`)
    }
    load()
  }

  async function copyURL(id) {
    try {
      await navigator.clipboard.writeText(`${BASE_URL}/${id}`)
      showMsg('success', 'URL copied to clipboard')
    } catch {
      showMsg('error', 'Could not copy — copy it manually: ' + `${BASE_URL}/${id}`)
    }
  }

  async function downloadQR(qr) {
    try {
      const url     = `${BASE_URL}/${qr.id}`
      const dataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1, errorCorrectionLevel: 'M' })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `qr_${qr.label.replace(/[^a-zA-Z0-9]/g, '_')}_${qr.id}_${isoDay(qr.created_at)}.png`
      a.click()
    } catch (err) {
      showMsg('error', `QR download failed: ${err.message || 'unknown error'}`)
    }
  }

  // Full library dump for audits/reporting — dates included
  function exportCSV() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['id', 'label', 'short_url', 'destination', 'scan_count', 'created_at', 'updated_at'],
      ...qrCodes.map(q => [q.id, q.label, `${BASE_URL}/${q.id}`, q.destination, q.scan_count, q.created_at, q.updated_at]),
    ]
    const csv = rows.map(r => r.map(esc).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `reviewtap-qr-codes_${isoDay()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const sorted = [...qrCodes].sort((a, b) => {
    const d = new Date(a.created_at || 0) - new Date(b.created_at || 0)
    return sortDesc ? -d : d
  })

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">QR Codes</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Redirect URLs — update destination anytime without reprinting
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-sm" onClick={exportCSV} disabled={!qrCodes.length} title="Download all QR codes as CSV (with created dates)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
          <button className="btn-ghost text-sm" onClick={() => setShowImport(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Bulk import
          </button>
          <button className="btn-primary" onClick={() => { setEditTarget(null); setShowForm(true) }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New QR code
          </button>
        </div>
      </div>

      {/* Status message */}
      {msg && (
        <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-medium ${msg.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        </div>
      ) : qrCodes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-gray-300">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            <path d="M14 14h3v3M17 20h3M20 17v3"/>
          </svg>
          <p className="text-sm">No QR codes yet. Create your first one.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Label</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Short URL</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Destination</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <button onClick={() => setSortDesc(d => !d)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-700" title="Sort by created date">
                    Created {sortDesc ? '↓' : '↑'}
                  </button>
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Scans</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((qr, i) => (
                <tr key={qr.id} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${i === sorted.length - 1 ? 'border-b-0' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">{qr.label}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded font-mono">
                      /r/{qr.id}
                    </code>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <a href={qr.destination} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-gray-800 truncate block max-w-[200px]" title={qr.destination}>
                      {qr.destination}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500" title={qr.created_at || ''}>{fmtDate(qr.created_at)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-semibold text-gray-700">{qr.scan_count.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <ActionBtn title="Copy short URL" onClick={() => copyURL(qr.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </ActionBtn>
                      <ActionBtn title="Download QR PNG" onClick={() => downloadQR(qr)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </ActionBtn>
                      <ActionBtn title="Edit" onClick={() => { setEditTarget(qr); setShowForm(true) }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </ActionBtn>
                      <ActionBtn title="Delete" onClick={() => handleDelete(qr.id, qr.label)} danger>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                      </ActionBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <QRFormModal
          initial={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
          onSaved={() => { setShowForm(false); setEditTarget(null); load() }}
          onMsg={showMsg}
        />
      )}

      {/* Bulk import modal */}
      {showImport && (
        <BulkImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load() }}
          onMsg={showMsg}
        />
      )}
    </div>
  )
}

// ── Create / Edit form modal ──────────────────────────────────────────────────

function QRFormModal({ initial, onClose, onSaved, onMsg }) {
  const isEdit = !!initial
  const [label,       setLabel]       = useState(initial?.label       || '')
  const [destination, setDestination] = useState(initial?.destination || '')
  const [customId,    setCustomId]    = useState(initial?.id          || '')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  async function handleSave() {
    if (!label.trim())       { setErr('Label is required'); return }
    if (!destination.trim()) { setErr('Destination URL is required'); return }
    setSaving(true)
    try {
      if (isEdit) {
        const res = await fetch(`/api/qr/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), destination: destination.trim() }),
        })
        if (!res.ok) throw new Error(await res.text())
        onMsg('success', 'QR code updated')
      } else {
        const res = await fetch('/api/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), destination: destination.trim(), id: customId.trim() || undefined }),
        })
        if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
        onMsg('success', 'QR code created')
      }
      onSaved()
    } catch (e) { setErr(e.message) }
    finally     { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit QR code' : 'New QR code'}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Label</label>
            <input className="input-field" placeholder="e.g. The Coffee House" value={label} onChange={e => setLabel(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Destination URL</label>
            <input className="input-field" type="url" placeholder="https://g.page/r/..." value={destination} onChange={e => setDestination(e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">You can update this anytime — no reprint needed.</p>
          </div>
          {!isEdit && (
            <div>
              <label className="label">Custom code <span className="text-gray-400 font-normal">(optional)</span></label>
              <input className="input-field font-mono text-sm" placeholder="e.g. coffeehouse (auto-generated if blank)" value={customId} onChange={e => setCustomId(e.target.value)} />
            </div>
          )}
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> : null}
            {isEdit ? 'Save changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bulk import modal ─────────────────────────────────────────────────────────

function BulkImportModal({ onClose, onImported, onMsg }) {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [err, setErr] = useState('')

  async function handleImport() {
    const lines = text.trim().split('\n').filter(Boolean)
    const entries = lines.map(line => {
      const parts = line.split('\t')
      // Accept: "label\tdestination" or "label\tdestination\tcustomId"
      if (parts.length >= 2) return { label: parts[0].trim(), destination: parts[1].trim(), id: parts[2]?.trim() || undefined }
      return null
    }).filter(Boolean)

    if (entries.length === 0) { setErr('No valid rows found. Use tab-separated: Label[TAB]URL'); return }
    setImporting(true)
    try {
      const res = await fetch('/api/qr/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      const data = await res.json()
      onMsg('success', `Imported ${data.imported} QR codes`)
      onImported()
    } catch (e) { setErr(e.message) }
    finally     { setImporting(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Bulk import from QR-Me</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700 space-y-1">
          <p className="font-semibold">How to export from QR-Me:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open QR-Me → QR Codes list</li>
            <li>Export as CSV (or copy the table)</li>
            <li>Paste below in format: <code className="bg-amber-100 px-1 rounded">Name[TAB]Google review URL</code></li>
          </ol>
        </div>

        <div>
          <label className="label">Paste your QR codes (one per line)</label>
          <textarea
            className="input-field font-mono text-xs h-40 resize-none"
            placeholder={"The Coffee House\thttps://g.page/r/abc123/review\nCity Bistro\thttps://g.page/r/xyz456/review"}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">Format: <code>Label [TAB] Destination URL</code>. Optional 3rd column: custom short code.</p>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleImport} disabled={importing || !text.trim()}>
            {importing ? 'Importing…' : `Import ${text.trim().split('\n').filter(Boolean).length} rows`}
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ children, title, onClick, danger }) {
  return (
    <button title={title} onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors
        ${danger ? 'text-gray-300 hover:text-red-500 hover:bg-red-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}
