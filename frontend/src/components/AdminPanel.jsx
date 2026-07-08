import { useState, useEffect, useCallback } from 'react'
// Static imports (Gotcha 11): QR generation must live in the main bundle
import { generateStyledQR, styleToGenOpts, STAND_PRESETS, PLAIN_STYLE, QR_STYLES } from '../lib/qr.js'
import { apiFetch } from '../lib/api.js'

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
  const [downloadTarget, setDownloadTarget] = useState(null)   // qr for the styled-download modal

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/qr')
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

  // Archive, not delete: printed cards encode /r/<id> forever, so the redirect
  // must keep working. Archiving hides the code from lists; scans stay alive.
  async function handleDelete(qr) {
    const warning = qr.scan_count > 0
      ? `"${qr.label}" has been scanned ${qr.scan_count} time${qr.scan_count === 1 ? '' : 's'} — it is almost certainly on printed material.\n\nArchive it? Printed cards KEEP WORKING; the code just disappears from your lists.`
      : `Archive "${qr.label}"? If it was ever printed, scans keep working; the code just disappears from your lists.`
    if (!confirm(warning)) return
    try {
      const res = await apiFetch(`/api/qr/${qr.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      showMsg('success', `"${qr.label}" archived — its printed QR codes still redirect`)
    } catch (err) {
      showMsg('error', `Archive failed: ${err.message || 'network error'}`)
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
                    {qr.created_by_name && <span className="block text-xs text-gray-400">by {qr.created_by_name}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-semibold text-gray-700">{qr.scan_count.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <ActionBtn title="Copy short URL" onClick={() => copyURL(qr.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </ActionBtn>
                      <ActionBtn title="Download QR PNG (choose style)" onClick={() => setDownloadTarget(qr)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </ActionBtn>
                      <ActionBtn title="Edit" onClick={() => { setEditTarget(qr); setShowForm(true) }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </ActionBtn>
                      <ActionBtn title="Archive (printed codes keep working)" onClick={() => handleDelete(qr)} danger>
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

      {/* Styled download modal */}
      {downloadTarget && (
        <DownloadModal
          qr={downloadTarget}
          onClose={() => setDownloadTarget(null)}
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
  const [style,       setStyle]       = useState(initial?.default_style ?? null)   // null = plain
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  async function handleSave() {
    if (!label.trim())       { setErr('Label is required'); return }
    if (!destination.trim()) { setErr('Destination URL is required'); return }
    setSaving(true)
    try {
      if (isEdit) {
        const res = await apiFetch(`/api/qr/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), destination: destination.trim(), style }),
        })
        if (!res.ok) throw new Error(await res.text())
        onMsg('success', 'QR code updated')
      } else {
        const res = await apiFetch('/api/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), destination: destination.trim(), id: customId.trim() || undefined, style }),
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
          <StyleSection style={style} onChange={setStyle} previewData={`${BASE_URL}/${initial?.id || 'preview'}`} />
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
      const res = await apiFetch('/api/qr/bulk-import', {
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

// ── QR styling (presentation-only — never changes the encoded /r/<id> URL) ───

const norm = (s) => ({ ...PLAIN_STYLE, ...(s || {}) })
const sameStyle = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))

// Live preview of a styled QR (checkered backdrop so transparency is visible)
function StylePreview({ style, data, size = 88 }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      generateStyledQR(data, styleToGenOpts(style, 200))
        .then(d => { if (!cancelled) setSrc(d) })
        .catch(() => {})
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [JSON.stringify(style), data])
  return (
    <div className="rounded-lg border border-gray-100 shrink-0" style={{
      width: size, height: size,
      background: 'repeating-conic-gradient(#f3f4f6 0% 25%, #ffffff 0% 50%) 50% / 12px 12px',
    }}>
      {src && <img src={src} alt="QR preview" className="w-full h-full object-contain" />}
    </div>
  )
}

// Full custom controls (shape, colours, transparency, error correction)
function StyleCustomEditor({ value, onChange }) {
  const v = norm(value)
  const set = (patch) => onChange({ ...v, ...patch })
  return (
    <div className="space-y-2 pt-2">
      <div className="grid grid-cols-4 gap-1">
        {QR_STYLES.map(s => (
          <button key={s.id} type="button" onClick={() => set({ styleId: s.id })}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors
              ${v.styleId === s.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex gap-3 items-center">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          QR colour
          <input type="color" value={v.fg} onChange={e => set({ fg: e.target.value })} className="w-7 h-7 rounded border border-gray-200 cursor-pointer" />
        </label>
        <label className={`flex items-center gap-1.5 text-xs text-gray-600 ${v.transparent ? 'opacity-40 pointer-events-none' : ''}`}>
          Background
          <input type="color" value={v.bg} onChange={e => set({ bg: e.target.value })} className="w-7 h-7 rounded border border-gray-200 cursor-pointer" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={v.transparent} onChange={e => set({ transparent: e.target.checked })} />
          Transparent
        </label>
      </div>
      <div className="flex gap-1 items-center">
        <span className="text-xs text-gray-400 mr-1">Error correction</span>
        {['L','M','Q','H'].map(l => (
          <button key={l} type="button" onClick={() => set({ ec: l })}
            className={`w-7 py-1 rounded-lg text-xs font-semibold transition-colors
              ${v.ec === l ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

// Preset chips + optional custom editor, used in the create/edit modal.
// `style` is null for plain, or a style object; saved as the code's default.
function StyleSection({ style, onChange, previewData }) {
  const isPlain = style === null || sameStyle(style, null)
  const activePreset = STAND_PRESETS.find(p => style && sameStyle(style, p.style))?.id
    || (isPlain ? 'plain' : 'custom')
  const [showCustom, setShowCustom] = useState(activePreset === 'custom')
  return (
    <div>
      <label className="label">Style <span className="text-gray-400 font-normal">(saved as this code's default — look only, scans are unaffected)</span></label>
      <div className="flex gap-3 items-start">
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-1">
            {STAND_PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => { onChange(p.style); setShowCustom(false) }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${activePreset === p.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {p.label}
              </button>
            ))}
            <button type="button" onClick={() => { onChange(null); setShowCustom(false) }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${activePreset === 'plain' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Plain
            </button>
            <button type="button" onClick={() => { setShowCustom(true); if (isPlain) onChange(norm(style)) }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${activePreset === 'custom' || showCustom ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Customise
            </button>
          </div>
          {showCustom && <StyleCustomEditor value={style} onChange={onChange} />}
        </div>
        <StylePreview style={style} data={previewData} />
      </div>
    </div>
  )
}

// ── Styled download modal ─────────────────────────────────────────────────────

function DownloadModal({ qr, onClose, onMsg }) {
  const hasSaved = !!qr.default_style
  const [choice, setChoice] = useState(hasSaved ? 'saved' : 'plain')
  const [custom, setCustom] = useState(norm(qr.default_style))
  const [size,   setSize]   = useState(1200)
  const [busy,   setBusy]   = useState(false)
  const url = `${BASE_URL}/${qr.id}`

  const CHOICES = [
    ...(hasSaved ? [{ id: 'saved', label: 'Saved style' }] : []),
    ...STAND_PRESETS.map(p => ({ id: p.id, label: p.label })),
    { id: 'plain',  label: 'Plain' },
    { id: 'custom', label: 'Customise' },
  ]
  const styleFor = (c) =>
    c === 'saved'  ? qr.default_style :
    c === 'plain'  ? null :
    c === 'custom' ? custom :
    STAND_PRESETS.find(p => p.id === c)?.style || null

  async function download(c) {
    setBusy(true)
    try {
      const dataUrl = await generateStyledQR(url, styleToGenOpts(styleFor(c), size))
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `qr_${qr.label.replace(/[^a-zA-Z0-9]/g, '_')}_${qr.id}_${c}_${isoDay(qr.created_at)}.png`
      a.click()
    } catch (err) {
      onMsg('error', `Download failed: ${err.message || 'unknown error'}`)
    } finally { setBusy(false) }
  }

  async function downloadBothStands() {
    await download('white-stand')
    await download('black-stand')
    onMsg('success', 'Downloaded white + black stand versions')
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Download QR</h2>
            <p className="text-xs text-gray-400 mt-0.5">{qr.label} · /r/{qr.id} — every style scans to the same place</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex gap-3 items-start">
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap gap-1">
              {CHOICES.map(c => (
                <button key={c.id} type="button" onClick={() => setChoice(c.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${choice === c.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {c.label}
                </button>
              ))}
            </div>
            {choice === 'custom' && <StyleCustomEditor value={custom} onChange={setCustom} />}
            <div className="flex gap-1 items-center pt-1">
              <span className="text-xs text-gray-400 mr-1">Size</span>
              {[600, 1200].map(s => (
                <button key={s} type="button" onClick={() => setSize(s)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors
                    ${size === s ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {s}px
                </button>
              ))}
            </div>
          </div>
          <StylePreview style={styleFor(choice)} data={url} size={104} />
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn-secondary flex-1 text-sm" onClick={downloadBothStands} disabled={busy}>
            White + black versions
          </button>
          <button className="btn-primary flex-1 text-sm" onClick={() => download(choice)} disabled={busy}>
            {busy ? 'Generating…' : 'Download PNG'}
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
