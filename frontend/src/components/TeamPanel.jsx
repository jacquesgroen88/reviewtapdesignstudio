import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api.js'

// Admin-only: invite team members by email (magic link → /welcome), see who
// has access, remove access. The server enforces admin on every endpoint.
export default function TeamPanel() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [msg,     setMsg]     = useState(null)
  const [email,   setEmail]   = useState('')
  const [role,    setRole]    = useState('designer')
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch('/api/team')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text())
      setMembers(await res.json())
    } catch (err) {
      setError(err.message.includes('Admin') ? 'Only admins can manage the team.' : `Could not load the team: ${err.message}`)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  function showMsg(text) { setMsg(text); setTimeout(() => setMsg(null), 4000) }

  async function invite(e) {
    e?.preventDefault()
    if (!email.trim()) return
    setInviting(true); setError(null)
    try {
      const res = await apiFetch('/api/team/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'invite failed')
      showMsg(`Invite sent to ${email.trim()}`)
      setEmail('')
      load()
    } catch (err) { setError(`Invite failed: ${err.message}`) }
    finally { setInviting(false) }
  }

  async function remove(m) {
    if (!confirm(`Remove ${m.displayName || m.email}'s access? Their designs stay in the library.`)) return
    try {
      const res = await apiFetch(`/api/team/${m.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'remove failed')
      showMsg('Access removed')
      load()
    } catch (err) { setError(`Remove failed: ${err.message}`) }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 fade-in">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Team</h1>
        <p className="text-sm text-gray-400 mt-0.5">Who can sign in to the studio. Invites arrive as an email link.</p>
      </div>

      <form onSubmit={invite} className="card p-4 flex items-end gap-2 mb-5 flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="label" htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" className="input-field" placeholder="name@example.com"
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="invite-role">Role</label>
          <select id="invite-role" className="input-field" value={role} onChange={e => setRole(e.target.value)}>
            <option value="designer">Designer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit" className="btn-primary" disabled={inviting || !email.trim()}>
          {inviting ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      {msg   && <div className="mb-4 px-4 py-2.5 rounded-xl text-sm font-medium bg-brand-50 text-brand-700">{msg}</div>}
      {error && <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.id} className="card p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 truncate">{m.displayName || m.email}</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{m.role}</span>
                  {m.invitedPending && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Invite pending</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {m.email}
                  {m.lastSignInAt && <> · last signed in {new Date(m.lastSignInAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</>}
                </p>
              </div>
              <button onClick={() => remove(m)} title="Remove access" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
