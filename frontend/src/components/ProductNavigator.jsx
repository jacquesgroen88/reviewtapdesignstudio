import { useState } from 'react'
import DesignCanvas from './DesignCanvas.jsx'

export default function ProductNavigator({ session, onAllDone }) {
  const { products, businessName, orderNumber } = session
  const [currentIndex, setCurrentIndex] = useState(0)
  const [completedProducts, setCompletedProducts] = useState([])
  const [uploadResults, setUploadResults] = useState([])
  const [submitting, setSubmitting] = useState(false)

  const currentProduct = products[currentIndex]
  const isLast = currentIndex === products.length - 1

  async function handleProductDone(tiffBlob) {
    const result = { product: currentProduct, blob: tiffBlob }
    const newResults = [...uploadResults, result]
    setUploadResults(newResults)
    setCompletedProducts(prev => [...prev, currentProduct.id])

    if (isLast) {
      // Upload all files
      setSubmitting(true)
      try {
        await uploadAll(newResults, businessName, orderNumber)
        onAllDone(newResults)
      } catch (err) {
        console.error('Upload failed:', err)
        // Still advance — show completion with warning
        onAllDone(newResults)
      }
    } else {
      setCurrentIndex(i => i + 1)
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)]">
      {/* Progress bar */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Product {currentIndex + 1} of {products.length}:&nbsp;
                <span className="text-brand-600">{currentProduct.name}</span>
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{currentProduct.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {products.map((p, i) => (
                <div
                  key={p.id}
                  className={`step-dot ${i < currentIndex ? 'done' : ''} ${i === currentIndex ? 'active' : ''}`}
                  title={p.name}
                />
              ))}
            </div>
          </div>
          {/* Progress bar fill */}
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${((currentIndex) / products.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative">
        {submitting && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4">
            <svg className="animate-spin w-10 h-10 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <p className="text-gray-700 font-medium">Sending files to print…</p>
          </div>
        )}
        <DesignCanvas
          key={currentProduct.id}
          product={currentProduct}
          businessName={businessName}
          onDone={handleProductDone}
          isLast={isLast}
        />
      </div>
    </div>
  )
}

async function uploadAll(results, businessName, orderNumber) {
  for (const { product, blob } of results) {
    const filename = `${businessName}_${product.name}_Design.tiff`
      .replace(/[^a-zA-Z0-9_.\- ]/g, '_')

    const formData = new FormData()
    formData.append('file', blob, filename)
    formData.append('businessName', businessName)
    formData.append('orderNumber', orderNumber)
    formData.append('productId', product.id)
    formData.append('filename', filename)

    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!res.ok) throw new Error(`Upload failed for ${filename}`)
  }
}
