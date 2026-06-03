import { useCallback, useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import QRPanel from './QRPanel.jsx'

let logoIdCounter = 0

export default function LogoPanel({ logos, onLogosChange, onLogoReady, onLogoRemove, variantId, prefillGoogleUrl, prefillLabel }) {
  const [processingIds, setProcessingIds] = useState(new Set())

  // Warm up the background-removal model in the background on mount so the
  // first toggle is fast (the ~30MB model downloads + caches once).
  useEffect(() => {
    let cancelled = false
    import('@imgly/background-removal')
      .then(mod => { if (!cancelled && mod.preload) return mod.preload() })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const onDrop = useCallback(async (acceptedFiles) => {
    for (const file of acceptedFiles) {
      const id  = `logo_${++logoIdCounter}`
      const src = await readFileAsDataURL(file)
      const entry = { id, name: file.name, originalSrc: src, processedSrc: src, bgRemoved: false }
      onLogosChange(prev => [...prev, entry])
      onLogoReady(entry)
    }
  }, [onLogosChange, onLogoReady])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/png': [], 'image/jpeg': [], 'image/svg+xml': [], 'image/webp': [] },
    multiple: true,
  })

  async function toggleBgRemoval(logoId, currentValue) {
    const logo = logos.find(l => l.id === logoId)
    if (!logo) return

    if (!currentValue) {
      setProcessingIds(prev => new Set([...prev, logoId]))
      try {
        const processedSrc = await removeBg(logo.originalSrc)
        const updated = { ...logo, bgRemoved: true, processedSrc }
        onLogosChange(prev => prev.map(l => l.id === logoId ? updated : l))
        onLogoReady(updated)
      } catch (err) {
        console.error('BG removal failed:', err)
        alert(`Background removal failed: ${err?.message || err}. The model downloads on first use — if this is the first try, give it a moment and try again.`)
      } finally {
        setProcessingIds(prev => { const s = new Set(prev); s.delete(logoId); return s })
      }
    } else {
      const updated = { ...logo, bgRemoved: false, processedSrc: logo.originalSrc }
      onLogosChange(prev => prev.map(l => l.id === logoId ? updated : l))
      onLogoReady(updated)
    }
  }

  function handleRemove(logoId) {
    onLogosChange(prev => prev.filter(l => l.id !== logoId))
    onLogoRemove(logoId)
  }

  // QR codes are added to the canvas the same way as logos
  function handleQRReady(qrEntry) {
    onLogosChange(prev => [...prev, qrEntry])
    onLogoReady(qrEntry)
  }

  // Split display: logos vs QR codes
  const assetLogos = logos.filter(l => !l.isQR)
  const assetQRs   = logos.filter(l =>  l.isQR)

  return (
    <div className="p-4 space-y-5">
      {/* ── Logos section ─────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Logo</h3>
        <p className="text-xs text-gray-400 leading-relaxed mb-3">Drop a logo file to place it on the canvas.</p>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors duration-150
            ${isDragActive ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'}`}
        >
          <input {...getInputProps()} />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className={`mx-auto mb-1.5 ${isDragActive ? 'text-brand-500' : 'text-gray-300'}`}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          {isDragActive ? (
            <p className="text-sm font-medium text-brand-600">Drop here</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-600">Drop logo here</p>
              <p className="text-xs text-gray-400 mt-0.5">PNG · JPG · SVG · WebP</p>
            </>
          )}
        </div>
      </div>

      {/* Logo list */}
      {assetLogos.length > 0 && (
        <div className="space-y-2">
          {assetLogos.map(logo => {
            const isProcessing = processingIds.has(logo.id)
            return (
              <div key={logo.id} className="card p-3 space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                    <img src={logo.processedSrc} alt={logo.name} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{logo.name}</p>
                    {logo.bgRemoved && (
                      <span className="inline-flex items-center gap-1 text-xs text-brand-600">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        BG removed
                      </span>
                    )}
                  </div>
                  <button onClick={() => handleRemove(logo.id)}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>

                {/* BG removal toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                  <div>
                    <p className="text-xs font-medium text-gray-700">Remove background</p>
                    <p className="text-xs text-gray-400">Free · runs in browser</p>
                  </div>
                  {isProcessing ? (
                    <div className="flex items-center gap-1.5">
                      <svg className="animate-spin w-4 h-4 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      <span className="text-xs text-gray-400">Processing…</span>
                    </div>
                  ) : (
                    <label className="toggle">
                      <input type="checkbox" checked={logo.bgRemoved} onChange={() => toggleBgRemoval(logo.id, logo.bgRemoved)} />
                      <div className="toggle-track" />
                      <div className="toggle-thumb" />
                    </label>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* QR codes list */}
      {assetQRs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">QR codes on canvas</p>
          {assetQRs.map(qr => (
            <div key={qr.id} className="flex items-center gap-2.5 p-2 rounded-xl border border-gray-100">
              <img src={qr.processedSrc} alt="QR" className="w-9 h-9 rounded border border-gray-100" />
              <p className="flex-1 min-w-0 text-xs text-gray-600 truncate">{qr.name}</p>
              <button onClick={() => handleRemove(qr.id)}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* QR Panel */}
      <QRPanel onQRReady={handleQRReady} variantId={variantId} prefillUrl={prefillGoogleUrl} prefillLabel={prefillLabel} />

      {/* Tips */}
      <div className="bg-brand-50 rounded-xl p-3 space-y-1">
        <p className="text-xs font-semibold text-brand-700">Tips</p>
        <ul className="text-xs text-brand-600 space-y-1">
          <li>• Drag to move, handles to resize/rotate</li>
          <li>• Ctrl+scroll or +/− to zoom canvas</li>
          <li>• Ctrl+Z / Ctrl+Y to undo / redo</li>
          <li>• Delete key removes selected item</li>
        </ul>
      </div>
    </div>
  )
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function removeBg(imageSrc) {
  // Lazy-load the heavy WASM model only when first needed
  const { removeBackground } = await import('@imgly/background-removal')
  // Fetch the source to a Blob first. This reliably handles data URLs,
  // object URLs, and our same-origin proxied logo URLs (passing a raw
  // string URL can fail to resolve inside the worker).
  const resp = await fetch(imageSrc)
  if (!resp.ok) throw new Error(`could not load image (${resp.status})`)
  const inputBlob = await resp.blob()
  const outBlob = await removeBackground(inputBlob)
  return URL.createObjectURL(outBlob)
}
