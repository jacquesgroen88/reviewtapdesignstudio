import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'

let qrIdCounter = 0

const BASE_URL = import.meta.env.VITE_QR_BASE_URL || 'http://localhost:4000/r'

export default function QRPanel({ onQRReady, variantId, prefillUrl }) {
  const isBlack = variantId === 'black'

  const [savedCodes,  setSavedCodes]  = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [backendDown, setBackendDown] = useState(false)

  // Manual URL fallback (used when backend is down)
  const [manualUrl,   setManualUrl]   = useState(prefillUrl || '')
  const [fgColor,     setFgColor]     = useState(isBlack ? '#ffffff' : '#000000')
  const [bgColor,     setBgColor]     = useState(isBlack ? '#000000' : '#ffffff')
  const [ecLevel,     setEcLevel]     = useState('M')
  const [preview,     setPreview]     = useState(null)
  const [generating,  setGenerating]  = useState(false)
  const [error,       setError]       = useState('')
  const [activeTab,   setActiveTab]   = useState('saved')  // 'saved' | 'manual'

  // Sync colours when variant changes
  useEffect(() => {
    setFgColor(isBlack ? '#ffffff' : '#000000')
    setBgColor(isBlack ? '#000000' : '#ffffff')
  }, [isBlack])

  // Load saved QR codes from backend
  useEffect(() => {
    fetch('/api/qr')
      .then(r => r.json())
      .then(data => { setSavedCodes(data); setLoadingList(false) })
      .catch(() => { setBackendDown(true); setLoadingList(false); setActiveTab('manual') })
  }, [])

  // Live preview for manual mode
  useEffect(() => {
    if (activeTab !== 'manual' || !manualUrl.trim()) { setPreview(null); return }
    let cancelled = false
    QRCode.toDataURL(manualUrl.trim(), {
      color: { dark: fgColor, light: bgColor },
      width: 160, errorCorrectionLevel: ecLevel, margin: 1,
    }).then(d => { if (!cancelled) setPreview(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [manualUrl, fgColor, bgColor, ecLevel, activeTab])

  async function addSavedQR(qr) {
    setGenerating(true)
    const redirectUrl = `${BASE_URL}/${qr.id}`
    try {
      const dataUrl = await QRCode.toDataURL(redirectUrl, {
        color: { dark: fgColor, light: bgColor },
        width: 600, errorCorrectionLevel: ecLevel, margin: 1,
      })
      const id = `qr_${++qrIdCounter}`
      onQRReady({
        id, name: `QR — ${qr.label}`,
        originalSrc: dataUrl, processedSrc: dataUrl,
        bgRemoved: false, isQR: true,
      })
    } finally { setGenerating(false) }
  }

  async function addManualQR() {
    if (!manualUrl.trim()) { setError('Enter a URL first.'); return }
    setError(''); setGenerating(true)
    try {
      const dataUrl = await QRCode.toDataURL(manualUrl.trim(), {
        color: { dark: fgColor, light: bgColor },
        width: 600, errorCorrectionLevel: ecLevel, margin: 1,
      })
      const id = `qr_${++qrIdCounter}`
      onQRReady({
        id, name: `QR — ${manualUrl.trim().replace(/^https?:\/\//, '').slice(0, 30)}`,
        originalSrc: dataUrl, processedSrc: dataUrl,
        bgRemoved: false, isQR: true,
      })
    } catch (err) { setError('Failed to generate QR.') }
    finally       { setGenerating(false) }
  }

  return (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">QR Code</h3>

      {/* Colour row — always visible */}
      <div className="flex gap-2">
        <ColorSwatch id="qr-fg" label="QR colour"   value={fgColor} onChange={setFgColor} />
        <ColorSwatch id="qr-bg" label="Background"  value={bgColor} onChange={setBgColor} />
      </div>

      {/* Error correction */}
      <div className="flex gap-1">
        {['L','M','Q','H'].map(level => (
          <button key={level} onClick={() => setEcLevel(level)}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors
              ${ecLevel === level ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {level}
          </button>
        ))}
      </div>

      {/* Tabs: Saved / Manual */}
      {!backendDown && (
        <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
          {[['saved','Saved codes'],['manual','Custom URL']].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors
                ${activeTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Saved codes tab */}
      {activeTab === 'saved' && !backendDown && (
        <div className="space-y-1.5">
          {loadingList ? (
            <div className="flex justify-center py-3">
              <svg className="animate-spin w-4 h-4 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </div>
          ) : savedCodes.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No QR codes yet — add them in the QR Codes tab.</p>
          ) : (
            savedCodes.map(qr => (
              <div key={qr.id} className="flex items-center gap-2 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors group">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{qr.label}</p>
                  <p className="text-xs text-gray-400 font-mono">/r/{qr.id}</p>
                </div>
                <button
                  onClick={() => addSavedQR(qr)}
                  disabled={generating}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Manual URL tab */}
      {(activeTab === 'manual' || backendDown) && (
        <div className="space-y-2">
          {backendDown && (
            <p className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg">Backend offline — using direct URL mode.</p>
          )}
          <input
            type="url"
            className="input-field text-xs"
            placeholder="https://g.page/r/..."
            value={manualUrl}
            onChange={e => setManualUrl(e.target.value)}
          />
          {preview && (
            <div className="flex justify-center">
              <img src={preview} alt="QR preview" className="w-16 h-16 rounded border border-gray-100" />
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button className="btn-primary w-full text-sm" disabled={!manualUrl.trim() || generating} onClick={addManualQR}>
            {generating ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> : null}
            Add QR to canvas
          </button>
        </div>
      )}
    </div>
  )
}

function ColorSwatch({ id, label, value, onChange }) {
  const ref = useRef(null)
  return (
    <div className="flex-1">
      <label className="label">{label}</label>
      <div className="flex items-center gap-2 h-9 px-2.5 bg-white border border-gray-200 rounded-xl cursor-pointer"
        onClick={() => ref.current?.click()}>
        <span className="w-4 h-4 rounded border border-gray-200 shrink-0" style={{ background: value }} />
        <span className="text-xs text-gray-500 font-mono">{value}</span>
        <input ref={ref} id={id} type="color" className="sr-only" value={value} onChange={e => onChange(e.target.value)} />
      </div>
    </div>
  )
}
