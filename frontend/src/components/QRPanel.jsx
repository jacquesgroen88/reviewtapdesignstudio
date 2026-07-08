import { useState, useEffect, useRef } from 'react'
import { QR_STYLES, generateStyledQR, styleToGenOpts, QR_BASE_URL as BASE_URL } from '../lib/qr.js'
import { apiFetch } from '../lib/api.js'

let qrIdCounter = 0

export default function QRPanel({ onQRReady, variantId, prefillUrl, prefillLabel }) {
  const isBlack = variantId === 'black'

  const [savedCodes,  setSavedCodes]  = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [backendDown, setBackendDown] = useState(false)
  const [activeTab,   setActiveTab]   = useState(prefillUrl ? 'new' : 'saved')
  const [savedSearch, setSavedSearch] = useState('')

  const [label,       setLabel]       = useState(prefillLabel || '')
  const [destination, setDestination] = useState(prefillUrl   || '')

  // Black stands use cream (#fff6ea) QR modules on black; white stands use black on white
  const [fgColor,     setFgColor]     = useState(isBlack ? '#fff6ea' : '#000000')
  const [bgColor,     setBgColor]     = useState(isBlack ? '#000000' : '#ffffff')
  const [transparentBg, setTransparentBg] = useState(true)   // transparent by default
  const [ecLevel,     setEcLevel]     = useState('M')
  const [styleId,     setStyleId]     = useState('rounded')   // rounded by default

  // Background actually fed to the generator (transparent → no fill)
  const bgFill = transparentBg ? 'rgba(0,0,0,0)' : bgColor

  const [preview,     setPreview]     = useState(null)
  const [working,     setWorking]     = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => {
    setFgColor(isBlack ? '#fff6ea' : '#000000')
    setBgColor(isBlack ? '#000000' : '#ffffff')
  }, [isBlack])

  useEffect(() => {
    if (prefillUrl)   setDestination(prefillUrl)
    if (prefillLabel) setLabel(prefillLabel)
  }, [prefillUrl, prefillLabel])

  async function loadSaved() {
    try {
      const res = await apiFetch('/api/qr')
      if (!res.ok) throw new Error()
      const codes = await res.json()
      setSavedCodes(codes)
      // If there are no saved codes and we weren't prefilled, default to creating one
      if (!codes.length && !prefillUrl) setActiveTab('new')
    } catch {
      setBackendDown(true)
    } finally {
      setLoadingList(false)
    }
  }
  useEffect(() => { loadSaved() }, [])

  // Live preview (debounced via timeout) of the styled QR
  useEffect(() => {
    if (activeTab !== 'new' || !destination.trim()) { setPreview(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      generateStyledQR(destination.trim(), { fg: fgColor, bg: bgFill, ec: ecLevel, styleId, width: 200 })
        .then(d => { if (!cancelled) setPreview(d) })
        .catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [destination, fgColor, bgFill, ecLevel, styleId, activeTab])

  // styleOverride: render with a saved default_style instead of the panel state
  async function renderQRtoCanvas(encodeUrl, name, styleOverride) {
    const opts = styleOverride
      ? styleToGenOpts(styleOverride, 600)
      : { fg: fgColor, bg: bgFill, ec: ecLevel, styleId, width: 600 }
    const dataUrl = await generateStyledQR(encodeUrl, opts)
    onQRReady({
      id: `qr_${++qrIdCounter}`, name,
      originalSrc: dataUrl, processedSrc: dataUrl, bgRemoved: false, isQR: true,
    })
  }

  async function handleCreateDynamic() {
    if (!label.trim())       { setError('Enter a label.'); return }
    if (!destination.trim()) { setError('Enter a destination URL.'); return }
    setError(''); setWorking(true)
    try {
      if (backendDown) {
        await renderQRtoCanvas(destination.trim(), `QR — ${label.trim()}`)
      } else {
        // The style used here is saved as the code's default (presentation only)
        const style = { styleId, fg: fgColor, bg: bgColor, transparent: transparentBg, ec: ecLevel }
        const res = await apiFetch('/api/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), destination: destination.trim(), style }),
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
    setError(null)
    try {
      const saved = qr.default_style
      if (saved) {
        // Reflect the saved default in the panel controls, then render with it
        if (saved.styleId)             setStyleId(saved.styleId)
        if (saved.fg)                  setFgColor(saved.fg)
        if (saved.bg)                  setBgColor(saved.bg)
        if (saved.transparent != null) setTransparentBg(!!saved.transparent)
        if (saved.ec)                  setEcLevel(saved.ec)
      }
      await renderQRtoCanvas(`${BASE_URL}/${qr.id}`, `QR — ${qr.label}`, saved || undefined)
    } catch (err) {
      setError(err.message || 'Failed to add QR to canvas')
    } finally { setWorking(false) }
  }

  return (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">QR Code</h3>

      {/* Prominent mode switch: use an existing QR vs create a new one */}
      {!backendDown && (
        <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
          {[['saved', 'Use saved QR'], ['new', 'Create new QR']].map(([id, lbl]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors
                ${activeTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {lbl}
            </button>
          ))}
        </div>
      )}

      {/* Use a saved QR */}
      {activeTab === 'saved' && !backendDown && (
        <div className="space-y-1.5">
          {savedCodes.length > 4 && (
            <input className="input-field text-xs" placeholder="Search saved codes…"
              value={savedSearch} onChange={e => setSavedSearch(e.target.value)} />
          )}
          {loadingList ? (
            <div className="flex justify-center py-3">
              <svg className="animate-spin w-4 h-4 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </div>
          ) : savedCodes.length === 0 ? (
            <div className="text-center py-3">
              <p className="text-xs text-gray-400">No saved codes yet.</p>
              <button className="text-xs text-brand-600 font-medium mt-1" onClick={() => setActiveTab('new')}>Create one →</button>
            </div>
          ) : (
            savedCodes
              .filter(qr => qr.label.toLowerCase().includes(savedSearch.toLowerCase()))
              .map(qr => (
                <div key={qr.id} className="flex items-center gap-2 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{qr.label}</p>
                    <p className="text-xs text-gray-400 font-mono">
                      /r/{qr.id} · {qr.scan_count ?? 0} scans
                      {qr.created_at && <> · {new Date(qr.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                    </p>
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

      {/* Create a new QR (always saved to the library) */}
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
          {!backendDown
            ? <p className="text-xs text-gray-400">Saved to your QR library &amp; trackable — re-point it later without reprinting.</p>
            : <p className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg">Backend offline — QR will encode the URL directly (not trackable).</p>}
          {preview && (
            <div className="flex justify-center">
              <img src={preview} alt="QR preview" className="w-20 h-20 rounded border border-gray-100" />
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button className="btn-primary w-full text-sm" disabled={working || !destination.trim()} onClick={handleCreateDynamic}>
            {working
              ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              : null}
            {backendDown ? 'Add QR to canvas' : 'Save & add to canvas'}
          </button>
        </div>
      )}

      {/* Style & colour (applies to whichever QR you add) — collapsed by default */}
      <details className="border-t border-gray-100 pt-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-500 select-none">QR style &amp; colour</summary>
        <div className="space-y-2 pt-2">
          <div className="grid grid-cols-4 gap-1">
            {QR_STYLES.map(s => (
              <button key={s.id} onClick={() => setStyleId(s.id)}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${styleId === s.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <ColorSwatch id="qr-fg" label="QR colour" value={fgColor} onChange={setFgColor} />
            <div className={`flex-1 ${transparentBg ? 'opacity-40 pointer-events-none' : ''}`}>
              <ColorSwatch id="qr-bg" label="Background" value={bgColor} onChange={setBgColor} />
            </div>
          </div>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-medium text-gray-700">Transparent background</span>
            <span className="toggle">
              <input type="checkbox" checked={transparentBg} onChange={e => setTransparentBg(e.target.checked)} />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </span>
          </label>
          <div className="flex gap-1">
            {['L','M','Q','H'].map(l => (
              <button key={l} onClick={() => setEcLevel(l)}
                className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors
                  ${ecLevel === l ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </details>
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
