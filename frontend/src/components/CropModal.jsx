import { useState, useRef } from 'react'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { cropToDataUrl } from '../lib/logoPipeline.js'

const ASPECTS = [
  { id: 'free',     label: 'Free',     value: undefined },
  { id: 'square',   label: '1:1',      value: 1 },
  { id: 'original', label: 'Original', value: 'original' },
]

// Free-form crop-and-resize rectangle over `src` (always the UNCROPPED base
// image — bg-removed version if that step is active — so re-cropping can
// always expand back out, never compounds). `initialCrop` (nullable) is a
// previous {x,y,width,height} in the source image's native pixels; seeding
// it here is what makes re-opening crop show the last rect (spec Feature D).
export default function CropModal({ src, initialCrop, onApply, onClose }) {
  const imgRef = useRef(null)
  const [crop, setCrop] = useState()
  const [aspectId, setAspectId] = useState('free')
  const [busy, setBusy] = useState(false)

  function onImageLoad(e) {
    const img = e.currentTarget
    if (initialCrop && img.naturalWidth && img.naturalHeight) {
      const scaleX = img.width / img.naturalWidth
      const scaleY = img.height / img.naturalHeight
      setCrop({
        unit: 'px',
        x: initialCrop.x * scaleX,
        y: initialCrop.y * scaleY,
        width: initialCrop.width * scaleX,
        height: initialCrop.height * scaleY,
      })
    } else {
      setCrop({ unit: '%', x: 5, y: 5, width: 90, height: 90 })
    }
  }

  function selectAspect(a) {
    setAspectId(a.id)
    const img = imgRef.current
    if (!img) return
    if (a.value === undefined) return   // Free: keep the current rect, just drop the ratio lock
    const ratio = a.value === 'original' ? img.naturalWidth / img.naturalHeight : a.value
    setCrop(centerCrop(makeAspectCrop({ unit: '%', width: 80 }, ratio, img.width, img.height), img.width, img.height))
  }

  function resetCrop() {
    setCrop({ unit: '%', x: 5, y: 5, width: 90, height: 90 })
    setAspectId('free')
  }

  async function handleApply() {
    const img = imgRef.current
    if (!crop || !img) return
    if (!img.width || !img.height) {
      alert('The image has not finished rendering yet — try again in a moment.')
      return
    }
    setBusy(true)
    try {
      const scaleX = img.naturalWidth / img.width
      const scaleY = img.naturalHeight / img.height
      const pixelCrop = crop.unit === '%'
        ? {
            x: (crop.x / 100) * img.width * scaleX,
            y: (crop.y / 100) * img.height * scaleY,
            width: (crop.width / 100) * img.width * scaleX,
            height: (crop.height / 100) * img.height * scaleY,
          }
        : { x: crop.x * scaleX, y: crop.y * scaleY, width: crop.width * scaleX, height: crop.height * scaleY }
      if (pixelCrop.width < 2 || pixelCrop.height < 2) { setBusy(false); return }
      const dataUrl = await cropToDataUrl(src, pixelCrop)
      onApply(dataUrl, pixelCrop)
    } catch (err) {
      alert(`Crop failed: ${err.message || 'unknown error'}`)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Crop logo</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="text-center bg-gray-50 rounded-xl p-3 overflow-auto" style={{
          maxHeight: 420,   // fixed px, not vh — vh can resolve to 0 in some
                            // embedded/headless rendering contexts, collapsing
                            // the image to 0x0 (naturalWidth/Height stay correct,
                            // only the box model breaks) and feeding NaN into
                            // the crop-pixel math. Fixed px has no such failure mode.
          backgroundImage: 'repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%)', backgroundSize: '16px 16px',
        }}>
          <ReactCrop crop={crop} onChange={c => setCrop(c)} aspect={ASPECTS.find(a => a.id === aspectId)?.value === 'original' ? undefined : ASPECTS.find(a => a.id === aspectId)?.value} ruleOfThirds>
            <img ref={imgRef} src={src} onLoad={onImageLoad} alt="Crop source" style={{ display: 'block', maxWidth: '100%', maxHeight: 400, width: 'auto', height: 'auto' }} />
          </ReactCrop>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1">
            {ASPECTS.map(a => (
              <button key={a.id} onClick={() => selectAspect(a)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${aspectId === a.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {a.label}
              </button>
            ))}
          </div>
          <button onClick={resetCrop} className="text-xs text-gray-400 hover:text-gray-600">Reset</button>
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleApply} disabled={busy || !crop}>
            {busy ? 'Applying…' : 'Apply crop'}
          </button>
        </div>
      </div>
    </div>
  )
}
