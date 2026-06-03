import { useState, useEffect, useCallback } from 'react'

export default function JobsHome({ onNewDesign, onOpenJob }) {
  const [jobs,    setJobs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [editing, setEditing] = useState(null)   // job id being renamed
  const [draft,   setDraft]   = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/jobs')
      if (!res.ok) throw new Error(await res.text())
      setJobs(await res.json())
    } catch (e) {
      setError('Could not load jobs. Is the backend running?')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function saveRename(id) {
    const name = draft.trim()
    if (name) {
      await fetch(`/api/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      setJobs(prev => prev.map(j => j.id === id ? { ...j, name } : j))
    }
    setEditing(null)
  }

  async function deleteJob(id, name) {
    if (!confirm(`Delete job “${name}”? This removes its saved designs.`)) return
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Design Studio</h1>
          <p className="text-sm text-gray-400 mt-0.5">Create a new design, or reopen a saved job.</p>
        </div>
        <button className="btn-primary" onClick={onNewDesign}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New design
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600 mb-4">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16">
          <svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No saved jobs yet. Click <span className="font-medium text-gray-600">New design</span> to start one.</p>
          <p className="text-xs mt-1">Tip: designs for client orders live under the <span className="font-medium">Orders</span> tab.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => (
            <div key={job.id} className="card p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {editing === job.id ? (
                  <input
                    autoFocus
                    className="input-field py-1.5 text-sm"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={() => saveRename(job.id)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(job.id); if (e.key === 'Escape') setEditing(null) }}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 truncate">{job.name}</p>
                    <button onClick={() => { setEditing(job.id); setDraft(job.name) }}
                      className="text-gray-300 hover:text-gray-600" title="Rename">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-1">
                  {job.designedProducts?.length > 0
                    ? job.designedProducts.map(pid => (
                        <span key={pid} className="inline-flex items-center gap-1 text-xs font-medium bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          {pid === 'stand' ? 'Stand' : pid === 'card' ? 'Card' : pid}
                        </span>
                      ))
                    : <span className="text-xs text-gray-400">No design saved yet</span>}
                </div>
              </div>
              <button className="btn-secondary text-sm py-2" onClick={() => onOpenJob(job)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Open
              </button>
              <button onClick={() => deleteJob(job.id, job.name)} title="Delete job"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
