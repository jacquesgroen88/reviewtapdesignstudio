import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/api.js'

// Landing page for invite/login magic links, and first-time account setup:
// set your display name (shown on designs) and a password for next time.
export default function Welcome({ session, profile, onProfileSaved }) {
  const [name,     setName]     = useState(profile?.display_name || '')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const navigate = useNavigate()

  const needsPassword = !profile   // first-time setup requires one

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="card w-full max-w-sm p-8 text-center space-y-3">
          <h1 className="text-lg font-bold text-gray-900">Link expired</h1>
          <p className="text-sm text-gray-400">This login link is no longer valid. Request a fresh one from the sign-in page.</p>
          <Link to="/login" className="btn-primary inline-flex">Go to sign in</Link>
        </div>
      </div>
    )
  }

  async function save(e) {
    e?.preventDefault()
    if (!name.trim()) { setError('Enter your name.'); return }
    if (needsPassword || password) {
      if (password.length < 10) { setError('Password must be at least 10 characters.'); return }
      if (password !== confirm) { setError("Passwords don't match."); return }
    }
    setBusy(true); setError('')
    try {
      if (password) {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
      }
      const res = await apiFetch('/api/team/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save your profile')
      onProfileSaved?.(await res.json().catch(() => null))
      navigate('/orders', { replace: true })
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <form onSubmit={save} className="card w-full max-w-sm p-8 space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-900">{profile ? 'Update your account' : 'Welcome to ReviewTap Studio'}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {profile ? 'Change your name or set a new password.' : 'Set up your account — takes 10 seconds.'}
          </p>
          <p className="text-xs text-gray-400 mt-1">{session.user?.email}</p>
        </div>

        <div>
          <label className="label" htmlFor="welcome-name">Your name <span className="text-gray-400 font-normal">(shown on designs you create)</span></label>
          <input id="welcome-name" className="input-field" autoFocus placeholder="e.g. Jacques"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="welcome-password">
            {profile ? <>New password <span className="text-gray-400 font-normal">(leave blank to keep current)</span></> : 'Choose a password'}
          </label>
          <input id="welcome-password" type="password" className="input-field" autoComplete="new-password"
            placeholder="At least 10 characters" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        {(needsPassword || password) && (
          <div>
            <label className="label" htmlFor="welcome-confirm">Confirm password</label>
            <input id="welcome-confirm" type="password" className="input-field" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : (profile ? 'Save changes' : 'Start using the studio')}
        </button>
      </form>
    </div>
  )
}
