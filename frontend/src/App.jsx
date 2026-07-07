import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, NavLink, Navigate, Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import ProductPicker  from './components/ProductPicker.jsx'
import DesignCanvas   from './components/DesignCanvas.jsx'
import AdminPanel     from './components/AdminPanel.jsx'
import OrdersPanel    from './components/OrdersPanel.jsx'
import DesignLibrary  from './components/DesignLibrary.jsx'
import { getProduct } from './lib/products.js'

// Each editor session gets a stable key so the mounted DesignCanvas survives
// the /designstudio/new → /designstudio/:id URL swap after the first save.
let sessionCounter = 0

export default function App() {
  const [session,        setSession]        = useState(null)
  const [pendingPrefill, setPendingPrefill] = useState(null)    // context awaiting product choice
  const navigate = useNavigate()
  const location = useLocation()

  const inEditor = !!session && /^\/designstudio\/[^/]+$/.test(location.pathname)

  // Warn before closing/refreshing the tab while a design is open in the editor
  useEffect(() => {
    if (!inEditor) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [inEditor])

  // Start a brand-new design (from the picker). A design row is created on first Save.
  function handleStart(sessionData) {
    // sessionData = { jobName, product, variantId }
    const prefill = { ...(pendingPrefill || {}), designId: null, savedDesign: null }
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
    const res = await fetch(`/api/designs/${id}`)
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

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-full px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <span className="font-bold text-gray-900 tracking-tight">
                ReviewTap <span className="text-brand-600">Studio</span>
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
            </nav>
          </div>

          {inEditor && (
            <button onClick={leaveEditor} className="btn-ghost text-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              {session.origin === 'orders' ? 'Back to orders' : 'Back to library'}
            </button>
          )}
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
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
