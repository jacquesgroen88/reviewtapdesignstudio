import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'

let qrIdCounter = 0

// Where dynamic QR codes redirect through. Defaults to this site's /r path,
// override with VITE_QR_BASE_URL (e.g. https://qr.reviewtap.co.za/r).
const BASE_URL = import.meta.env.VITE_QR_BASE_URL || `${window.location.origin}/r`

export default function QRPanel({ onQRReady, variantId, prefillUrl, prefillLabel }) {
  const isBlack = variantId === 'black'

  const [savedCodes,  setSavedCodes]  = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [backendDown, setBackendDown] = useState(false)
  const [activeTab,   setActiveTab]   = useState('new')   // 'new' | 'saved'

  // New dynamic QR form
  const [label,       setLabel]       = useState(prefillLabel || '')
  const [destination, setDestination] = useState(prefillUrl   || '')

  // Shared styling
  const [fgColor,     setFgColor]     = useState(isBlack ? '#ffffff' : '#000000')
  const [bgColor,     setBgColor]     = useState(isBlack ? '#000000' : '#ffffff')
  const [ecLevel,     setEcLevel]     = useState('M')

  const [preview,     setPreview]     = useState(null)
  const [working,     setWorking]     = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => {
    setFgColor(isBlack ? '#ffffff' : '#000000')
    setBgColor(isBlack ? '#000000' : '#ffffff')
  }, [isBlack])

  // Keep form in sync if a new order is prefilled
  useEffect(() => {
    if (prefillUrl)   setDestination(prefillUrl)
    if (prefillLabel) setLabel(prefillLabel)
  }, [prefillUrl, prefillLabel])

  async function loadSaved() {
    try {
      const res = await fetch('/api/qr')
      if (!res.ok) throw new Error()
      setSavedCodes(await res.json())
    } catch {
      setBackendDown(true)
    } finally {
      setLoadingList(false)
    }
  }
  useEffect(() => { loadSaved() }, [])

  // Live preview of the new-code destination (or its future /r URL)
  useEffect(() => {
    if (activeTab !== 'new' || !destination.trim()) { setPreview(null); return }
    let cancelled = false
    QRCode.toDataURL(destination.trim(), {
      color: { dark: fgColor, light: bgColor }, width: 160, errorCorrectionLevel: ecLevel, margin: 1,
    }).then(d => { if (!cancelled) setPreview(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [destination, fgColor, bgColor, ecLevel, activeTab])

  async function renderQRtoCanvas(encodeUrl, name) {
    const dataUrl = await QRCode.toDataURL(encodeUrl, {
      color: { dark: fgColor, light: bgColor }, width: 600, errorCorrectionLevel: ecLevel, margin: 1,
    })
    onQRReady({
      id: `qr_${++qrIdCounter}`, name,
      originalSrc: dataUrl, processedSrc: dataUrl, bgRemoved: false, isQR: true,
    })
  }

  // Create a dynamic QR: save to backend, encode the /r/:id redirect, add to canvas
  async function handleCreateDynamic() {
    if (!label.trim())       { setError('Enter a label.'); return }
    if (!destination.trim()) { setError('Enter a destination URL.'); return }
    setError(''); setWorking(true)
    try {
      if (backendDown) {
        // No backend — fall back to a static QR of the destination
        await renderQRtoCanvas(destination.trim(), `QR — ${label.trim()}`)
      } else {
        const res = await fetch('/api/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), destination: destination.trim() }),
        })
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'create failed') }
        const qr = await res.json()
        await renderQRtoCanvas(`${BASE_URL}/${qr.id}`, `QR — ${qr.label}`)
        setSavedCodes(prev => [qr, ...prev])
      }
    } catch (err) {
      setError(err.message || 'Failed to create QR')
    } finally { setWorking(false) }
  }

  async function addSavedQR(qr) {
    setWorking(true)
    try {
      await renderQRtoCanvas(`${BASE_URL}/${qr.id}`, `QR — ${qr.label}`)
    } finally { setWorking(false) }
  }

  return (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">QR Code</h3>

      {/* Shared styling: colours + error correction */}
      <div className="flex gap-2">
        <ColorSwatch id="qr-fg" label="QR colour"  value={fgColor} onChange={setFgColor} />
        <ColorSwatch id="qr-bg" label="Background" value={bgColor} onChange={setBgColor} />
      </div>
      <div className="flex gap-1">
        {['L','M','Q','H'].map(l => (
          <button key={l} onClick={() => setEcLevel(l)}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors
              ${ecLevel === l ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Tabs */}
      {!backendDown && (
        <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
          {[['new','New code'],['saved','Saved']].map(([id, lbl]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors
                ${activeTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {lbl}
            </button>
          ))}
        </div>
      )}

      {/* New dynamic QR */}
      {(activeTab === 'new' || backendDown) && (
        <div className="space-y-2">
          <div>
            <label className="label">Label</label>
            <input className="input-field text-xs" placeholder="e.g. The Coffee House"
              value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div>
            <label className="label">Destination (Google review URL)</label>
            <input className="input-field text-xs" type="url" placeholder="https://g.page/r/..."
              value={destination} onChange={e => setDestination(e.target.value)} />
          </div>
          {!backendDown && (
            <p className="text-xs text-gray-400">
              Creates a trackable QR you can re-point later without reprinting.
            </p>
          )}
          {preview && (
            <div className="flex justify-center">
              <img src={preview} alt="QR preview" className="w-16 h-16 rounded border border-gray-100" />
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button className="btn-primary w-full text-sm" disabled={working || !destination.trim()} onClick={handleCreateDynamic}>
            {working
              ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              : null}
            {backendDown ? 'Add QR to canvas' : 'Create & add to canvas'}
          </button>
        </div>
      )}

      {/* Saved codes */}
      {activeTab === 'saved' && !backendDown && (
        <div className="space-y-1.5">
          {loadingList ? (
            <div className="flex justify-center py-3">
              <svg className="animate-spin w-4 h-4 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </div>
          ) : savedCodes.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No saved codes yet.</p>
          ) : (
            savedCodes.map(qr => (
              <div key={qr.id} className="flex items-center gap-2 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{qr.label}</p>
                  <p className="text-xs text-gray-400 font-mono">/r/{qr.id} · {qr.scan_count ?? 0} scans</p>
                </div>
                <button onClick={() => addSavedQR(qr)} disabled={working}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors disabled:opacity-50">
                  Add
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {backendDown && (
        <p className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg">
          Backend offline — QR will encode the URL directly (not trackable).
        </p>
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
