import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const navigate = useNavigate()

  async function signIn(e) {
    e?.preventDefault()
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setBusy(true); setError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      navigate('/orders', { replace: true })
    } catch (err) {
      setError(err.message === 'Invalid login credentials' ? 'Wrong email or password.' : err.message)
    } finally { setBusy(false) }
  }

  // Fallback / password reset: emails a magic link that lands on /welcome
  async function sendLink() {
    if (!email.trim()) { setError('Enter your email first, then request a link.'); return }
    setBusy(true); setError('')
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/welcome` },
      })
      if (error) throw error
      setLinkSent(true)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <form onSubmit={signIn} className="card w-full max-w-sm p-8 space-y-4">
        <div className="text-center">
          <img src="/reviewtap-icon.png" alt="ReviewTap" className="w-12 h-12 object-contain mx-auto mb-3" />
          <h1 className="text-lg font-bold text-gray-900">Review<span className="text-brand-500">Tap</span> Studio</h1>
          <p className="text-sm text-gray-400 mt-0.5">Sign in to continue</p>
        </div>

        <div>
          <label className="label" htmlFor="login-email">Email</label>
          <input id="login-email" type="email" className="input-field" autoComplete="email" autoFocus
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="login-password">Password</label>
          <input id="login-password" type="password" className="input-field" autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
        {linkSent && <p className="text-xs text-brand-600">Login link sent — check your inbox and open it on this device.</p>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" onClick={sendLink} disabled={busy}
          className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors">
          Forgot password / first time? Email me a login link
        </button>
      </form>
    </div>
  )
}
