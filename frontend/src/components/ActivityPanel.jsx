import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api.js'

const STATUS_TEXT = {
  pending: 'Pending', ready: 'Ready', pending_approval: 'Pending Approval',
  pending_print: 'Approved', at_printer: 'Print Pending', done: 'Done', skipped: 'Skipped',
}

// action → sentence fragment (goes after the actor's name). Keep these terse —
// the row already carries the target label and a timestamp.
const SENTENCES = {
  'design.created':            e => `created a design for ${e.target_label || 'an order'}`,
  'design.updated':            e => `updated the design for ${e.target_label || 'an order'}`,
  'design.deleted':            e => `deleted a design for ${e.target_label || 'an order'}`,
  'design.duplicated':         e => `duplicated a design for ${e.target_label || 'an order'}`,
  'order.status_changed':      e => `changed ${e.target_label || 'an order'} to ${STATUS_TEXT[e.metadata?.to] || e.metadata?.to || '—'}`,
  'manualOrder.created':       e => `added a manual order for ${e.target_label || 'a client'}`,
  'manualOrder.updated':       e => `updated the order for ${e.target_label || 'a client'}`,
  'manualOrder.deleted':       e => `deleted the manual order for ${e.target_label || 'a client'}`,
  'qr.created':                e => `created QR code "${e.target_label || e.target_id}"`,
  'qr.updated':                e => `updated QR code "${e.target_label || e.target_id}"`,
  'qr.archived':               e => `archived QR code "${e.target_label || e.target_id}"`,
  'qr.deleted':                e => `permanently deleted QR code "${e.target_label || e.target_id}"`,
  'approval.sent':             e => `sent an approval request to ${e.target_label || 'a client'}`,
  'logoRequest.sent':          e => `requested a logo from ${e.target_label || 'a client'}`,
  'team.invited':              e => `invited ${e.target_label} to the team${e.metadata?.role === 'admin' ? ' as admin' : ''}`,
  'team.removed':              e => `removed ${e.target_label || 'a team member'} from the team`,
  'approval.approved':         () => 'approved their design',
  'approval.changesRequested': e => `requested changes${e.metadata?.comment ? `: "${e.metadata.comment}"` : ''}`,
  'logo.uploaded':             () => 'uploaded their logo',
}

function sentenceFor(entry) {
  const fn = SENTENCES[entry.action]
  return fn ? fn(entry) : entry.action
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

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
                    <span className="font-semibold text-gray-900">{entry.actor_label || (entry.actor_type === 'client' ? 'A client' : 'Someone')}</span>
                    {' '}{sentenceFor(entry)}
                  </p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap" title={new Date(entry.created_at).toLocaleString('en-ZA')}>
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
