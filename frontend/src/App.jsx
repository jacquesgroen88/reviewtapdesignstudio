import { useState } from 'react'
import ProductPicker  from './components/ProductPicker.jsx'
import DesignCanvas   from './components/DesignCanvas.jsx'
import AdminPanel     from './components/AdminPanel.jsx'
import OrdersPanel    from './components/OrdersPanel.jsx'
import DesignLibrary  from './components/DesignLibrary.jsx'
import { getProduct } from './lib/products.js'

export default function App() {
  const [session,        setSession]        = useState(null)
  const [pendingPrefill, setPendingPrefill] = useState(null)    // context awaiting product choice
  const [studioView,     setStudioView]     = useState('home')  // 'home' | 'picker'
  const [tab,            setTab]            = useState('orders') // 'orders' | 'studio' | 'admin'

  // Start a brand-new design (from the picker). A design row is created on first Save.
  function handleStart(sessionData) {
    // sessionData = { jobName, product, variantId }
    const prefill = { ...(pendingPrefill || {}), designId: null, savedDesign: null }
    const origin = pendingPrefill?.rowSlug ? 'orders' : 'studio'
    setSession({
      ...sessionData,
      jobName: pendingPrefill?.companyName || sessionData.jobName,
      prefill, origin,
    })
    setPendingPrefill(null)
    setTab('studio')
  }

  // Open an existing saved design directly into the editor
  async function handleOpenDesign(designMeta, origin = 'studio') {
    try {
      const res = await fetch(`/api/designs/${designMeta.id}`)
      if (!res.ok) return
      const full = await res.json()
      const product = getProduct(full.product_id)
      if (!product) return
      setSession({
        jobName:   designMeta.ownerName || full.name,
        product,
        variantId: full.variant_id,
        origin,
        prefill: {
          rowSlug:     full.owner_slug || null,
          designId:    full.id,
          designName:  full.name,
          companyName: designMeta.ownerName || full.name,
          logoUrl:        designMeta.logoUrl,
          googleReviewUrl: designMeta.googleReviewUrl,
          savedDesign: { name: full.name, design: full.design },
        },
      })
      setPendingPrefill(null)
      setTab('studio')
    } catch { /* ignore */ }
  }

  // Leave the editor / picker back to wherever we came from
  function handleBack() {
    const origin = session?.origin || (tab === 'studio' ? 'studio' : 'orders')
    setSession(null)
    setPendingPrefill(null)
    if (origin === 'orders') { setTab('orders') }
    else { setTab('studio'); setStudioView('home') }
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
    setStudioView('picker')
    setTab('studio')
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
              <NavTab active={tab === 'orders'} onClick={() => { setTab('orders'); setSession(null) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                Orders
              </NavTab>
              <NavTab active={tab === 'studio'} onClick={() => { setTab('studio'); setSession(null); setStudioView('home') }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>
                </svg>
                Design Studio
              </NavTab>
              <NavTab active={tab === 'admin'} onClick={() => { setTab('admin'); setSession(null) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M17 20h3M20 17v3"/>
                </svg>
                QR Codes
              </NavTab>
            </nav>
          </div>

          {tab === 'studio' && session && (
            <button onClick={handleBack} className="btn-ghost text-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              {session.origin === 'orders' ? 'Back to orders' : 'Back to library'}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {tab === 'orders' && <OrdersPanel onNewDesign={handleNewOrderDesign} onOpenDesign={(d) => handleOpenDesign(d, 'orders')} />}
        {tab === 'admin'  && <AdminPanel />}
        {tab === 'studio' && session && (
          <DesignCanvas
            key={(session.prefill?.designId || 'new') + '-' + session.product.id}
            product={session.product}
            initialVariantId={session.variantId}
            jobName={session.jobName}
            prefill={session.prefill}
            onOrderComplete={() => { setSession(null); setStudioView('home') }}
          />
        )}
        {tab === 'studio' && !session && studioView === 'picker' && (
          <ProductPicker
            onStart={handleStart}
            prefill={pendingPrefill}
            onCancel={() => { setStudioView('home'); setPendingPrefill(null) }}
          />
        )}
        {tab === 'studio' && !session && studioView === 'home' && (
          <DesignLibrary
            onNewDesign={() => { setPendingPrefill(null); setStudioView('picker') }}
            onOpenDesign={(d) => handleOpenDesign(d, 'studio')}
          />
        )}
      </main>
    </div>
  )
}

function NavTab({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150
        ${active ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
      {children}
    </button>
  )
}
