import { useEffect, useRef, useState, useCallback } from 'react'
import { fabric } from 'fabric'
import { DISPLAY_SCALE } from '../lib/products.js'
import { useHistory } from '../hooks/useHistory.js'
import LogoPanel     from './LogoPanel.jsx'
import CanvasToolbar from './CanvasToolbar.jsx'

const MIN_ZOOM = 0.4
const MAX_ZOOM = 4.0
const ZOOM_STEP = 0.25
const GAP_FULL = 120   // gap between side-by-side panels, full-res px

export default function DesignCanvas({ product, initialVariantId, jobName, prefill, onOrderComplete }) {
  const canvasElRef = useRef(null)
  const workspaceRef = useRef(null)
  const fabricRef   = useRef(null)
  const bgRefs      = useRef({})   // { faceId: fabric.Image }
  const spaceRef    = useRef(false)
  const panRef      = useRef(false)
  const lastPan     = useRef(null)
  const prefillDone = useRef(false)
  const fitZoomRef  = useRef(1)    // fabric zoom that fits the artboard = "100%"

  const [variantId,   setVariantId]   = useState(prefill?.savedDesign?.variant_id || initialVariantId || product.defaultVariant)
  const [ready,       setReady]       = useState(false)
  const [selectedObj, setSelectedObj] = useState(null)
  const [logos,       setLogos]       = useState([])
  const [zoom,        setZoom]        = useState(1)
  const [exporting,   setExporting]   = useState(false)
  const [exportMsg,   setExportMsg]   = useState(null)

  const { snapshot, undo, redo, canUndo, canRedo, clear } = useHistory(fabricRef)

  const variant = product.templateVariants.find(v => v.id === variantId) || product.templateVariants[0]
  const faces   = variant.faces

  // Lay faces out left-to-right in full-res coords
  const layout = []
  let cursor = 0
  for (const f of faces) { layout.push({ face: f, x: cursor }); cursor += f.width + GAP_FULL }
  const totalWfull = cursor - GAP_FULL
  const totalHfull = Math.max(...faces.map(f => f.height))
  const W = Math.round(totalWfull * DISPLAY_SCALE)
  const H = Math.round(totalHfull * DISPLAY_SCALE)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ws = workspaceRef.current
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width:  ws ? ws.clientWidth  : W,
      height: ws ? ws.clientHeight : H,
      backgroundColor: '#eef0f3',   // the workspace behind the artboard
      preserveObjectStacking: true, selection: true,
    })
    fabricRef.current = canvas

    // Load every panel background, then guides + ready
    let loaded = 0
    layout.forEach(({ face, x }) => {
      fabric.Image.fromURL(face.template, img => {
        if (img && img.width) {
          img.scaleToWidth(face.width * DISPLAY_SCALE)
          img.set({ left: x * DISPLAY_SCALE, top: 0, selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true, faceId: face.id })
          bgRefs.current[face.id] = img
          canvas.add(img); canvas.sendToBack(img)
        }
        if (++loaded === layout.length) {
          drawGuides(canvas, layout, product.safeMargin)
          finishInit(canvas)
        }
      }, { crossOrigin: 'anonymous' })
    })

    function finishInit(canvas) {
      const saved = prefill?.savedDesign?.design?.canvas
      if (saved) {
        canvas.loadFromJSON(saved, () => {
          rebuildAfterLoad(canvas)
          fitToScreen(); setReady(true); snapshot()
        })
      } else {
        fitToScreen(); setReady(true); snapshot()
        if (prefill?.logoUrl && !prefillDone.current) {
          prefillDone.current = true
          const proxied = `/api/proxy-image?url=${encodeURIComponent(prefill.logoUrl)}`
          const entry = { id: 'prefill_logo', name: `${prefill.companyName || 'Logo'}.png`, originalSrc: proxied, processedSrc: proxied, bgRemoved: false }
          setLogos([entry]); addToCanvas(entry)
        }
      }
    }

    // Re-fit when the workspace resizes
    const ro = new ResizeObserver(() => {
      const el = workspaceRef.current
      if (!el) return
      canvas.setDimensions({ width: el.clientWidth, height: el.clientHeight })
      fitToScreen()
    })
    if (ws) ro.observe(ws)

    function rebuildAfterLoad(canvas) {
      bgRefs.current = {}
      const assets = []
      canvas.getObjects().forEach(o => {
        if (o.isBackground && o.type === 'image') { bgRefs.current[o.faceId] = o }
        else if (!o.isGuide && o.type === 'image') {
          o.on('moving', () => onAssetMove(o))
          const src = o.getSrc ? o.getSrc() : ''
          assets.push({ id: o.id || `a_${assets.length}`, name: o.isQR ? 'QR Code' : 'Logo', originalSrc: src, processedSrc: src, bgRemoved: false, isQR: !!o.isQR })
        }
      })
      setLogos(assets)
    }

    // Selection + history
    canvas.on('selection:created', e => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:updated', e => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:cleared', ()  => setSelectedObj(null))
    const snap = () => snapshot()
    canvas.on('object:modified', snap)
    canvas.on('object:added',    snap)
    canvas.on('object:removed',  snap)

    // Wheel = zoom toward the cursor (no modifier needed; it's a design canvas)
    canvas.on('mouse:wheel', opt => {
      const e = opt.e
      e.preventDefault(); e.stopPropagation()
      const curMult = canvas.getZoom() / fitZoomRef.current
      let nextMult = curMult * (e.deltaY > 0 ? 0.9 : 1.1)
      nextMult = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextMult))
      const p = canvas.getPointer(e, true)
      canvas.zoomToPoint(new fabric.Point(p.x, p.y), fitZoomRef.current * nextMult)
      setZoom(Math.round(nextMult * 100) / 100)
    })
    // Space / middle-mouse pan
    canvas.on('mouse:down', opt => {
      const e = opt.e
      if (spaceRef.current || e.button === 1) { panRef.current = true; lastPan.current = { x: e.clientX, y: e.clientY }; canvas.setCursor('grabbing'); canvas.selection = false; e.preventDefault() }
    })
    canvas.on('mouse:move', opt => {
      if (!panRef.current) return
      const e = opt.e
      canvas.relativePan(new fabric.Point(e.clientX - lastPan.current.x, e.clientY - lastPan.current.y))
      lastPan.current = { x: e.clientX, y: e.clientY }
    })
    canvas.on('mouse:up', () => {
      panRef.current = false; lastPan.current = null
      canvas.setCursor(spaceRef.current ? 'grab' : 'default'); canvas.selection = !spaceRef.current
      hideSmartGuides(canvas); canvas.renderAll()
    })

    function onKeyDown(e) {
      if (e.key === ' ' && !e.target.matches('input,textarea')) {
        e.preventDefault()
        if (!spaceRef.current) { spaceRef.current = true; canvas.defaultCursor = 'grab'; canvas.setCursor('grab'); canvas.selection = false }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target.matches('input,textarea')) return
        const o = canvas.getActiveObject()
        if (o && !o.isBackground) { canvas.remove(o); canvas.discardActiveObject(); canvas.renderAll() }
      }
    }
    function onKeyUp(e) {
      if (e.key === ' ') { spaceRef.current = false; canvas.defaultCursor = 'default'; canvas.setCursor('default'); canvas.selection = true; panRef.current = false }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      ro.disconnect()
      canvas.dispose(); clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap every panel background when the variant changes (keeps assets in place)
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !ready) return
    faces.forEach(f => {
      const bg = bgRefs.current[f.id]
      const x  = layout.find(l => l.face.id === f.id)?.x ?? 0
      if (bg) swapBgElement(bg, f.template, f.width, x).then(() => canvas.renderAll())
    })
  }, [variantId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  function onAssetMove(obj) {
    applySmartGuides(fabricRef.current, obj, layout)
    clampToCanvas(obj, W, H)
  }

  const addToCanvas = useCallback((entry) => {
    const canvas = fabricRef.current
    if (!canvas) return
    const src = entry.processedSrc || entry.originalSrc
    fabric.Image.fromURL(src, img => {
      const f0 = layout[0]
      const maxW = f0.face.width * DISPLAY_SCALE * 0.55
      const maxH = f0.face.height * DISPLAY_SCALE * 0.55
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
      img.set({
        left: (f0.x + f0.face.width / 2) * DISPLAY_SCALE - (img.width * scale) / 2,
        top:  (f0.face.height / 2) * DISPLAY_SCALE - (img.height * scale) / 2,
        scaleX: scale, scaleY: scale, id: entry.id, isQR: !!entry.isQR,
        cornerSize: 10, transparentCorners: false, cornerColor: '#14b893', borderColor: '#14b893', borderScaleFactor: 1.5,
      })
      img.on('moving', () => onAssetMove(img))
      canvas.add(img); canvas.setActiveObject(img); canvas.renderAll()
    }, { crossOrigin: 'anonymous' })
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleLogoReady(entry) {
    const canvas = fabricRef.current
    if (!canvas) return
    const existing = canvas.getObjects().find(o => o.id === entry.id)
    if (existing) {
      fabric.Image.fromURL(entry.processedSrc || entry.originalSrc, img => {
        img.set({ scaleX: existing.scaleX, scaleY: existing.scaleY, left: existing.left, top: existing.top, angle: existing.angle, id: entry.id, isQR: !!entry.isQR, cornerSize: 10, transparentCorners: false, cornerColor: '#14b893', borderColor: '#14b893', borderScaleFactor: 1.5 })
        canvas.remove(existing); img.on('moving', () => onAssetMove(img)); canvas.add(img); canvas.setActiveObject(img); canvas.renderAll()
      }, { crossOrigin: 'anonymous' })
    } else { addToCanvas(entry) }
  }
  function handleLogoRemove(id) {
    const canvas = fabricRef.current; if (!canvas) return
    const o = canvas.getObjects().find(x => x.id === id)
    if (o) { canvas.remove(o); canvas.renderAll() }
  }

  function bringForward() { const o = fabricRef.current?.getActiveObject(); if (o) { fabricRef.current.bringForward(o); fabricRef.current.renderAll(); snapshot() } }
  function sendBackward() { const o = fabricRef.current?.getActiveObject(); if (o && !o.isBackground) { fabricRef.current.sendBackwards(o); fabricRef.current.renderAll(); snapshot() } }
  function deleteSelected() { const o = fabricRef.current?.getActiveObject(); if (o && !o.isBackground) { fabricRef.current.remove(o); fabricRef.current.discardActiveObject(); fabricRef.current.renderAll() } }

  // Fit the artboard inside the workspace and centre it; this is "100%".
  function fitToScreen() {
    const canvas = fabricRef.current; if (!canvas) return
    const vw = canvas.getWidth(), vh = canvas.getHeight()
    const z0 = Math.min(vw / W, vh / H) * 0.88
    fitZoomRef.current = z0
    canvas.setViewportTransform([z0, 0, 0, z0, (vw - W * z0) / 2, (vh - H * z0) / 2])
    setZoom(1)
    spaceRef.current = false; canvas.selection = true; canvas.defaultCursor = 'default'
  }
  // Zoom relative to fit (mult of 1 == fit), toward the workspace centre
  function applyZoom(mult) {
    const canvas = fabricRef.current; if (!canvas) return
    mult = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, mult))
    canvas.zoomToPoint(new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), fitZoomRef.current * mult)
    setZoom(Math.round(mult * 100) / 100)
  }
  const resetZoom = fitToScreen

  // ── Export ──────────────────────────────────────────────────────────────
  // Render one face to a canvas at its exact print size by rendering the whole
  // canvas full-res and cropping that face's panel region.
  async function exactFaceCanvas(entry, templateUrl) {
    const canvas = fabricRef.current
    canvas.discardActiveObject()
    const guides = canvas.getObjects().filter(o => o.isGuide)
    guides.forEach(g => g.set('visible', false))

    // Temporarily shrink the canvas to the artboard size with identity viewport
    // so toCanvasElement renders exactly the content (not the big workspace).
    const savedW = canvas.getWidth(), savedH = canvas.getHeight()
    const vpt = canvas.viewportTransform.slice()
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    canvas.setDimensions({ width: W, height: H })

    const bg = bgRefs.current[entry.face.id]
    const needSwap = bg && templateUrl && templateUrl !== entry.face.template
    if (needSwap) await swapBgElement(bg, templateUrl, entry.face.width, entry.x)

    canvas.renderAll()
    const full = canvas.toCanvasElement(1 / DISPLAY_SCALE)

    if (needSwap) await swapBgElement(bg, entry.face.template, entry.face.width, entry.x)
    canvas.setDimensions({ width: savedW, height: savedH })
    canvas.setViewportTransform(vpt)
    guides.forEach(g => g.set('visible', true))
    canvas.renderAll()

    // Crop this face's region (proportional, handles rounding)
    const out = document.createElement('canvas')
    out.width = entry.face.width; out.height = entry.face.height
    const sx = (entry.x / totalWfull) * full.width
    const sw = (entry.face.width / totalWfull) * full.width
    const sh = (entry.face.height / totalHfull) * full.height
    out.getContext('2d').drawImage(full, sx, 0, sw, sh, 0, 0, entry.face.width, entry.face.height)
    return out
  }

  async function handleDownloadPDF() {
    setExporting(true)
    try {
      const { jsPDF } = await import('jspdf')
      let pdf
      for (let i = 0; i < layout.length; i++) {
        const e = layout[i]
        const cv = await exactFaceCanvas(e, e.face.mockupTemplate || e.face.template)
        const wmm = e.face.width / 11.811, hmm = e.face.height / 11.811
        const orient = wmm > hmm ? 'landscape' : 'portrait'
        if (i === 0) pdf = new jsPDF({ orientation: orient, unit: 'mm', format: [wmm, hmm] })
        else pdf.addPage([wmm, hmm], orient)
        const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
        pdf.addImage(cv.toDataURL('image/png', 1), 'PNG', 0, 0, pw, ph)
      }
      pdf.save(buildFilename(jobName, variant.label, '', 'pdf'))
      showMsg('success', 'Mockup PDF downloaded')
    } catch (err) { console.error(err); showMsg('error', 'PDF export failed') }
    finally { setExporting(false) }
  }

  async function handleDownloadJPEG() {
    setExporting(true)
    try {
      for (const e of layout) {
        const cv = await exactFaceCanvas(e, e.face.mockupTemplate || e.face.template)
        const out = document.createElement('canvas')
        out.width = cv.width; out.height = cv.height
        const ctx = out.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height); ctx.drawImage(cv, 0, 0)
        downloadBlob(dataURLtoBlob(out.toDataURL('image/jpeg', 0.92)), buildFilename(jobName, variant.label, layout.length > 1 ? e.face.label : '', 'jpg'))
      }
      showMsg('success', 'JPEG preview downloaded')
    } catch (err) { console.error(err); showMsg('error', 'JPEG export failed') }
    finally { setExporting(false) }
  }

  async function handleDownloadTIFF() {
    setExporting(true)
    try {
      const UTIF = (await import('utif')).default
      for (const e of layout) {
        const cv = await exactFaceCanvas(e, e.face.template)
        const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
        const buf = UTIF.encodeImage(id.data.buffer, cv.width, cv.height, { t282: [300], t283: [300], t296: [2] })
        downloadBlob(new Blob([buf], { type: 'image/tiff' }), buildFilename(jobName, variant.label, layout.length > 1 ? e.face.label : '', 'tiff'))
      }
      showMsg('success', 'Print TIFF downloaded')
    } catch (err) { console.error(err); showMsg('error', 'TIFF export failed') }
    finally { setExporting(false) }
  }

  async function handleUploadToDrive() {
    setExporting(true)
    try {
      for (const e of layout) {
        const cv = await exactFaceCanvas(e, e.face.template)
        const blob = dataURLtoBlob(cv.toDataURL('image/png', 1))
        const filename = buildFilename(jobName, variant.label, layout.length > 1 ? e.face.label : '', 'tiff')
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

  // ── Save / restore / complete ─────────────────────────────────────────────
  function serializeDesign() {
    const canvas = fabricRef.current
    return { product_id: product.id, variant_id: variantId, canvas: canvas.toJSON(['id', 'isQR', 'isBackground', 'isGuide', 'smartGuide', 'faceId', 'selectable', 'evented', 'hasControls', 'hasBorders']) }
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
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (!res.ok) throw new Error(await res.text())
  }
  async function handleSaveDesign() {
    if (!prefill?.rowSlug) return
    setExporting(true)
    try { await persistDesign(); await setStatus('pending_approval'); showMsg('success', 'Design saved — reopen it anytime') }
    catch (err) { showMsg('error', `Save failed: ${err.message}`) }
    finally { setExporting(false) }
  }
  async function handleMarkComplete() {
    if (!prefill?.rowSlug) return
    setExporting(true)
    try { await persistDesign(); await setStatus('done'); showMsg('success', 'Saved & marked complete'); setTimeout(() => onOrderComplete?.(), 700) }
    catch (err) { showMsg('error', `Could not save: ${err.message}`) }
    finally { setExporting(false) }
  }

  function showMsg(type, text) { setExportMsg({ type, text }); setTimeout(() => setExportMsg(null), 4000) }

  const hasAssets = logos.length > 0

  return (
    <div className="flex h-full min-h-[calc(100vh-56px)]">
      <div className="w-64 shrink-0 border-r border-gray-100 bg-white overflow-y-auto flex flex-col">
        {faces.length > 1 && (
          <p className="px-4 pt-3 -mb-1 text-xs text-gray-400">Drag logos & QR codes freely between {faces.map(f => f.label).join(' & ')}.</p>
        )}
        <LogoPanel
          logos={logos}
          onLogosChange={setLogos}
          onLogoReady={handleLogoReady}
          onLogoRemove={handleLogoRemove}
          variantId={variantId}
          prefillGoogleUrl={prefill?.googleReviewUrl}
          prefillLabel={prefill?.companyName}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
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
            canUndo={canUndo()} canRedo={canRedo()}
            onUndo={undo} onRedo={redo}
            selectedObj={selectedObj}
            onBringForward={bringForward} onSendBackward={sendBackward} onDeleteSelected={deleteSelected}
            zoom={zoom}
            onZoomIn={() => applyZoom(zoom + ZOOM_STEP)} onZoomOut={() => applyZoom(zoom - ZOOM_STEP)}
            onZoomReset={resetZoom} onFitScreen={resetZoom}
          />
        </div>

        <div ref={workspaceRef} className="flex-1 relative bg-gray-100 overflow-hidden">
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <svg className="animate-spin w-8 h-8 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </div>
          )}
          <canvas ref={canvasElRef} />
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-400 bg-white/70 px-2 py-0.5 rounded-full pointer-events-none">
            Scroll to zoom · Space-drag to pan
          </span>
        </div>

        <div className="border-t border-gray-100 bg-white px-5 py-3 flex items-center gap-4">
          <p className="text-sm text-gray-400 shrink-0">
            {!hasAssets ? 'Add a logo or QR code to get started.' : `${logos.length} item${logos.length > 1 ? 's' : ''} placed.`}
          </p>
          {exportMsg && (
            <span className={`text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 ${exportMsg.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>{exportMsg.text}</span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button className="btn-secondary" title="Client approval PDF — white mockup background" disabled={!hasAssets || exporting} onClick={handleDownloadPDF}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Mockup PDF
            </button>
            <button className="btn-secondary" title="Client preview JPEG — flattened on white" disabled={!hasAssets || exporting} onClick={handleDownloadJPEG}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              JPEG
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

function drawGuides(canvas, layout, safeMargin) {
  const multi = layout.length > 1
  layout.forEach(({ face, x }) => {
    const ox = x * DISPLAY_SCALE
    const pw = face.width * DISPLAY_SCALE
    const ph = face.height * DISPLAY_SCALE
    if (multi && face.label) {
      canvas.add(new fabric.Text(face.label, {
        left: ox + pw / 2, top: -30, originX: 'center', originY: 'bottom',
        fontSize: 13, fill: '#9ca3af', fontFamily: 'Inter, sans-serif',
        selectable: false, evented: false, hasControls: false, hasBorders: false,
        isBackground: true, isGuide: true, faceId: face.id,
      }))
    }
    if (safeMargin) {
      const safe = safeMargin * DISPLAY_SCALE
      canvas.add(new fabric.Rect({
        left: ox + safe, top: safe, width: pw - safe * 2, height: ph - safe * 2,
        fill: 'transparent', stroke: 'rgba(20,184,147,0.35)', strokeWidth: 1, strokeDashArray: [5, 4],
        selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true, isGuide: true, faceId: face.id,
      }))
    }
    const g = { stroke: '#ec4899', strokeWidth: 1, selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true, isGuide: true, visible: false }
    canvas.add(new fabric.Line([ox + pw / 2, 0, ox + pw / 2, ph], { ...g, smartGuide: `v_${face.id}` }))
    canvas.add(new fabric.Line([ox, ph / 2, ox + pw, ph / 2], { ...g, smartGuide: `h_${face.id}` }))
  })
}

function applySmartGuides(canvas, obj, layout) {
  const SNAP = 7
  const c = obj.getCenterPoint()
  hideSmartGuides(canvas)
  // Which panel is the object's centre over?
  const entry = layout.find(({ face, x }) => {
    const ox = x * DISPLAY_SCALE, pw = face.width * DISPLAY_SCALE
    return c.x >= ox && c.x <= ox + pw
  })
  if (!entry) return
  const ox = entry.x * DISPLAY_SCALE
  const cx = ox + (entry.face.width * DISPLAY_SCALE) / 2
  const cy = (entry.face.height * DISPLAY_SCALE) / 2
  const v = canvas.getObjects().find(o => o.smartGuide === `v_${entry.face.id}`)
  const h = canvas.getObjects().find(o => o.smartGuide === `h_${entry.face.id}`)
  if (Math.abs(c.x - cx) < SNAP) { obj.set('left', obj.left + (cx - c.x)); v && v.set('visible', true) }
  if (Math.abs(c.y - cy) < SNAP) { obj.set('top',  obj.top  + (cy - c.y)); h && h.set('visible', true) }
}

function hideSmartGuides(canvas) {
  canvas.getObjects().forEach(o => { if (o.smartGuide) o.set('visible', false) })
}

function clampToCanvas(obj, W, H) {
  obj.setCoords()
  // absolute=true → bounding rect in content space, ignoring viewport zoom/pan
  const b = obj.getBoundingRect(true)
  if (b.left < 0)            obj.set('left', obj.left - b.left)
  if (b.top  < 0)            obj.set('top',  obj.top  - b.top)
  if (b.left + b.width  > W) obj.set('left', W - b.width  - (b.left - obj.left))
  if (b.top  + b.height > H) obj.set('top',  H - b.height - (b.top  - obj.top))
}

function swapBgElement(fabricImg, src, faceWidth, xFull) {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => { fabricImg.setElement(el); fabricImg.scaleToWidth(faceWidth * DISPLAY_SCALE); fabricImg.set({ left: xFull * DISPLAY_SCALE, top: 0 }); resolve() }
    el.onerror = reject
    el.src = src
  })
}

function buildFilename(jobName, variantLabel, faceLabel, ext) {
  const base = [jobName, variantLabel, faceLabel].filter(Boolean).join('_') || 'Design'
  return base.replace(/[^a-zA-Z0-9_.\- ]/g, '_').replace(/\s+/g, '_') + '.' + ext
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href)
}

function dataURLtoBlob(dataUrl) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data); const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
