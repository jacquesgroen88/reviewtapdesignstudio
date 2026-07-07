import { useState, useEffect, useCallback } from 'react'

const PRODUCT_LABEL = { stand: 'Stand', card: 'Card' }

export default function DesignLibrary({ onNewDesign, onOpenDesign }) {
  const [designs, setDesigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')
  const [editing, setEditing] = useState(null)
  const [draft,   setDraft]   = useState('')

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
      setError(null)
    } catch (err) {
      setError(`Delete failed: ${err.message || 'network error'} — the design is still in the library`)
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

      {error && <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600 mb-4">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No designs yet. Click <span className="font-medium text-gray-600">New design</span> to start one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(d => (
            <div key={d.id} className="card p-4 flex items-center gap-3">
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
          ))}
        </div>
      )}
    </div>
  )
}
