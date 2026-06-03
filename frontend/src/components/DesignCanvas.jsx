import { useEffect, useRef, useState, useCallback } from 'react'
import { fabric } from 'fabric'
import { DISPLAY_SCALE } from '../lib/products.js'
import { useHistory } from '../hooks/useHistory.js'
import LogoPanel    from './LogoPanel.jsx'
import CanvasToolbar from './CanvasToolbar.jsx'

const MIN_ZOOM = 0.4
const MAX_ZOOM = 4.0
const ZOOM_STEP = 0.25

export default function DesignCanvas({ product, initialVariantId, jobName, prefill }) {
  const canvasElRef  = useRef(null)
  const fabricRef    = useRef(null)
  const bgImageRef   = useRef(null)
  const isPanning    = useRef(false)
  const lastPanPoint = useRef(null)
  const spaceRef     = useRef(false)
  const prefillDone  = useRef(false)

  const [variantId,   setVariantId]   = useState(initialVariantId || product.defaultVariant)
  const [ready,       setReady]       = useState(false)
  const [selectedObj, setSelectedObj] = useState(null)
  const [logos,       setLogos]       = useState([])
  const [zoom,        setZoom]        = useState(1.0)
  const [exporting,   setExporting]   = useState(false)
  const [exportMsg,   setExportMsg]   = useState(null)

  const { snapshot, undo, redo, canUndo, canRedo, clear } = useHistory(fabricRef)

  const variant = product.templateVariants.find(v => v.id === variantId) || product.templateVariants[0]
  const W = Math.round(product.canvasWidth  * DISPLAY_SCALE)
  const H = Math.round(product.canvasHeight * DISPLAY_SCALE)

  // ── Init Fabric canvas ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: W, height: H,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
    })
    fabricRef.current = canvas

    loadBackground(canvas, variant.template, W, H, bgImageRef, () => {
      drawGuides(canvas, product, W, H)
      canvas.renderAll()
      setReady(true)
      snapshot()
    })

    // Selection
    canvas.on('selection:created', e => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:updated', e => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:cleared', ()  => setSelectedObj(null))

    // History
    const snap = () => snapshot()
    canvas.on('object:modified', snap)
    canvas.on('object:added',    snap)
    canvas.on('object:removed',  snap)

    // ── Zoom: Ctrl/Cmd + scroll only (plain scroll scrolls the workspace) ──
    canvas.on('mouse:wheel', opt => {
      const e = opt.e
      if (!e.ctrlKey && !e.metaKey) return  // let plain scroll pass through
      e.preventDefault()
      e.stopPropagation()
      const current = canvas.getZoom()
      let next = current * (e.deltaY > 0 ? 0.92 : 1.08)
      next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      const pointer = canvas.getPointer(e, true)
      canvas.zoomToPoint(new fabric.Point(pointer.x, pointer.y), next)
      setZoom(Math.round(next * 100) / 100)
    })

    // ── Pan: Space+drag (Canva style) or middle-mouse drag ────────────────
    canvas.on('mouse:down', opt => {
      const e = opt.e
      if (spaceRef.current || e.button === 1) {
        isPanning.current    = true
        lastPanPoint.current = { x: e.clientX, y: e.clientY }
        canvas.setCursor('grabbing')
        canvas.selection = false
        opt.e.preventDefault()
      }
    })
    canvas.on('mouse:move', opt => {
      if (spaceRef.current && !isPanning.current) {
        canvas.setCursor('grab')
      }
      if (!isPanning.current) return
      const e     = opt.e
      const delta = new fabric.Point(e.clientX - lastPanPoint.current.x, e.clientY - lastPanPoint.current.y)
      canvas.relativePan(delta)
      lastPanPoint.current = { x: e.clientX, y: e.clientY }
    })
    canvas.on('mouse:up', () => {
      isPanning.current    = false
      lastPanPoint.current = null
      canvas.setCursor(spaceRef.current ? 'grab' : 'default')
      canvas.selection = !spaceRef.current
    })

    // ── Keyboard shortcuts + Space pan mode ──────────────────────────────
    function onKeyDown(e) {
      if (e.key === ' ' && !e.target.matches('input,textarea')) {
        e.preventDefault()
        if (!spaceRef.current) {
          spaceRef.current = true
          canvas.defaultCursor = 'grab'
          canvas.setCursor('grab')
          canvas.selection = false
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target.matches('input,textarea')) return
        const obj = canvas.getActiveObject()
        if (obj && !obj.isBackground) {
          canvas.remove(obj); canvas.discardActiveObject(); canvas.renderAll()
        }
      }
    }
    function onKeyUp(e) {
      if (e.key === ' ') {
        spaceRef.current = false
        canvas.defaultCursor = 'default'
        canvas.setCursor('default')
        canvas.selection = true
        isPanning.current = false
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      canvas.dispose()
      clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-load logo + QR from Formaloo prefill ────────────────────────────
  useEffect(() => {
    if (!ready || !prefill || prefillDone.current) return
    prefillDone.current = true

    // Load logo from Formaloo S3 URL
    if (prefill.logoUrl) {
      const id  = 'prefill_logo'
      const entry = {
        id,
        name:         `${prefill.companyName || 'Logo'}.png`,
        originalSrc:  prefill.logoUrl,
        processedSrc: prefill.logoUrl,
        bgRemoved:    false,
      }
      setLogos([entry])
      addToCanvas(entry)
    }
  }, [ready, prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap template when variant changes ────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !ready) return
    const newVariant = product.templateVariants.find(v => v.id === variantId)
    if (!newVariant) return

    if (bgImageRef.current) {
      canvas.remove(bgImageRef.current)
      bgImageRef.current = null
    }
    fabric.Image.fromURL(newVariant.template, img => {
      if (!img || img.width === 0) return
      img.scaleToWidth(W)
      img.scaleToHeight(H)
      img.set({ left: 0, top: 0, selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true })
      bgImageRef.current = img
      canvas.add(img)
      canvas.sendToBack(img)
      canvas.renderAll()
    }, { crossOrigin: 'anonymous' })
  }, [variantId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom controls ─────────────────────────────────────────────────────────
  function applyZoom(newZoom) {
    const canvas = fabricRef.current
    if (!canvas) return
    newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom))
    canvas.zoomToPoint(new fabric.Point(W / 2, H / 2), newZoom)
    setZoom(Math.round(newZoom * 100) / 100)
  }

  function resetZoom() {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.setZoom(1)
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    setZoom(1.0)
    spaceRef.current = false
    canvas.defaultCursor = 'default'
    canvas.selection = true
  }

  // ── Add logo/QR to canvas ─────────────────────────────────────────────────
  const addToCanvas = useCallback((entry) => {
    const canvas = fabricRef.current
    if (!canvas) return
    const src = entry.processedSrc || entry.originalSrc

    fabric.Image.fromURL(src, img => {
      const maxW = W * 0.55
      const maxH = H * 0.55
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)

      img.set({
        left: (W - img.width  * scale) / 2,
        top:  (H - img.height * scale) / 2,
        scaleX: scale, scaleY: scale,
        id: entry.id,
        cornerSize: 10,
        transparentCorners: false,
        cornerColor: '#14b893',
        borderColor: '#14b893',
        borderScaleFactor: 1.5,
      })
      img.on('moving', () => clampToCanvas(img, W, H))
      canvas.add(img)
      canvas.setActiveObject(img)
      canvas.renderAll()
    }, { crossOrigin: 'anonymous' })
  }, [W, H])

  function handleLogoReady(entry) {
    const canvas = fabricRef.current
    if (!canvas) return
    const existing = canvas.getObjects().find(o => o.id === entry.id)
    if (existing) {
      fabric.Image.fromURL(entry.processedSrc || entry.originalSrc, img => {
        const props = { scaleX: existing.scaleX, scaleY: existing.scaleY, left: existing.left, top: existing.top, angle: existing.angle, id: entry.id }
        canvas.remove(existing)
        img.set({ ...props, cornerSize: 10, transparentCorners: false, cornerColor: '#14b893', borderColor: '#14b893', borderScaleFactor: 1.5 })
        img.on('moving', () => clampToCanvas(img, W, H))
        canvas.add(img)
        canvas.setActiveObject(img)
        canvas.renderAll()
      }, { crossOrigin: 'anonymous' })
    } else {
      addToCanvas(entry)
    }
  }

  function handleLogoRemove(id) {
    const canvas = fabricRef.current
    if (!canvas) return
    const obj = canvas.getObjects().find(o => o.id === id)
    if (obj) { canvas.remove(obj); canvas.renderAll() }
  }

  function bringForward() {
    const obj = fabricRef.current?.getActiveObject()
    if (obj) { fabricRef.current.bringForward(obj); fabricRef.current.renderAll(); snapshot() }
  }
  function sendBackward() {
    const obj = fabricRef.current?.getActiveObject()
    if (obj && !obj.isBackground) { fabricRef.current.sendBackwards(obj); fabricRef.current.renderAll(); snapshot() }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function getExportDataUrl() {
    const canvas = fabricRef.current
    canvas.discardActiveObject()
    // Temporarily reset viewport for clean export, then restore
    const vpt = canvas.viewportTransform.slice()
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    canvas.renderAll()
    const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 / DISPLAY_SCALE, quality: 1 })
    canvas.setViewportTransform(vpt)
    canvas.renderAll()
    return dataUrl
  }

  async function handleDownloadPDF() {
    setExporting(true)
    try {
      const dataUrl  = getExportDataUrl()
      const widthMm  = product.printWidth  / 11.811
      const heightMm = product.printHeight / 11.811
      const { jsPDF } = await import('jspdf')
      const orient = widthMm > heightMm ? 'landscape' : 'portrait'
      const pdf = new jsPDF({ orientation: orient, unit: 'mm', format: [widthMm, heightMm] })
      pdf.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST')
      pdf.save(buildFilename(jobName, variant.label, 'pdf'))
      showMsg('success', 'PDF downloaded')
    } catch (err) {
      console.error('PDF export failed:', err)
      showMsg('error', 'PDF export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleUploadToDrive() {
    setExporting(true)
    try {
      const blob     = dataURLtoBlob(getExportDataUrl())
      const filename = buildFilename(jobName, variant.label, 'tiff')
      const form = new FormData()
      form.append('file', blob, filename)
      form.append('businessName', jobName || 'ReviewTap')
      form.append('orderNumber',  '')
      form.append('productId',    product.id)
      form.append('filename',     filename)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      showMsg('success', 'Uploaded to Drive')
    } catch (err) {
      showMsg('error', `Drive upload failed: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  function showMsg(type, text) {
    setExportMsg({ type, text })
    setTimeout(() => setExportMsg(null), 4000)
  }

  const hasAssets = logos.length > 0

  return (
    <div className="flex h-full min-h-[calc(100vh-56px)]">
      {/* Left panel */}
      <div className="w-64 shrink-0 border-r border-gray-100 bg-white overflow-y-auto flex flex-col">
        <LogoPanel
          logos={logos}
          onLogosChange={setLogos}
          onLogoReady={handleLogoReady}
          onLogoRemove={handleLogoRemove}
          variantId={variantId}
          prefillGoogleUrl={prefill?.googleReviewUrl}
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
            canUndo={canUndo()} canRedo={canRedo()}
            onUndo={undo} onRedo={redo}
            selectedObj={selectedObj}
            onBringForward={bringForward}
            onSendBackward={sendBackward}
            onDeleteSelected={() => {
              const obj = fabricRef.current?.getActiveObject()
              if (obj && !obj.isBackground) {
                fabricRef.current.remove(obj)
                fabricRef.current.discardActiveObject()
                fabricRef.current.renderAll()
              }
            }}
            zoom={zoom}
            onZoomIn={()      => applyZoom(zoom + ZOOM_STEP)}
            onZoomOut={()     => applyZoom(zoom - ZOOM_STEP)}
            onZoomReset={resetZoom}
            onFitScreen={resetZoom}
          />
        </div>

        {/* Canvas viewport */}
        <div className="flex-1 flex items-center justify-center p-8 bg-gray-100 overflow-auto">
          <div className="relative shadow-2xl" style={{ width: W, height: H }}>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                <svg className="animate-spin w-8 h-8 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              </div>
            )}
            <canvas ref={canvasElRef} />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 bg-white px-5 py-3 flex items-center gap-4">
          <p className="text-sm text-gray-400 shrink-0">
            {!hasAssets ? 'Upload a logo or add a QR code to get started.' : `${logos.length} item${logos.length > 1 ? 's' : ''} on canvas.`}
          </p>
          {exportMsg && (
            <span className={`text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 ${exportMsg.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
              {exportMsg.text}
            </span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button className="btn-secondary" disabled={!hasAssets || exporting} onClick={handleDownloadPDF}>
              {exporting
                ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              }
              Download PDF
            </button>
            <button className="btn-primary" disabled={!hasAssets || exporting} onClick={handleUploadToDrive}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              Send to Drive
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadBackground(canvas, templateUrl, W, H, bgImageRef, onDone) {
  fabric.Image.fromURL(templateUrl, img => {
    if (!img || img.width === 0) {
      drawFallbackBackground(canvas, W, H)
      onDone()
      return
    }
    img.scaleToWidth(W)
    img.scaleToHeight(H)
    img.set({ left: 0, top: 0, selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true })
    bgImageRef.current = img
    canvas.add(img)
    canvas.sendToBack(img)
    onDone()
  }, { crossOrigin: 'anonymous' })
}

function drawGuides(canvas, product, W, H) {
  if (!product.safeMargin) return
  const safe = product.safeMargin * DISPLAY_SCALE
  canvas.add(new fabric.Rect({
    left: safe, top: safe,
    width: W - safe * 2, height: H - safe * 2,
    fill: 'transparent',
    stroke: 'rgba(20,184,147,0.35)', strokeWidth: 1, strokeDashArray: [5, 4],
    selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true,
  }))
}

function clampToCanvas(obj, W, H) {
  obj.setCoords()
  const b = obj.getBoundingRect()
  if (b.left < 0)              obj.set('left', obj.left - b.left)
  if (b.top  < 0)              obj.set('top',  obj.top  - b.top)
  if (b.left + b.width  > W)   obj.set('left', W - b.width  - (b.left - obj.left))
  if (b.top  + b.height > H)   obj.set('top',  H - b.height - (b.top  - obj.top))
}

function drawFallbackBackground(canvas, W, H) {
  canvas.add(new fabric.Rect({
    left: 0, top: 0, width: W, height: H, fill: '#f0f0f0',
    selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true,
  }))
}

function buildFilename(jobName, variantLabel, ext) {
  const base = [jobName, variantLabel].filter(Boolean).join('_') || 'Design'
  return base.replace(/[^a-zA-Z0-9_.\- ]/g, '_').replace(/\s+/g, '_') + '.' + ext
}

function dataURLtoBlob(dataUrl) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
