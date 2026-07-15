import { useCallback, useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { readFileAsDataURL } from '../lib/logoPipeline.js'
import QRPanel from './QRPanel.jsx'

let logoIdCounter = 0

// onToggleBgRemoval / onCropLogo are owned by the parent (DesignCanvas) so the
// same pipeline logic is shared with the canvas's right-click menu — this
// panel only owns the loading-spinner UI, not the image processing itself.
export default function LogoPanel({ logos, onLogosChange, onLogoReady, onLogoRemove, onToggleBgRemoval, onReprocessBg, onCropLogo, variantId, prefillGoogleUrl, prefillLabel }) {
  const [processingIds, setProcessingIds] = useState(new Set())
  const [tolerances, setTolerances]       = useState({})   // per-logo tolerance slider value

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
    setProcessingIds(prev => new Set([...prev, logoId]))
    try {
      await onToggleBgRemoval(logoId, currentValue)
    } catch (err) {
      console.error('BG removal failed:', err)
      alert(`Background removal failed: ${err?.message || err}. The AI fallback downloads on first use — if this is the first try, give it a moment and try again.`)
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(logoId); return s })
    }
  }

  // Re-run removal with an explicit method (tolerance slider release, or the
  // AI/knockout switch). Wraps the parent handler in the same spinner.
  async function reprocessBg(logoId, opts) {
    setProcessingIds(prev => new Set([...prev, logoId]))
    try {
      await onReprocessBg(logoId, opts)
    } catch (err) {
      console.error('BG reprocess failed:', err)
      alert(`Background removal failed: ${err?.message || err}. The AI fallback downloads on first use — if this is the first try, give it a moment and try again.`)
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(logoId); return s })
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

                {/* BG removal */}
                <div className="pt-2 border-t border-gray-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-700">Remove background</p>
                      <p className="text-xs text-gray-400">
                        {logo.bgRemoved
                          ? (logo.bgMethodUsed === 'ai' ? 'AI cutout (photo logo)'
                            : logo.bgMethodUsed === 'none' ? 'Already transparent — left as-is'
                            : 'Knocked out · free & instant')
                          : 'Free · runs in browser'}
                      </p>
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

                  {/* Fine-tune controls, shown once removal is on */}
                  {logo.bgRemoved && !isProcessing && (
                    <div className="space-y-2">
                      {logo.bgMethodUsed === 'knockout' && (
                        <div>
                          <div className="flex items-center justify-between text-xs text-gray-400 mb-0.5">
                            <span>Edge sensitivity</span>
                            <span>{tolerances[logo.id] ?? logo.bgTolerance ?? 36}</span>
                          </div>
                          <input
                            type="range" min="8" max="90"
                            value={tolerances[logo.id] ?? logo.bgTolerance ?? 36}
                            onChange={(e) => setTolerances(t => ({ ...t, [logo.id]: +e.target.value }))}
                            onMouseUp={(e) => reprocessBg(logo.id, { method: 'knockout', tolerance: +e.target.value })}
                            onTouchEnd={(e) => reprocessBg(logo.id, { method: 'knockout', tolerance: +e.target.value })}
                            className="w-full accent-brand-500"
                          />
                          <p className="text-xs text-gray-300 leading-tight">Higher = removes more of a slightly-uneven background.</p>
                        </div>
                      )}
                      {logo.bgMethodUsed === 'ai' ? (
                        <button onClick={() => reprocessBg(logo.id, { method: 'knockout', tolerance: tolerances[logo.id] ?? logo.bgTolerance ?? 36 })}
                          className="text-xs font-medium text-gray-500 hover:text-gray-700 underline">
                          Flat background? Use fast knockout instead
                        </button>
                      ) : (
                        <button onClick={() => reprocessBg(logo.id, { method: 'ai' })}
                          className="text-xs font-medium text-gray-500 hover:text-gray-700 underline">
                          Edges look rough? Try AI cutout (photo logos)
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Crop */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                  <div>
                    <p className="text-xs font-medium text-gray-700">Crop</p>
                    <p className="text-xs text-gray-400">{logo.crop ? 'Cropped — click to adjust' : 'Trim whitespace or cut to the mark'}</p>
                  </div>
                  <button onClick={() => onCropLogo(logo.id)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                    {logo.crop ? 'Edit crop' : 'Crop…'}
                  </button>
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

      {/* Tips (collapsed by default to save space) */}
      <details className="bg-brand-50 rounded-xl px-3 py-2">
        <summary className="text-xs font-semibold text-brand-700 cursor-pointer select-none">Tips & shortcuts</summary>
        <ul className="text-xs text-brand-600 space-y-1 mt-2">
          <li>• Drag to move, handles to resize/rotate</li>
          <li>• Ctrl+scroll or +/− to zoom canvas</li>
          <li>• Space-drag to pan · Ctrl+Z/Y undo/redo</li>
          <li>• Ctrl+S saves · Delete removes selected</li>
        </ul>
      </details>
    </div>
  )
}

