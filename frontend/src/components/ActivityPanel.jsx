import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api.js'
// The sentence map + timeAgo moved to lib/activitySentences.js so this feed and
// the per-order timeline (OrderHistory) describe every event identically.
import { sentenceFor, actorNameFor, timeAgo, fullTimestamp } from '../lib/activitySentences.js'

export default function ActivityPanel() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch('/api/activity?limit=50')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setEntries(data.entries)
      setHasMore(data.entries.length === 50)
    } catch (e) {
      setError(e.message || 'Could not load activity')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    if (!entries.length) return
    setLoadingMore(true)
    try {
      const before = entries[entries.length - 1].created_at
      const res = await apiFetch(`/api/activity?limit=50&before=${encodeURIComponent(before)}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setEntries(prev => [...prev, ...data.entries])
      setHasMore(data.entries.length === 50)
    } catch (e) {
      setError(e.message || 'Could not load more')
    } finally { setLoadingMore(false) }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 fade-in">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Activity</h1>
          <p className="text-sm text-gray-400 mt-0.5">Who did what, across the team and your clients</p>
        </div>
        <button onClick={load} className="btn-ghost text-sm" disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            className={loading ? 'animate-spin' : ''}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600 mb-4">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No activity recorded yet.</p>
        </div>
      ) : (
        <>
          <div className="card divide-y divide-gray-50">
            {entries.map(entry => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${entry.actor_type === 'client' ? 'bg-blue-400' : 'bg-brand-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700">
                    <span className="font-semibold text-gray-900">{actorNameFor(entry)}</span>
                    {' '}{sentenceFor(entry)}
                  </p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap" title={fullTimestamp(entry.created_at)}>
                  {timeAgo(entry.created_at)}
                </span>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center mt-4">
              <button className="btn-ghost text-sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
