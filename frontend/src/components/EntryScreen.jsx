import { useState } from 'react'
import { lookupOrder } from '../lib/mockOrders.js'
import { getProduct } from '../lib/products.js'

export default function EntryScreen({ onSubmit }) {
  const [businessName, setBusinessName] = useState('')
  const [orderNumber,  setOrderNumber]  = useState('')
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!businessName.trim()) { setError('Please enter your business name.'); return }
    if (!orderNumber.trim())  { setError('Please enter your order number.'); return }

    setLoading(true)
    // Simulate async lookup delay
    await new Promise(r => setTimeout(r, 500))

    const order = lookupOrder(orderNumber)
    setLoading(false)

    if (!order) {
      setError(`Order "${orderNumber.trim()}" not found. Please check your order number and try again.`)
      return
    }

    const products = order.products.map(id => getProduct(id)).filter(Boolean)
    onSubmit({ businessName: businessName.trim(), orderNumber: orderNumber.trim().toUpperCase(), products })
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-6 fade-in">
      <div className="w-full max-w-md">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-50 rounded-2xl mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-600">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M7 8h10M7 12h7M7 16h4"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Design your artwork</h1>
          <p className="text-gray-500 text-base leading-relaxed">
            Enter your details to get started. We'll load your products and guide you through each one.
          </p>
        </div>

        {/* Form */}
        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label" htmlFor="businessName">Business name</label>
              <input
                id="businessName"
                type="text"
                className="input-field"
                placeholder="e.g. The Coffee House"
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="label" htmlFor="orderNumber">Order number</label>
              <input
                id="orderNumber"
                type="text"
                className="input-field"
                placeholder="e.g. RT-1001"
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
              />
              <p className="mt-1.5 text-xs text-gray-400">Found in your purchase confirmation email.</p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Looking up order…
                </>
              ) : (
                <>
                  Start designing
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Your finished files are sent directly to print — no download needed.
        </p>
      </div>
    </div>
  )
}
