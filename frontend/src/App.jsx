import { useState } from 'react'
import ProductPicker from './components/ProductPicker.jsx'
import DesignCanvas  from './components/DesignCanvas.jsx'
import AdminPanel    from './components/AdminPanel.jsx'
import OrdersPanel   from './components/OrdersPanel.jsx'
import { getProduct } from './lib/products.js'

export default function App() {
  const [session, setSession] = useState(null)
  const [tab,     setTab]     = useState('orders')  // 'orders' | 'studio' | 'admin'

  function handleStart(sessionData) {
    setSession(sessionData)
    setTab('studio')
  }

  function handleBack() {
    setSession(null)
    setTab('orders')
  }

  // Called when designer clicks "Design" on an order card
  function handleDesignOrder(order) {
    // Determine which product to start with (stand takes priority)
    const productId = order.orderedStand ? 'stand' : 'card'
    const product   = getProduct(productId)

    setSession({
      jobName:    order.companyName || `Order ${order.orderNumber}`,
      product,
      variantId:  product.defaultVariant,
      // Pre-load data from Formaloo submission
      prefill: {
        logoUrl:        order.logoUrl,
        googleReviewUrl: order.googleReviewUrl,
        orderNumber:    order.orderNumber,
        companyName:    order.companyName,
        rowSlug:        order.rowSlug,
        orderedStand:   order.orderedStand,
        orderedCard:    order.orderedCard,
      },
    })
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
              <NavTab active={tab === 'studio'} onClick={() => setTab('studio')}>
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

          {tab === 'studio' && (
            <div className="flex items-center gap-4">
              {session?.jobName && (
                <span className="text-sm text-gray-500">
                  <span className="text-gray-400">Job:</span>{' '}
                  <span className="font-medium text-gray-700">{session.jobName}</span>
                </span>
              )}
              <button onClick={handleBack} className="btn-ghost text-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
                Back to orders
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {tab === 'orders' && <OrdersPanel onDesignOrder={handleDesignOrder} />}
        {tab === 'admin'  && <AdminPanel />}
        {tab === 'studio' && !session && <ProductPicker onStart={handleStart} />}
        {tab === 'studio' &&  session  && (
          <DesignCanvas
            key={session.product.id + '-' + session.variantId + '-' + (session.prefill?.rowSlug || 'manual')}
            product={session.product}
            initialVariantId={session.variantId}
            jobName={session.jobName}
            prefill={session.prefill}
            onOrderComplete={() => { setSession(null); setTab('orders') }}
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
