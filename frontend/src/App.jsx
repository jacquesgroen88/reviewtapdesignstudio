import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, NavLink, Navigate, Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import ProductPicker  from './components/ProductPicker.jsx'
import DesignCanvas   from './components/DesignCanvas.jsx'
import AdminPanel     from './components/AdminPanel.jsx'
import OrdersPanel    from './components/OrdersPanel.jsx'
import DesignLibrary  from './components/DesignLibrary.jsx'
import Login          from './components/Login.jsx'
import Welcome        from './components/Welcome.jsx'
import TeamPanel      from './components/TeamPanel.jsx'
import ActivityPanel  from './components/ActivityPanel.jsx'
import { getProduct } from './lib/products.js'
import { supabase, authConfigured } from './lib/supabase.js'
import { apiFetch } from './lib/api.js'

// Each editor session gets a stable key so the mounted DesignCanvas survives
// the /designstudio/new → /designstudio/:id URL swap after the first save.
let sessionCounter = 0

export default function App() {
  const [session,        setSession]        = useState(null)
  const [pendingPrefill, setPendingPrefill] = useState(null)    // context awaiting product choice
  // Auth: authSession = Supabase session; profile = team row (null until /welcome)
  const [authReady,   setAuthReady]   = useState(false)
  const [authSession, setAuthSession] = useState(null)
  const [profile,     setProfile]     = useState(null)
  const [profileChecked, setProfileChecked] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const inEditor = !!session && /^\/designstudio\/[^/]+$/.test(location.pathname)

  // ── Auth session tracking ───────────────────────────────────────────────────
  useEffect(() => {
    if (!authConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      setAuthSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setAuthSession(s)
      setAuthReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Load the team profile once signed in (null profile → /welcome setup)
  useEffect(() => {
    if (!authSession) { setProfile(null); setProfileChecked(false); return }
    let cancelled = false
    apiFetch('/api/team/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { setProfile(d?.profile ?? null); setProfileChecked(true) } })
      .catch(() => { if (!cancelled) setProfileChecked(true) })
    return () => { cancelled = true }
  }, [authSession?.access_token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function signOut() {
    if (inEditor && !confirm('Sign out? Unsaved changes will be lost.')) return
    setSession(null)
    setPendingPrefill(null)
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  // Warn before closing/refreshing the tab while a design is open in the editor
  useEffect(() => {
    if (!inEditor) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [inEditor])

  // Start a brand-new design (from the picker). A design row is created on first Save.
  function handleStart(sessionData) {
    // sessionData = { jobName, orderNumber, product, variantId }
    const prefill = {
      ...(pendingPrefill || {}),
      // Typed order # wins over the one carried from the order card
      orderNumber: sessionData.orderNumber || pendingPrefill?.orderNumber || '',
      designId: null, savedDesign: null,
    }
    const origin = pendingPrefill?.rowSlug ? 'orders' : 'studio'
    setSession({
      ...sessionData,
      jobName: pendingPrefill?.companyName || sessionData.jobName,
      prefill, origin,
      key: `sess_${++sessionCounter}`,
    })
    setPendingPrefill(null)
    // URL stays /designstudio/new — the editor renders because a session now exists
  }

  // Build an editor session from a saved design (used by open-clicks AND deep links)
  const openDesignById = useCallback(async (id, origin = 'studio', extras = {}) => {
    const res = await apiFetch(`/api/designs/${id}`)
    if (!res.ok) throw new Error('Could not load that design — it may have been deleted.')
    const full = await res.json()
    const product = getProduct(full.product_id)
    if (!product) throw new Error(`Unknown product type "${full.product_id}".`)
    setSession({
      jobName:   extras.ownerName || full.name,
      product,
      variantId: full.variant_id,
      origin,
      key: `sess_${++sessionCounter}`,
      prefill: {
        rowSlug:     full.owner_slug || null,
        designId:    full.id,
        designName:  full.name,
        companyName: extras.ownerName || full.name,
        orderNumber: full.order_number || extras.orderNumber || '',
        logoUrl:         extras.logoUrl,
        googleReviewUrl: extras.googleReviewUrl,
        savedDesign: { name: full.name, design: full.design },
      },
    })
    setPendingPrefill(null)
  }, [])

  // Open an existing saved design directly into the editor
  async function handleOpenDesign(designMeta, origin = 'studio') {
    try {
      await openDesignById(designMeta.id, origin, designMeta)
      navigate(`/designstudio/${designMeta.id}`)
    } catch (err) {
      alert(err.message || 'Could not open the design.')
    }
  }

  // Leave the editor / picker back to wherever we came from
  function leaveEditor() {
    const origin = session?.origin || (pendingPrefill?.rowSlug ? 'orders' : 'studio')
    setSession(null)
    setPendingPrefill(null)
    navigate(origin === 'orders' ? '/orders' : '/designstudio')
  }

  // "+ New design" on an order → picker scoped to that order
  function handleNewOrderDesign(order) {
    setPendingPrefill({
      logoUrl:         order.logoUrl,
      googleReviewUrl: order.googleReviewUrl,
      orderNumber:     order.orderNumber,
      companyName:     order.companyName,
      rowSlug:         order.rowSlug,
      orderedStand:    order.orderedStand,
      orderedCard:     order.orderedCard,
    })
    setSession(null)
    navigate('/designstudio/new')
  }

  // First save of a new design: remember its id and put it in the URL
  // (replace, so Back doesn't return to /new and spawn a duplicate editor).
  function handleFirstSave(id) {
    setSession(s => (s ? { ...s, savedAsId: id } : s))
    navigate(`/designstudio/${id}`, { replace: true })
  }

  // Nav tabs: confirm before abandoning an open editor session
  function guardedNavClick(e) {
    if (inEditor && !confirm('Leave the editor? Unsaved changes will be lost.')) {
      e.preventDefault()
      return
    }
    setSession(null)
    setPendingPrefill(null)
  }

  // ── Auth gates ──────────────────────────────────────────────────────────────
  if (!authConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="card max-w-md p-8 text-center space-y-2">
          <h1 className="text-lg font-bold text-gray-900">Studio not configured</h1>
          <p className="text-sm text-gray-500">
            VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set for this deploy,
            so sign-in can't work. Set them in Netlify env vars and redeploy.
          </p>
        </div>
      </div>
    )
  }

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      </div>
    )
  }

  const onAuthPage = location.pathname === '/login' || location.pathname === '/welcome'
  if (!authSession && !onAuthPage) return <AuthShell><Navigate to="/login" replace /></AuthShell>
  // Signed in but no profile yet (fresh invite) → finish setup first
  if (authSession && profileChecked && !profile && !onAuthPage) return <AuthShell><Navigate to="/welcome" replace /></AuthShell>

  if (onAuthPage) {
    return (
      <AuthShell>
        <Routes>
          <Route path="/login" element={authSession && profile ? <Navigate to="/orders" replace /> : <Login />} />
          <Route path="/welcome" element={<Welcome session={authSession} profile={profile} onProfileSaved={(p) => { if (p) setProfile(p) }} />} />
        </Routes>
      </AuthShell>
    )
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-full px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 shrink-0">
              <img src="/reviewtap-icon.png" alt="ReviewTap" className="w-7 h-7 object-contain" />
              <span className="font-bold text-gray-900 tracking-tight">
                Review<span className="text-brand-500">Tap</span> <span className="font-semibold text-gray-400">Studio</span>
              </span>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Internal</span>
            </div>

            <nav className="flex items-center gap-1">
              <NavTab to="/orders" onClick={guardedNavClick}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                Orders
              </NavTab>
              <NavTab to="/designstudio" end onClick={guardedNavClick}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>
                </svg>
                Design Studio
              </NavTab>
              <NavTab to="/qrcodes" onClick={guardedNavClick}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M17 20h3M20 17v3"/>
                </svg>
                QR Codes
              </NavTab>
              <NavTab to="/activity" onClick={guardedNavClick}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
                Activity
              </NavTab>
              {isAdmin && (
                <NavTab to="/team" onClick={guardedNavClick}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Team
                </NavTab>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {inEditor && (
              <button onClick={leaveEditor} className="btn-ghost text-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
                {session.origin === 'orders' ? 'Back to orders' : 'Back to library'}
              </button>
            )}
            <Link to="/welcome" title="Account settings" className="text-sm text-gray-500 hover:text-gray-800 font-medium">
              {profile?.display_name || authSession?.user?.email}
            </Link>
            <button onClick={signOut} className="btn-ghost text-sm" title="Sign out">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={
            <OrdersPanel onNewDesign={handleNewOrderDesign} onOpenDesign={(d) => handleOpenDesign(d, 'orders')} />
          } />
          <Route path="/designstudio" element={
            <DesignLibrary
              onNewDesign={() => { setPendingPrefill(null); setSession(null); navigate('/designstudio/new') }}
              onOpenDesign={(d) => handleOpenDesign(d, 'studio')}
            />
          } />
          {/* One route handles /designstudio/new AND /designstudio/:id so the mounted
              editor survives the URL swap after the first save (no remount = no lost work). */}
          <Route path="/designstudio/:designId" element={
            <StudioEditorRoute
              session={session}
              pendingPrefill={pendingPrefill}
              openDesignById={openDesignById}
              onStart={handleStart}
              onPickerCancel={leaveEditor}
              onFirstSave={handleFirstSave}
              onOrderComplete={leaveEditor}
            />
          } />
          <Route path="/qrcodes" element={<AdminPanel />} />
          <Route path="/activity" element={<ActivityPanel />} />
          {isAdmin && <Route path="/team" element={<TeamPanel />} />}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
}

// Minimal chrome for login/welcome (no nav — the user isn't in yet)
function AuthShell({ children }) {
  return <div className="min-h-screen flex flex-col bg-gray-50">{children}</div>
}

// Editor route: designId === 'new' → picker (no session) or fresh editor (session);
// otherwise a saved design — reuse the in-memory session or deep-link fetch it.
function StudioEditorRoute({ session, pendingPrefill, openDesignById, onStart, onPickerCancel, onFirstSave, onOrderComplete }) {
  const { designId } = useParams()
  const isNew = designId === 'new'
  const matches = !!session && (isNew || session.prefill?.designId === designId || session.savedAsId === designId)
  const [loadError, setLoadError] = useState(null)

  // Deep link / refresh on /designstudio/:id with no matching session → fetch it
  useEffect(() => {
    if (isNew || matches) return
    setLoadError(null)
    openDesignById(designId, 'studio').catch(err => setLoadError(err.message || 'Could not load the design.'))
  }, [designId, isNew, matches, openDesignById])

  if (isNew && !session) {
    return (
      <ProductPicker
        onStart={onStart}
        prefill={pendingPrefill}
        onCancel={onPickerCancel}
      />
    )
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-gray-500">{loadError}</p>
        <Link to="/designstudio" className="btn-secondary text-sm">Back to the design library</Link>
      </div>
    )
  }

  if (!matches) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      </div>
    )
  }

  return (
    <DesignCanvas
      key={session.key}
      product={session.product}
      initialVariantId={session.variantId}
      jobName={session.jobName}
      prefill={session.prefill}
      onFirstSave={onFirstSave}
      onOrderComplete={onOrderComplete}
    />
  )
}

function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-center">
      <p className="text-2xl font-bold text-gray-300">404</p>
      <p className="text-sm text-gray-500">That page doesn't exist.</p>
      <div className="flex gap-2">
        <Link to="/orders" className="btn-secondary text-sm">Orders</Link>
        <Link to="/designstudio" className="btn-secondary text-sm">Design Studio</Link>
        <Link to="/qrcodes" className="btn-secondary text-sm">QR Codes</Link>
      </div>
    </div>
  )
}

function NavTab({ to, end, onClick, children }) {
  return (
    <NavLink to={to} end={end} onClick={onClick}
      className={({ isActive }) => `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150
        ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
      {children}
    </NavLink>
  )
}
