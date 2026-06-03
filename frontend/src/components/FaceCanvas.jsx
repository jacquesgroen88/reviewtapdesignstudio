import { useEffect, useRef } from 'react'
import { fabric } from 'fabric'
import { DISPLAY_SCALE } from '../lib/products.js'
import { useHistory } from '../hooks/useHistory.js'

const MIN_ZOOM = 0.4
const MAX_ZOOM = 4.0

// One editable product face (a stand, or a card front/back). Owns its own
// Fabric canvas, background, history, zoom/pan and export. Exposes an
// imperative API to the parent via registerApi(faceId, api).
export default function FaceCanvas({
  face, safeMargin, active, onActivate, onSelectionChange, onHistoryChange,
  registerApi,
}) {
  const elRef     = useRef(null)
  const fcRef     = useRef(null)
  const bgRef     = useRef(null)
  const spaceRef  = useRef(false)
  const panRef    = useRef(false)
  const lastPan   = useRef(null)
  const activeRef = useRef(active)

  const { snapshot, undo, redo, canUndo, canRedo, clear } = useHistory(fcRef)

  const W = Math.round(face.width  * DISPLAY_SCALE)
  const H = Math.round(face.height * DISPLAY_SCALE)

  useEffect(() => { activeRef.current = active }, [active])

  // Swap the background when the variant changes (white↔black) without
  // remounting — keeps placed logos/QR in position.
  useEffect(() => {
    const canvas = fcRef.current
    if (!canvas || !bgRef.current) return
    swapBgElement(bgRef.current, face.template, W, H).then(() => canvas.renderAll()).catch(() => {})
  }, [face.template]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = new fabric.Canvas(elRef.current, {
      width: W, height: H, backgroundColor: '#ffffff',
      preserveObjectStacking: true, selection: true,
    })
    fcRef.current = canvas

    loadBackground(canvas, face.template, W, H, bgRef, () => {
      drawGuides(canvas, safeMargin, W, H)
      canvas.renderAll()
      snapshot()
    })

    const notifySel = () => onSelectionChange?.(face.id, !!canvas.getActiveObject() && !canvas.getActiveObject().isBackground)
    canvas.on('selection:created', notifySel)
    canvas.on('selection:updated', notifySel)
    canvas.on('selection:cleared', () => onSelectionChange?.(face.id, false))

    const onChange = () => { snapshot(); onHistoryChange?.(face.id, canUndo(), canRedo()) }
    canvas.on('object:modified', onChange)
    canvas.on('object:added',    onChange)
    canvas.on('object:removed',  onChange)

    // Ctrl/Cmd + wheel zoom
    canvas.on('mouse:wheel', opt => {
      const e = opt.e
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault(); e.stopPropagation()
      let next = canvas.getZoom() * (e.deltaY > 0 ? 0.92 : 1.08)
      next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      canvas.zoomToPoint(new fabric.Point(opt.pointer?.x ?? W / 2, opt.pointer?.y ?? H / 2), next)
    })

    // Space / middle-mouse pan
    canvas.on('mouse:down', opt => {
      onActivate?.(face.id)
      const e = opt.e
      if (spaceRef.current || e.button === 1) {
        panRef.current = true; lastPan.current = { x: e.clientX, y: e.clientY }
        canvas.setCursor('grabbing'); canvas.selection = false; e.preventDefault()
      }
    })
    canvas.on('mouse:move', opt => {
      if (!panRef.current) return
      const e = opt.e
      canvas.relativePan(new fabric.Point(e.clientX - lastPan.current.x, e.clientY - lastPan.current.y))
      lastPan.current = { x: e.clientX, y: e.clientY }
    })
    canvas.on('mouse:up', () => {
      panRef.current = false; lastPan.current = null
      canvas.setCursor(spaceRef.current ? 'grab' : 'default')
      canvas.selection = !spaceRef.current
      hideSmartGuides(canvas); canvas.renderAll()
    })

    function onKeyDown(e) {
      if (!activeRef.current) return
      if (e.key === ' ' && !e.target.matches('input,textarea')) {
        e.preventDefault()
        if (!spaceRef.current) { spaceRef.current = true; canvas.defaultCursor = 'grab'; canvas.setCursor('grab'); canvas.selection = false }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); doRedo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target.matches('input,textarea')) return
        deleteSelected()
      }
    }
    function onKeyUp(e) {
      if (e.key === ' ') {
        spaceRef.current = false; canvas.defaultCursor = 'default'; canvas.setCursor('default'); canvas.selection = true; panRef.current = false
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)

    // ── Imperative API for the parent ───────────────────────────────────────
    function addOrReplace(entry) {
      const existing = canvas.getObjects().find(o => o.id === entry.id)
      const src = entry.processedSrc || entry.originalSrc
      fabric.Image.fromURL(src, img => {
        if (existing) {
          img.set({ scaleX: existing.scaleX, scaleY: existing.scaleY, left: existing.left, top: existing.top, angle: existing.angle })
          canvas.remove(existing)
        } else {
          const scale = Math.min(W * 0.55 / img.width, H * 0.55 / img.height, 1)
          img.set({ left: (W - img.width * scale) / 2, top: (H - img.height * scale) / 2, scaleX: scale, scaleY: scale })
        }
        img.set({ id: entry.id, cornerSize: 10, transparentCorners: false, cornerColor: '#14b893', borderColor: '#14b893', borderScaleFactor: 1.5 })
        img.on('moving', () => { applySmartGuides(canvas, img, W, H); clampToCanvas(img, W, H) })
        canvas.add(img); canvas.setActiveObject(img); canvas.renderAll()
      }, { crossOrigin: 'anonymous' })
    }
    function removeAsset(id) {
      const o = canvas.getObjects().find(x => x.id === id)
      if (o) { canvas.remove(o); canvas.renderAll() }
    }
    function deleteSelected() {
      const o = canvas.getActiveObject()
      if (o && !o.isBackground) { canvas.remove(o); canvas.discardActiveObject(); canvas.renderAll() }
    }
    function bringForward() { const o = canvas.getActiveObject(); if (o) { canvas.bringForward(o); canvas.renderAll() } }
    function sendBackward() { const o = canvas.getActiveObject(); if (o && !o.isBackground) { canvas.sendBackwards(o); canvas.renderAll() } }
    function doUndo() { undo(); onHistoryChange?.(face.id, canUndo(), canRedo()) }
    function doRedo() { redo(); onHistoryChange?.(face.id, canUndo(), canRedo()) }
    function setZoom(z) {
      z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
      canvas.zoomToPoint(new fabric.Point(W / 2, H / 2), z)
      return Math.round(z * 100) / 100
    }
    function getZoom() { return canvas.getZoom() }
    function resetZoom() { canvas.setZoom(1); canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); canvas.renderAll() }

    async function buildExportCanvas(templateUrl) {
      canvas.discardActiveObject()
      const guides = canvas.getObjects().filter(o => o.isGuide)
      guides.forEach(g => g.set('visible', false))
      const vpt = canvas.viewportTransform.slice()
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      const needSwap = bgRef.current && templateUrl
      if (needSwap) await swapBgElement(bgRef.current, templateUrl, W, H)
      canvas.renderAll()
      const out = canvas.toCanvasElement(1 / DISPLAY_SCALE)
      if (needSwap) await swapBgElement(bgRef.current, face.template, W, H)
      canvas.setViewportTransform(vpt)
      guides.forEach(g => g.set('visible', true))
      canvas.renderAll()
      return out
    }

    registerApi?.(face.id, {
      addOrReplace, removeAsset, deleteSelected, bringForward, sendBackward,
      undo: doUndo, redo: doRedo, canUndo, canRedo,
      setZoom, getZoom, resetZoom, buildExportCanvas,
      face,
    })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      registerApi?.(face.id, null)
      canvas.dispose()
      clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col items-center gap-1.5">
      {face.label && <span className="text-xs font-medium text-gray-400">{face.label}</span>}
      <div
        onMouseDown={() => onActivate?.(face.id)}
        className={`relative shadow-xl rounded-sm transition-all duration-150 ${active ? 'ring-2 ring-brand-400 ring-offset-2' : 'ring-1 ring-gray-200'}`}
        style={{ width: W, height: H }}
      >
        <canvas ref={elRef} />
      </div>
    </div>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function loadBackground(canvas, templateUrl, W, H, bgRef, onDone) {
  fabric.Image.fromURL(templateUrl, img => {
    if (!img || img.width === 0) {
      canvas.add(new fabric.Rect({ left: 0, top: 0, width: W, height: H, fill: '#f0f0f0',
        selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true }))
      onDone(); return
    }
    img.scaleToWidth(W); img.scaleToHeight(H)
    img.set({ left: 0, top: 0, selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true })
    bgRef.current = img
    canvas.add(img); canvas.sendToBack(img)
    onDone()
  }, { crossOrigin: 'anonymous' })
}

function drawGuides(canvas, safeMargin, W, H) {
  if (safeMargin) {
    const safe = safeMargin * DISPLAY_SCALE
    canvas.add(new fabric.Rect({
      left: safe, top: safe, width: W - safe * 2, height: H - safe * 2,
      fill: 'transparent', stroke: 'rgba(20,184,147,0.35)', strokeWidth: 1, strokeDashArray: [5, 4],
      selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true, isGuide: true,
    }))
  }
  const g = { stroke: '#ec4899', strokeWidth: 1, selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true, isGuide: true, visible: false }
  canvas.add(new fabric.Line([W / 2, 0, W / 2, H], { ...g, smartGuide: 'v' }))
  canvas.add(new fabric.Line([0, H / 2, W, H / 2], { ...g, smartGuide: 'h' }))
}

function clampToCanvas(obj, W, H) {
  obj.setCoords()
  const b = obj.getBoundingRect()
  if (b.left < 0)            obj.set('left', obj.left - b.left)
  if (b.top  < 0)            obj.set('top',  obj.top  - b.top)
  if (b.left + b.width  > W) obj.set('left', W - b.width  - (b.left - obj.left))
  if (b.top  + b.height > H) obj.set('top',  H - b.height - (b.top  - obj.top))
}

function applySmartGuides(canvas, obj, W, H) {
  const SNAP = 7
  const c = obj.getCenterPoint()
  const v = canvas.getObjects().find(o => o.smartGuide === 'v')
  const h = canvas.getObjects().find(o => o.smartGuide === 'h')
  if (Math.abs(c.x - W / 2) < SNAP) { obj.set('left', obj.left + (W / 2 - c.x)); v && v.set('visible', true) } else v && v.set('visible', false)
  if (Math.abs(c.y - H / 2) < SNAP) { obj.set('top',  obj.top  + (H / 2 - c.y)); h && h.set('visible', true) } else h && h.set('visible', false)
}

function hideSmartGuides(canvas) {
  canvas.getObjects().forEach(o => { if (o.smartGuide) o.set('visible', false) })
}

function swapBgElement(fabricImg, src, W, H) {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => { fabricImg.setElement(el); fabricImg.scaleToWidth(W); fabricImg.scaleToHeight(H); fabricImg.set({ left: 0, top: 0 }); resolve() }
    el.onerror = reject
    el.src = src
  })
}
