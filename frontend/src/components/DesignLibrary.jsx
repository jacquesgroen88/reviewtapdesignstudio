import { useState, useEffect, useCallback } from 'react'
// Static imports (Gotcha 11): bulk export must survive redeploys mid-session
import JSZip from 'jszip'
import { renderDesignFaces, canvasToTiffBlob } from '../lib/renderDesign.js'

const PRODUCT_LABEL = { stand: 'Stand', card: 'Card' }

// Order-status chips shown on designs linked to an order/job.
// pending_print = the client approved the artwork — it's ready to print.
const STATUS_CHIP = {
  pending:          { label: 'Pending',           color: 'bg-amber-100 text-amber-700' },
  pending_approval: { label: 'Awaiting approval', color: 'bg-blue-100 text-blue-700' },
  in_progress:      { label: 'Awaiting approval', color: 'bg-blue-100 text-blue-700' },
  pending_print:    { label: 'Approved',          color: 'bg-purple-100 text-purple-700' },
  done:             { label: 'Done',              color: 'bg-brand-100 text-brand-700' },
  skipped:          { label: 'Skipped',           color: 'bg-gray-100 text-gray-500' },
}

const safeName = (s) => (s || 'design').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_')

export default function DesignLibrary({ onNewDesign, onOpenDesign }) {
  const [designs, setDesigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')
  const [editing, setEditing] = useState(null)
  const [draft,   setDraft]   = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [exportProgress, setExportProgress] = useState(null)   // { done, total } while exporting

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/designs')
      if (!res.ok) throw new Error(await res.text())
      setDesigns(await res.json())
    } catch {
      setError('Could not load the design library. Is the backend running?')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function saveRename(id) {
    const name = draft.trim()
    if (name) {
      try {
        const res = await fetch(`/api/designs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
        if (!res.ok) throw new Error(await res.text())
        setDesigns(prev => prev.map(d => d.id === id ? { ...d, name } : d))
        setError(null)
      } catch (err) {
        setError(`Rename failed: ${err.message || 'network error'}`)
      }
    }
    setEditing(null)
  }

  async function duplicate(d) {
    try {
      const res = await fetch(`/api/designs/${d.id}/duplicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (!res.ok) throw new Error(await res.text())
      const copy = await res.json()
      setDesigns(prev => [copy, ...prev])
      setError(null)
    } catch (err) {
      setError(`Duplicate failed: ${err.message || 'network error'}`)
    }
  }

  async function remove(d) {
    if (!confirm(`Delete “${d.name}”?`)) return
    try {
      const res = await fetch(`/api/designs/${d.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      setDesigns(prev => prev.filter(x => x.id !== d.id))
      setSelected(prev => { const n = new Set(prev); n.delete(d.id); return n })
      setError(null)
    } catch (err) {
      setError(`Delete failed: ${err.message || 'network error'} — the design is still in the library`)
    }
  }

  // ── Selection + bulk export ─────────────────────────────────────────────────

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const approvedIds = designs.filter(d => d.order_status === 'pending_print').map(d => d.id)

  function selectApproved() {
    setSelected(new Set(approvedIds))
  }

  // Render every selected design headlessly and zip the print TIFFs
  async function exportSelected() {
    const ids = [...selected]
    if (!ids.length) return
    setExportProgress({ done: 0, total: ids.length })
    setError(null)
    const zip = new JSZip()
    const failed = []
    try {
      for (let i = 0; i < ids.length; i++) {
        const meta = designs.find(d => d.id === ids[i])
        try {
          const res = await fetch(`/api/designs/${ids[i]}`)
          if (!res.ok) throw new Error(await res.text())
          const full = await res.json()
          const rendered = await renderDesignFaces(full)
          for (const r of rendered) {
            const face = rendered.length > 1 ? `_${r.faceLabel}` : ''
            zip.file(`${safeName(full.name)}_${r.variantLabel.replace(/\s+/g, '')}${face}.tiff`, canvasToTiffBlob(r.canvas))
          }
        } catch (err) {
          console.error('bulk export failed for', ids[i], err)
          failed.push(meta?.name || ids[i])
        }
        setExportProgress({ done: i + 1, total: ids.length })
      }
      if (failed.length === ids.length) throw new Error('every design failed to render')
      setExportProgress({ done: ids.length, total: ids.length, phase: 'zip' })
      // level 1: TIFF data zips fast and still shrinks well; default level is 3-4x slower
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `reviewtap-print-export_${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
      if (failed.length) setError(`Exported with ${failed.length} failure(s): ${failed.join(', ')} — those are NOT in the zip`)
    } catch (err) {
      setError(`Bulk export failed: ${err.message || 'unknown error'}`)
    } finally {
      setExportProgress(null)
    }
  }

  const filtered = designs.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 fade-in">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Design Studio</h1>
          <p className="text-sm text-gray-400 mt-0.5">Your reusable design library — open, duplicate, or start a new one.</p>
        </div>
        <button className="btn-primary" onClick={onNewDesign}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New design
        </button>
      </div>

      {designs.length > 6 && (
        <input className="input-field mb-4" placeholder="Search designs…" value={search} onChange={e => setSearch(e.target.value)} />
      )}

      {/* Bulk export toolbar */}
      {designs.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {approvedIds.length > 0 && (
            <button className="btn-ghost text-sm" onClick={selectApproved} disabled={!!exportProgress}
              title="Select every design whose order is Approved (pending print)">
              Select approved ({approvedIds.length})
            </button>
          )}
          {selected.size > 0 && (
            <>
              <button className="btn-secondary text-sm" onClick={exportSelected} disabled={!!exportProgress}>
                {exportProgress
                  ? (exportProgress.phase === 'zip' ? 'Zipping…' : `Rendering ${exportProgress.done}/${exportProgress.total}…`)
                  : `Export ${selected.size} as print TIFFs (zip)`}
              </button>
              <button className="btn-ghost text-sm" onClick={() => setSelected(new Set())} disabled={!!exportProgress}>
                Clear selection
              </button>
            </>
          )}
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600 mb-4">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No designs yet. Click <span className="font-medium text-gray-600">New design</span> to start one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(d => {
            const chip = d.order_status ? STATUS_CHIP[d.order_status] : null
            return (
              <div key={d.id} className={`card p-4 flex items-center gap-3 ${selected.has(d.id) ? 'ring-2 ring-brand-300' : ''}`}>
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)}
                  className="w-4 h-4 accent-brand-600 shrink-0 cursor-pointer" title="Select for bulk export" />
                <div className="flex-1 min-w-0">
                  {editing === d.id ? (
                    <input autoFocus className="input-field py-1.5 text-sm" value={draft}
                      onChange={e => setDraft(e.target.value)} onBlur={() => saveRename(d.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveRename(d.id); if (e.key === 'Escape') setEditing(null) }} />
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 truncate">{d.name}</p>
                      <button onClick={() => { setEditing(d.id); setDraft(d.name) }} className="text-gray-300 hover:text-gray-600" title="Rename">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      {chip && <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${chip.color}`}>{chip.label}</span>}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {PRODUCT_LABEL[d.product_id] || d.product_id} · {d.variant_id}
                    {d.owner_slug ? ' · linked to an order/job' : ''}
                  </p>
                </div>
                <button className="btn-secondary text-sm py-2" onClick={() => onOpenDesign(d)}>Open</button>
                <button onClick={() => duplicate(d)} title="Duplicate" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button onClick={() => remove(d)} title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
