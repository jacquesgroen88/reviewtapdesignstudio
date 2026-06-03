import { useState } from 'react'
import { getAllProducts } from '../lib/products.js'

const PRODUCTS = getAllProducts()

export default function ProductPicker({ onStart, prefill }) {
  // If launched from an order, default to the product they actually ordered
  const initialProduct = prefill?.orderedCard && !prefill?.orderedStand
    ? (PRODUCTS.find(p => p.id === 'card') || PRODUCTS[0])
    : PRODUCTS[0]

  const [selectedProduct, setSelectedProduct] = useState(initialProduct)
  const [selectedVariant,  setSelectedVariant]  = useState(initialProduct.defaultVariant)
  const [jobName,          setJobName]           = useState(prefill?.companyName || '')

  const designsByProduct = prefill?.designsByProduct || {}

  function handleProductChange(product) {
    setSelectedProduct(product)
    setSelectedVariant(product.defaultVariant)
  }

  function handleStart() {
    onStart({
      jobName:   jobName.trim(),
      product:   selectedProduct,
      variantId: selectedVariant,
    })
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-56px)] p-6 fade-in">
      <div className="w-full max-w-lg space-y-6">

        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">New design</h1>
          {prefill?.companyName ? (
            <p className="text-gray-400 text-sm">
              Designing for <span className="font-semibold text-brand-600">{prefill.companyName}</span> — choose the product and colour.
            </p>
          ) : (
            <p className="text-gray-400 text-sm">Pick a product and template, then start placing the logo.</p>
          )}
        </div>

        {/* Job name (optional) */}
        <div className="card p-5 space-y-4">
          <div>
            <label className="label" htmlFor="jobName">
              Client / job name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="jobName"
              type="text"
              className="input-field"
              placeholder="e.g. The Coffee House"
              value={jobName}
              onChange={e => setJobName(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Product selection */}
        <div className="card p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Product</p>
          <div className="grid grid-cols-2 gap-3">
            {PRODUCTS.map(product => (
              <button
                key={product.id}
                onClick={() => handleProductChange(product)}
                className={`relative p-4 rounded-xl border-2 text-left transition-all duration-150
                  ${selectedProduct.id === product.id
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                  }`}
              >
                {selectedProduct.id === product.id && (
                  <div className="absolute top-3 right-3 w-4 h-4 bg-brand-500 rounded-full flex items-center justify-center">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                )}
                <ProductIcon id={product.id} selected={selectedProduct.id === product.id} />
                <p className={`text-sm font-semibold mt-2 ${selectedProduct.id === product.id ? 'text-brand-700' : 'text-gray-800'}`}>
                  {product.name}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{product.description}</p>
                {designsByProduct[product.id] && (
                  <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-brand-600">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    Saved — opens to edit
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Template variant */}
        {selectedProduct.templateVariants.length > 1 && (
          <div className="card p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Stand colour</p>
            <div className="flex gap-2">
              {selectedProduct.templateVariants.map(v => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border-2 text-sm font-medium transition-all duration-150
                    ${selectedVariant === v.id
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-100 bg-white text-gray-600 hover:border-gray-200'
                    }`}
                >
                  {/* Colour swatch */}
                  <span className={`w-4 h-4 rounded-full border-2 ${v.id === 'white' ? 'bg-white border-gray-300' : 'bg-gray-900 border-gray-700'}`} />
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button className="btn-primary w-full text-base py-3.5" onClick={handleStart}>
          Start designing
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

function ProductIcon({ id, selected }) {
  const color = selected ? '#0d9276' : '#d1d5db'
  if (id === 'stand') return (
    <svg width="28" height="32" viewBox="0 0 28 32" fill="none">
      <rect x="2" y="1" width="24" height="24" rx="2" stroke={color} strokeWidth="2"/>
      <rect x="6" y="25" width="16" height="6" rx="1" stroke={color} strokeWidth="2"/>
      <line x1="6" y1="8" x2="22" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="6" y1="12" x2="18" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
  return (
    <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
      <rect x="1" y="1" width="30" height="20" rx="3" stroke={color} strokeWidth="2"/>
      <line x1="5" y1="8" x2="15" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="5" y1="12" x2="12" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="11" r="4" stroke={color} strokeWidth="1.5"/>
    </svg>
  )
}
