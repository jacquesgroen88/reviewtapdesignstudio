import { useState, useRef, useEffect } from 'react'
import LogoPanel     from './LogoPanel.jsx'
import CanvasToolbar from './CanvasToolbar.jsx'
import FaceCanvas    from './FaceCanvas.jsx'

const ZOOM_STEP = 0.25

export default function DesignCanvas({ product, initialVariantId, jobName, prefill, onOrderComplete }) {
  const [variantId, setVariantId] = useState(prefill?.savedDesign?.variant_id || initialVariantId || product.defaultVariant)
  const variant = product.templateVariants.find(v => v.id === variantId) || product.templateVariants[0]
  const faces   = variant.faces

  const [activeFaceId, setActiveFaceId] = useState(faces[0].id)
  const [logosByFace,  setLogosByFace]  = useState({})   // { faceId: [entries] }
  const [histByFace,   setHistByFace]   = useState({})   // { faceId: {canUndo,canRedo} }
  const [selByFace,    setSelByFace]    = useState({})   // { faceId: bool }
  const [zoom,         setZoom]         = useState(1)
  const [exporting,    setExporting]    = useState(false)
  const [exportMsg,    setExportMsg]    = useState(null)

  const apisRef      = useRef({})   // { faceId: api }
  const prefillDone  = useRef(false)

  // Keep activeFaceId valid if the variant's faces change
  useEffect(() => {
    if (!faces.find(f => f.id === activeFaceId)) setActiveFaceId(faces[0].id)
  }, [variantId]) // eslint-disable-line react-hooks/exhaustive-deps

  function registerApi(faceId, api) {
    if (api) {
      apisRef.current[faceId] = api
      const saved = prefill?.savedDesign
      if (saved?.design?.faces?.[faceId]) {
        // Restore the previously-saved canvas for this face
        api.importState(saved.design.faces[faceId]).then(assets => {
          setLogosByFace(prev => ({ ...prev, [faceId]: assets }))
        })
      } else if (faceId === faces[0].id && prefill?.logoUrl && !prefillDone.current) {
        // Fresh design — prefill the logo onto the first face
        prefillDone.current = true
        const proxied = `/api/proxy-image?url=${encodeURIComponent(prefill.logoUrl)}`
        const entry = { id: 'prefill_logo', name: `${prefill.companyName || 'Logo'}.png`, originalSrc: proxied, processedSrc: proxied, bgRemoved: false }
        setLogosByFace(prev => ({ ...prev, [faceId]: [entry] }))
        api.addOrReplace(entry)
      }
    } else {
      delete apisRef.current[faceId]
    }
  }

  const activeApi   = apisRef.current[activeFaceId]
  const activeLogos = logosByFace[activeFaceId] || []

  // Asset panel operates on the active face
  const setActiveLogos = (updater) => setLogosByFace(prev => {
    const cur = prev[activeFaceId] || []
    const next = typeof updater === 'function' ? updater(cur) : updater
    return { ...prev, [activeFaceId]: next }
  })
  function handleLogoReady(entry) { apisRef.current[activeFaceId]?.addOrReplace(entry) }
  function handleLogoRemove(id)   { apisRef.current[activeFaceId]?.removeAsset(id) }

  function activateFace(id) {
    setActiveFaceId(id)
    const api = apisRef.current[id]
    if (api) setZoom(Math.round(api.getZoom() * 100) / 100)
  }

  // Zoom routes to the active face
  function applyZoom(z) { const a = apisRef.current[activeFaceId]; if (a) setZoom(a.setZoom(z)) }
  function resetZoom()  { const a = apisRef.current[activeFaceId]; if (a) { a.resetZoom(); setZoom(1) } }

  // ── Export ──────────────────────────────────────────────────────────────
  // Render a face to a canvas at EXACTLY its print dimensions, so the PDF page
  // aspect ratio matches perfectly (no stretch/shift) and the TIFF is exact size.
  async function exactCanvas(api, templateUrl, w, h) {
    const cv = await api.buildExportCanvas(templateUrl)
    if (cv.width === w && cv.height === h) return cv
    const out = document.createElement('canvas')
    out.width = w; out.height = h
    out.getContext('2d').drawImage(cv, 0, 0, w, h)
    return out
  }

  async function handleDownloadPDF() {
    setExporting(true)
    try {
      const { jsPDF } = await import('jspdf')
      let pdf
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i]
        const api = apisRef.current[f.id]
        const cv = await exactCanvas(api, f.mockupTemplate || f.template, f.width, f.height)
        const wmm = f.width / 11.811, hmm = f.height / 11.811
        const orient = wmm > hmm ? 'landscape' : 'portrait'
        if (i === 0) pdf = new jsPDF({ orientation: orient, unit: 'mm', format: [wmm, hmm] })
        else pdf.addPage([wmm, hmm], orient)
        pdf.addImage(cv.toDataURL('image/png', 1), 'PNG', 0, 0, wmm, hmm)
      }
      pdf.save(buildFilename(jobName, variant.label, '', 'pdf'))
      showMsg('success', 'Mockup PDF downloaded')
    } catch (err) { console.error(err); showMsg('error', 'PDF export failed') }
    finally { setExporting(false) }
  }

  async function handleDownloadTIFF() {
    setExporting(true)
    try {
      const UTIF = (await import('utif')).default
      for (const f of faces) {
        const api = apisRef.current[f.id]
        const cv = await exactCanvas(api, f.template, f.width, f.height)
        const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
        const buf = UTIF.encodeImage(id.data.buffer, cv.width, cv.height, { t282: [300], t283: [300], t296: [2] })
        downloadBlob(new Blob([buf], { type: 'image/tiff' }), buildFilename(jobName, variant.label, faces.length > 1 ? f.label : '', 'tiff'))
      }
      showMsg('success', 'Print TIFF downloaded')
    } catch (err) { console.error(err); showMsg('error', 'TIFF export failed') }
    finally { setExporting(false) }
  }

  async function handleUploadToDrive() {
    setExporting(true)
    try {
      for (const f of faces) {
        const api = apisRef.current[f.id]
        const cv = await exactCanvas(api, f.template, f.width, f.height)
        const blob = dataURLtoBlob(cv.toDataURL('image/png', 1))
        const filename = buildFilename(jobName, variant.label, faces.length > 1 ? f.label : '', 'tiff')
        const form = new FormData()
        form.append('file', blob, filename)
        form.append('businessName', jobName || 'ReviewTap')
        form.append('orderNumber', prefill?.orderNumber || '')
        form.append('productId', product.id)
        form.append('filename', filename)
        const res = await fetch('/api/upload', { method: 'POST', body: form })
        if (!res.ok) throw new Error(await res.text())
      }
      showMsg('success', 'Sent to Drive')
    } catch (err) { showMsg('error', `Drive upload failed: ${err.message}`) }
    finally { setExporting(false) }
  }

  function serializeDesign() {
    const facesJson = {}
    for (const f of faces) { const api = apisRef.current[f.id]; if (api) facesJson[f.id] = api.exportState() }
    return { product_id: product.id, variant_id: variantId, faces: facesJson }
  }
  async function persistDesign() {
    const res = await fetch(`/api/orders/${prefill.rowSlug}/design`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId, design: serializeDesign() }),
    })
    if (!res.ok) throw new Error(await res.text())
  }
  async function setStatus(status) {
    const res = await fetch(`/api/orders/${prefill.rowSlug}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) throw new Error(await res.text())
  }

  async function handleSaveDesign() {
    if (!prefill?.rowSlug) return
    setExporting(true)
    try {
      await persistDesign()
      await setStatus('in_progress')
      showMsg('success', 'Design saved — you can reopen it anytime')
    } catch (err) { showMsg('error', `Save failed: ${err.message}`) }
    finally { setExporting(false) }
  }

  async function handleMarkComplete() {
    if (!prefill?.rowSlug) return
    setExporting(true)
    try {
      await persistDesign()
      await setStatus('done')
      showMsg('success', 'Saved & marked complete')
      setTimeout(() => onOrderComplete?.(), 700)
    } catch (err) { showMsg('error', `Could not save: ${err.message}`) }
    finally { setExporting(false) }
  }

  function showMsg(type, text) { setExportMsg({ type, text }); setTimeout(() => setExportMsg(null), 4000) }

  const hasAssets = Object.values(logosByFace).some(a => a && a.length)
  const hist = histByFace[activeFaceId] || {}

  return (
    <div className="flex h-full min-h-[calc(100vh-56px)]">
      {/* Left panel */}
      <div className="w-64 shrink-0 border-r border-gray-100 bg-white overflow-y-auto flex flex-col">
        {faces.length > 1 && (
          <div className="px-4 pt-3 -mb-1 flex items-center gap-1.5 text-xs text-gray-400">
            Editing:
            <span className="font-semibold text-brand-600">{faces.find(f => f.id === activeFaceId)?.label}</span>
            <span className="text-gray-300">· click a card to switch</span>
          </div>
        )}
        <LogoPanel
          logos={activeLogos}
          onLogosChange={setActiveLogos}
          onLogoReady={handleLogoReady}
          onLogoRemove={handleLogoRemove}
          variantId={variantId}
          prefillGoogleUrl={prefill?.googleReviewUrl}
          prefillLabel={prefill?.companyName}
        />
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="border-b border-gray-100 bg-white flex items-center">
          {product.templateVariants.length > 1 && (
            <div className="flex items-center border-r border-gray-100 px-3 py-2 gap-1.5 shrink-0">
              {product.templateVariants.map(v => (
                <button key={v.id} onClick={() => setVariantId(v.id)} title={v.label}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                    ${variantId === v.id ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
                  <span className={`w-3 h-3 rounded-full border ${v.id === 'white' ? 'bg-white border-gray-400' : 'bg-gray-900 border-gray-600'}`} />
                  {v.label}
                </button>
              ))}
            </div>
          )}
          <CanvasToolbar
            canUndo={!!hist.canUndo} canRedo={!!hist.canRedo}
            onUndo={() => activeApi?.undo()} onRedo={() => activeApi?.redo()}
            selectedObj={selByFace[activeFaceId] ? {} : null}
            onBringForward={() => activeApi?.bringForward()}
            onSendBackward={() => activeApi?.sendBackward()}
            onDeleteSelected={() => activeApi?.deleteSelected()}
            zoom={zoom}
            onZoomIn={() => applyZoom(zoom + ZOOM_STEP)}
            onZoomOut={() => applyZoom(zoom - ZOOM_STEP)}
            onZoomReset={resetZoom}
            onFitScreen={resetZoom}
          />
        </div>

        {/* Faces */}
        <div className="flex-1 flex items-center justify-center gap-8 p-8 bg-gray-100 overflow-auto">
          {faces.map(face => (
            <FaceCanvas
              key={face.id}
              face={face}
              safeMargin={product.safeMargin}
              active={activeFaceId === face.id}
              onActivate={activateFace}
              onSelectionChange={(fid, sel) => setSelByFace(p => ({ ...p, [fid]: sel }))}
              onHistoryChange={(fid, u, r) => setHistByFace(p => ({ ...p, [fid]: { canUndo: u, canRedo: r } }))}
              registerApi={registerApi}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 bg-white px-5 py-3 flex items-center gap-4">
          <p className="text-sm text-gray-400 shrink-0">
            {!hasAssets ? 'Add a logo or QR code to get started.' : `${faces.length > 1 ? 'Front & back' : 'Design'} ready.`}
          </p>
          {exportMsg && (
            <span className={`text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 ${exportMsg.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
              {exportMsg.text}
            </span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button className="btn-secondary" title="Client approval — white mockup background" disabled={!hasAssets || exporting} onClick={handleDownloadPDF}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Mockup PDF
            </button>
            <button className="btn-secondary" title="Printer file(s) — cream/print background" disabled={!hasAssets || exporting} onClick={handleDownloadTIFF}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Print TIFF
            </button>
            <button className="btn-secondary" title="Send print file(s) to Google Drive" disabled={!hasAssets || exporting} onClick={handleUploadToDrive}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
              Drive
            </button>
            {prefill?.rowSlug && (
              <>
                <button className="btn-secondary" title="Save the design so you can reopen it later" disabled={exporting} onClick={handleSaveDesign}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save
                </button>
                <button className="btn-primary" title="Save and mark the order complete" disabled={exporting} onClick={handleMarkComplete}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildFilename(jobName, variantLabel, faceLabel, ext) {
  const base = [jobName, variantLabel, faceLabel].filter(Boolean).join('_') || 'Design'
  return base.replace(/[^a-zA-Z0-9_.\- ]/g, '_').replace(/\s+/g, '_') + '.' + ext
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(a.href)
}

function dataURLtoBlob(dataUrl) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
