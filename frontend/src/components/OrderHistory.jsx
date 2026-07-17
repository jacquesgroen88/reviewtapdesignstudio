import { useState, useCallback } from 'react'
import { apiFetch } from '../lib/api.js'
import { sentenceFor, actorNameFor, timeAgo, fullTimestamp, normalizeEntry, OUTSIDE_SYSTEM_ACTIONS } from '../lib/activitySentences.js'

// Per-order timeline. Collapsed by default and lazy-fetched on first expand —
// the Orders list renders many cards at once, so eager loading would fire a
// request per card on every page load for something most people never open.
//
// Visible to every authed team member on purpose (decision 4, 2026-07-17):
// Giorgio is the person most likely to duplicate a follow-up, so hiding this
// from designers would defeat the feature.

// The log did not exist before this. An order worked earlier legitimately shows
// nothing, which must NOT read as "nothing happened".
const LOG_START = '2026-07-10'
const LOG_START_LABEL = '10 Jul 2026'

export default function OrderHistory({ rowSlug, submittedAt }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(rowSlug)}/history`)
      if (!res.ok) throw new Error(await res.text())
      setEntries((await res.json()).map(normalizeEntry))
    } catch (e) {
      // Surface it — a silent catch here means someone quietly assumes "no
      // history" and chases a client twice (Gotcha #12).
      setError(e.message || 'Could not load history')
    } finally { setLoading(false) }
  }, [rowSlug])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && entries === null && !loading) load()
  }

  const predatesLog = submittedAt && new Date(submittedAt) < new Date(LOG_START)

  return (
    <div className="border-t border-gray-50 mt-3 pt-2">
      <button onClick={toggle}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        aria-expanded={open}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        History
        {entries?.length ? <span className="text-gray-300">({entries.length})</span> : null}
      </button>

      {open && (
        <div className="mt-2 pl-1">
          {loading && <p className="text-xs text-gray-400 py-2">Loading history…</p>}

          {error && (
            <p className="text-xs text-red-500 py-2">
              {error} <button onClick={load} className="underline hover:no-underline">Retry</button>
            </p>
          )}

          {entries && entries.length === 0 && !loading && (
            <p className="text-xs text-gray-400 py-2 leading-relaxed">
              Nothing recorded for this order.
              {predatesLog && <> This order predates the activity log, which starts {LOG_START_LABEL} — earlier work was not tracked.</>}
            </p>
          )}

          {entries && entries.length > 0 && (
            <ol className="space-y-1.5 py-1">
              {entries.map(e => {
                const outside = OUTSIDE_SYSTEM_ACTIONS.has(e.action)
                return (
                  <li key={e.id} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                      e.actorType === 'client' ? 'bg-blue-400' : outside ? 'bg-amber-400' : 'bg-brand-500'
                    }`} />
                    <span className="text-gray-500 min-w-0 flex-1">
                      <span className="font-semibold text-gray-700">{actorNameFor(e)}</span>
                      {' '}{sentenceFor(e)}
                    </span>
                    <span className="text-gray-300 shrink-0 whitespace-nowrap" title={fullTimestamp(e.at)}>
                      {timeAgo(e.at)}
                    </span>
                  </li>
                )
              })}
              {predatesLog && (
                <li className="text-[11px] text-gray-300 pt-1 pl-3.5">
                  History starts {LOG_START_LABEL}; earlier work on this order was not tracked.
                </li>
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

// The one line someone reads before deciding whether to chase. Rendered on the
// card whether or not the timeline is expanded — if you have to open something
// to find out a client was already contacted, you will not open it, and you
// will send the duplicate.
export function LastContactLine({ lastContact, submittedAt }) {
  const predatesLog = submittedAt && new Date(submittedAt) < new Date(LOG_START)

  if (!lastContact) {
    return (
      <span className="text-xs text-gray-400">
        {predatesLog
          // Distinguish "we know nobody contacted them" from "we weren't
          // recording yet". Asserting the first when it's the second is how you
          // talk someone into a duplicate chase.
          ? <>No contact recorded <span className="text-gray-300">(history starts {LOG_START_LABEL})</span></>
          : 'Never contacted'}
      </span>
    )
  }

  const { at, by, confirmed, viaSystem } = lastContact
  return (
    <span className="text-xs text-gray-500" title={fullTimestamp(at)}>
      {confirmed ? 'Last contacted' : 'Link created'}
      {': '}
      <span className="font-medium text-gray-700">{by || 'someone'}</span>
      {', '}{timeAgo(at)}
      {confirmed
        ? (viaSystem
            ? <span className="text-gray-400"> via the Reviewtap System</span>
            // Not GHL: someone's own phone. Amber, because this is the leak.
            : <span className="text-amber-600"> outside the system</span>)
        // Pre-17-Jul rows recorded link creation as a "send". We cannot know
        // retroactively whether it went out, so we say exactly that.
        : <span className="text-amber-600"> (send not confirmed)</span>}
    </span>
  )
}
