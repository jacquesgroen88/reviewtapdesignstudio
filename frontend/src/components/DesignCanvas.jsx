import { useEffect, useRef, useState, useCallback } from 'react'
import { fabric } from 'fabric'
// Static imports (NOT dynamic): a deploy rotates chunk hashes, and an
// already-open tab can no longer fetch old lazy chunks — PDF/TIFF export
// then fails. Bundling these makes export immune to redeploys.
import { jsPDF } from 'jspdf'
import UTIF from 'utif'
import { DISPLAY_SCALE } from '../lib/products.js'
import { generateStyledQR, QR_BASE_URL } from '../lib/qr.js'
import { apiFetch } from '../lib/api.js'
import { useHistory } from '../hooks/useHistory.js'
import LogoPanel     from './LogoPanel.jsx'
import CanvasToolbar from './CanvasToolbar.jsx'
import Menu          from './Menu.jsx'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4.0
const ZOOM_STEP = 0.25
const GAP_FULL = 120   // gap between side-by-side panels, full-res px

export default function DesignCanvas({ product, initialVariantId, jobName, prefill, onFirstSave, onOrderComplete }) {
  const canvasElRef = useRef(null)
  const scrollRef   = useRef(null)
  const fabricRef   = useRef(null)
  const bgRefs      = useRef({})   // { faceId: fabric.Image }
  const spaceRef    = useRef(false)
  const panRef      = useRef(false)
  const lastPan     = useRef(null)
  const prefillDone = useRef(false)
  const saveRef     = useRef(() => {})

  const [variantId,   setVariantId]   = useState(prefill?.savedDesign?.variant_id || initialVariantId || product.defaultVariant)
  const [ready,       setReady]       = useState(false)
  const [selectedObj, setSelectedObj] = useState(null)
  const [logos,       setLogos]       = useState([])
  const [zoom,        setZoom]        = useState(1)
  const [exporting,   setExporting]   = useState(false)
  const [exportMsg,   setExportMsg]   = useState(null)
  const [currentDesignId, setCurrentDesignId] = useState(prefill?.designId || null)
  const [showVariants, setShowVariants] = useState(false)
  // New designs auto-name as "{order#} - {Type} - {Company}", e.g. "1703 - Stand - ABC Company".
  // Order # comes from the linked order; Type from the product; Company is the editable part —
  // for multi-unit/multi-company orders, just rename the company in the field below. Falls back
  // gracefully to company-only (studio jobs) or the product name when nothing is known.
  function buildDefaultName() {
    const type    = product.id === 'card' ? 'Card' : 'Stand'
    const order   = String(prefill?.orderNumber || '').replace(/^#/, '').trim()
    const company = String(prefill?.companyName || jobName || '').trim()
    const parts = []
    if (order) parts.push(order)
    parts.push(type)
    if (company) parts.push(company)
    return parts.length > 1 ? parts.join(' - ') : `${product.name} design`
  }
  const [designName, setDesignName] = useState(prefill?.savedDesign?.name || prefill?.designName || buildDefaultName())

  const { snapshot, undo, redo, canUndo, canRedo, clear } = useHistory(fabricRef)

  const variant = product.templateVariants.find(v => v.id === variantId) || product.templateVariants[0]
  const faces   = variant.faces

  // Lay faces out left-to-right in full-res coords
  const layout = []
  let cursor = 0
  for (const f of faces) { layout.push({ face: f, x: cursor }); cursor += f.width + GAP_FULL }
  const totalWfull = cursor - GAP_FULL
  const totalHfull = Math.max(...faces.map(f => f.height))
  const W = Math.round(totalWfull * DISPLAY_SCALE)   // artboard display width  (zoom = 1)
  const H = Math.round(totalHfull * DISPLAY_SCALE)   // artboard display height (zoom = 1)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: W, height: H,
      backgroundColor: '#eef0f3',
      preserveObjectStacking: true, selection: true,
    })
    fabricRef.current = canvas

    let loaded = 0
    layout.forEach(({ face, x }) => {
      fabric.Image.fromURL(face.template, img => {
        if (img && img.width) {
          img.scaleToWidth(face.width * DISPLAY_SCALE)
          img.set({ left: x * DISPLAY_SCALE, top: 0, selectable: false, evented: false, hasControls: false, hasBorders: false, isBackground: true, faceId: face.id, objectCaching: false })
          bgRefs.current[face.id] = img
          canvas.add(img); canvas.sendToBack(img)
        }
        if (++loaded === layout.length) {
          drawGuides(canvas, layout, product.safeMargin)
          finishInit(canvas)
        }
      }, { crossOrigin: 'anonymous' })
    })

    // Restore only the placed assets (logos/QR) at their saved positions; the
    // backgrounds + guides are always drawn fresh for the current layout, so
    // stale coordinates can never misalign the design.
    function finishInit(canvas) {
      const saved = prefill?.savedDesign?.design
      if (saved?.assets?.length) {
        let done = 0
        const restored = []
        saved.assets.forEach(a => {
          fabric.Image.fromURL(a.src, img => {
            img.set({ left: a.left, top: a.top, scaleX: a.scaleX, scaleY: a.scaleY, angle: a.angle || 0, id: a.id, isQR: !!a.isQR, ...HANDLE_STYLE })
            img.on('moving', () => onAssetMove(img))
            canvas.add(img)
            restored.push({ id: a.id, name: a.isQR ? 'QR Code' : 'Logo', originalSrc: a.src, processedSrc: a.src, bgRemoved: false, isQR: !!a.isQR })
            if (++done === saved.assets.length) { setLogos(restored); canvas.renderAll(); setReady(true); snapshot() }
          }, { crossOrigin: 'anonymous' })
        })
      } else {
        canvas.renderAll(); setReady(true); snapshot()
        if (prefill?.logoUrl && !prefillDone.current) {
          prefillDone.current = true
          const proxied = `/api/proxy-image?url=${encodeURIComponent(prefill.logoUrl)}`
          const entry = { id: 'prefill_logo', name: `${prefill.companyName || 'Logo'}.png`, originalSrc: proxied, processedSrc: proxied, bgRemoved: false }
          setLogos([entry]); addToCanvas(entry)
        }
      }
    }

    canvas.on('selection:created', e => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:updated', e => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:cleared', ()  => setSelectedObj(null))
    const snap = () => snapshot()
    canvas.on('object:modified', snap)
    canvas.on('object:added',    snap)
    canvas.on('object:removed',  snap)

    // Ctrl/Cmd + wheel = zoom; plain wheel = let the container scroll naturally
    canvas.on('mouse:wheel', opt => {
      const e = opt.e
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault(); e.stopPropagation()
      const cur = zoomRef.current
      applyZoom(cur * (e.deltaY > 0 ? 0.9 : 1.1))
    })

    // Space-drag (or middle-mouse) = scroll the workspace
    canvas.on('mouse:down', opt => {
      const e = opt.e
      if (spaceRef.current || e.button === 1) { panRef.current = true; lastPan.current = { x: e.clientX, y: e.clientY }; canvas.setCursor('grabbing'); canvas.selection = false; e.preventDefault() }
    })
    canvas.on('mouse:move', opt => {
      if (!panRef.current) return
      const e = opt.e, sc = scrollRef.current
      if (sc) { sc.scrollLeft -= (e.clientX - lastPan.current.x); sc.scrollTop -= (e.clientY - lastPan.current.y) }
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
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveRef.current() }
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
      canvas.dispose(); clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap panel backgrounds when the variant changes (keeps placed assets)
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !ready) return
    faces.forEach(f => {
      const bg = bgRefs.current[f.id]
      const x  = layout.find(l => l.face.id === f.id)?.x ?? 0
      if (bg) swapBgElement(bg, f.template, f.width, x).then(() => canvas.renderAll())
    })
  }, [variantId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a ref of current zoom for the wheel handler closure
  const zoomRef = useRef(1)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  // Keep the save handler current for the Cmd/Ctrl+S shortcut
  useEffect(() => { saveRef.current = () => { if (hasAssets && !exporting) handleSaveDesign() } })

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
        scaleX: scale, scaleY: scale, id: entry.id, isQR: !!entry.isQR, ...HANDLE_STYLE,
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
        img.set({ scaleX: existing.scaleX, scaleY: existing.scaleY, left: existing.left, top: existing.top, angle: existing.angle, id: entry.id, isQR: !!entry.isQR, ...HANDLE_STYLE })
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

  // ── Zoom: grow the canvas + scale rendering; the workspace scrolls ─────────
  function applyZoom(z) {
    const canvas = fabricRef.current; if (!canvas) return
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))
    canvas.setDimensions({ width: Math.round(W * z), height: Math.round(H * z) })
    canvas.setZoom(z)
    canvas.renderAll()
    setZoom(z)
    // Centre the view on the artboard after a zoom step
    requestAnimationFrame(() => {
      const sc = scrollRef.current
      if (sc) { sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2 }
    })
  }
  function resetZoom() { applyZoom(1) }

  // ── Export: render at exact print size, crop each face's panel ─────────────
  async function exactFaceCanvas(entry, templateUrl) {
    const canvas = fabricRef.current
    canvas.discardActiveObject()
    const guides = canvas.getObjects().filter(o => o.isGuide)
    guides.forEach(g => g.set('visible', false))

    const savedW = canvas.getWidth(), savedH = canvas.getHeight(), savedZoom = canvas.getZoom()
    canvas.setZoom(1)
    canvas.setDimensions({ width: W, height: H })

    const bg = bgRefs.current[entry.face.id]
    const needSwap = bg && templateUrl && templateUrl !== entry.face.template
    if (needSwap) await swapBgElement(bg, templateUrl, entry.face.width, entry.x)

    canvas.renderAll()
    const full = canvas.toCanvasElement(1 / DISPLAY_SCALE)

    if (needSwap) await swapBgElement(bg, entry.face.template, entry.face.width, entry.x)
    canvas.setDimensions({ width: savedW, height: savedH })
    canvas.setZoom(savedZoom)
    guides.forEach(g => g.set('visible', true))
    canvas.renderAll()

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
      pdf.save(buildFilename({ orderNumber: prefill?.orderNumber, client: jobName, variantLabel: variant.label, faceLabel: '', ext: 'pdf' }))
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
        downloadBlob(dataURLtoBlob(out.toDataURL('image/jpeg', 0.92)), buildFilename({ orderNumber: prefill?.orderNumber, client: jobName, variantLabel: variant.label, faceLabel: layout.length > 1 ? e.face.label : '', ext: 'jpg' }))
      }
      showMsg('success', 'JPEG preview downloaded')
    } catch (err) { console.error(err); showMsg('error', 'JPEG export failed') }
    finally { setExporting(false) }
  }

  async function handleDownloadTIFF() {
    setExporting(true)
    try {
      for (const e of layout) {
        const cv = await exactFaceCanvas(e, e.face.template)
        const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
        const buf = UTIF.encodeImage(id.data.buffer, cv.width, cv.height, { t282: [300], t283: [300], t296: [2] })
        downloadBlob(new Blob([buf], { type: 'image/tiff' }), buildFilename({ orderNumber: prefill?.orderNumber, client: jobName, variantLabel: variant.label, faceLabel: layout.length > 1 ? e.face.label : '', ext: 'tiff' }))
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
        const filename = buildFilename({ orderNumber: prefill?.orderNumber, client: jobName, variantLabel: variant.label, faceLabel: layout.length > 1 ? e.face.label : '', ext: 'tiff' })
        const form = new FormData()
        form.append('file', blob, filename)
        form.append('businessName', jobName || 'ReviewTap')
        form.append('orderNumber', prefill?.orderNumber || '')
        form.append('productId', product.id)
        form.append('filename', filename)
        const res = await apiFetch('/api/upload', { method: 'POST', body: form })
        if (!res.ok) throw new Error(await res.text())
      }
      showMsg('success', 'Sent to Drive')
    } catch (err) { showMsg('error', `Drive upload failed: ${err.message}`) }
    finally { setExporting(false) }
  }

  // ── Save / duplicate / variants / complete ────────────────────────────────
  function serializeAssets() {
    return fabricRef.current.getObjects()
      .filter(o => o.type === 'image' && !o.isBackground && !o.isGuide)
      .map(o => ({ id: o.id, isQR: !!o.isQR, src: o.getSrc ? o.getSrc() : '', left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY, angle: o.angle || 0 }))
  }
  // Create a brand-new design row, or update the one we're editing.
  // The name comes from the inline name field (no native prompts).
  async function persistDesign() {
    const design = { assets: serializeAssets() }
    const name = (designName || '').trim() || `${product.name} design`
    if (currentDesignId) {
      const res = await apiFetch(`/api/designs/${currentDesignId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, variantId, design }),
      })
      if (!res.ok) throw new Error(await res.text())
      return currentDesignId
    }
    const res = await apiFetch('/api/designs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ownerSlug: prefill?.rowSlug || null, productId: product.id, variantId, design, orderNumber: prefill?.orderNumber || null }),
    })
    if (!res.ok) throw new Error(await res.text())
    const d = await res.json()
    setCurrentDesignId(d.id)
    onFirstSave?.(d.id)   // put the new design id in the URL (refresh-safe)
    return d.id
  }
  // Instant rename for an already-saved design (on blur of the name field)
  async function renameIfSaved() {
    if (!currentDesignId) return
    const name = (designName || '').trim()
    if (!name) return
    try {
      const res = await apiFetch(`/api/designs/${currentDesignId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (err) {
      showMsg('error', `Rename failed — the saved design still has its old name (${err.message || 'network error'})`)
    }
  }
  async function setStatus(status) {
    if (!prefill?.rowSlug) return
    try {
      const res = await apiFetch(`/api/orders/${prefill.rowSlug}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch {
      showMsg('error', 'Design saved, but updating the order status failed — set it manually on the Orders tab')
    }
  }
  async function handleSaveDesign() {
    setExporting(true)
    try { await persistDesign(); await setStatus('pending_approval'); showMsg('success', 'Design saved to your library') }
    catch (err) { showMsg('error', `Save failed: ${err.message}`) }
    finally { setExporting(false) }
  }
  async function handleMarkComplete() {
    setExporting(true)
    try { await persistDesign(); await setStatus('done'); showMsg('success', 'Saved & marked complete'); setTimeout(() => onOrderComplete?.(), 700) }
    catch (err) { showMsg('error', `Could not save: ${err.message}`) }
    finally { setExporting(false) }
  }

  // Duplicate = save the current canvas as a NEW design and switch to editing it
  async function handleDuplicate() {
    setExporting(true)
    try {
      const name = `${(designName || product.name).trim()} (copy)`
      const res = await apiFetch('/api/designs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ownerSlug: prefill?.rowSlug || null, productId: product.id, variantId, design: { assets: serializeAssets() }, orderNumber: prefill?.orderNumber || null }),
      })
      if (!res.ok) throw new Error(await res.text())
      const d = await res.json()
      setCurrentDesignId(d.id)
      setDesignName(name)
      onFirstSave?.(d.id)   // URL now points at the copy we're editing
      showMsg('success', 'Duplicated — now editing the copy. Swap the QR and Save.')
    } catch (err) { showMsg('error', `Duplicate failed: ${err.message}`) }
    finally { setExporting(false) }
  }

  // Bulk: same design, one new saved design per selected QR code (swaps the QR)
  async function handleGenerateVariants(qrCodes) {
    setShowVariants(false)
    if (!qrCodes.length) return
    setExporting(true)
    try {
      const baseAssets = serializeAssets()
      if (!baseAssets.some(a => a.isQR)) { showMsg('error', 'Add a QR code to the design first.'); return }
      const isBlack = variantId === 'black'
      const qrStyle = { fg: isBlack ? '#fff6ea' : '#000000', bg: isBlack ? '#000000' : '#ffffff', ec: 'M', styleId: 'rounded', width: 600 }
      let made = 0
      for (const qr of qrCodes) {
        const dataUrl = await generateStyledQR(`${QR_BASE_URL}/${qr.id}`, qrStyle)
        const assets = baseAssets.map(a => a.isQR ? { ...a, src: dataUrl } : a)
        const res = await apiFetch('/api/designs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${jobName || 'Design'} – ${qr.label}`, ownerSlug: prefill?.rowSlug || null, productId: product.id, variantId, design: { assets } }),
        })
        if (res.ok) made++
      }
      showMsg('success', `Created ${made} QR variant${made === 1 ? '' : 's'} — find them in the library/order`)
    } catch (err) { showMsg('error', `Variant generation failed: ${err.message}`) }
    finally { setExporting(false) }
  }

  function showMsg(type, text) { setExportMsg({ type, text }); setTimeout(() => setExportMsg(null), 5000) }

  const hasAssets = logos.length > 0
  const hasQR = logos.some(l => l.isQR)
  const zoomPct = Math.round(zoom * 100)

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      <div className="w-64 shrink-0 border-r border-gray-100 bg-white overflow-y-auto flex flex-col">
        {faces.length > 1 && (
          <p className="px-4 pt-3 -mb-1 text-xs text-gray-400">{faces.map(f => f.label).join(' (left) & ')} (right) — drag assets freely between them.</p>
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
        {/* Design name (editable, click-to-rename) */}
        <div className="border-b border-gray-100 bg-white px-4 py-2 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 shrink-0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <input
            value={designName}
            onChange={e => setDesignName(e.target.value)}
            onBlur={renameIfSaved}
            placeholder="Untitled design"
            className="text-sm font-semibold text-gray-800 bg-transparent border border-transparent hover:border-gray-200 focus:border-brand-400 focus:bg-white rounded-lg px-2 py-1 -mx-1 outline-none w-full max-w-sm transition-colors"
          />
          {currentDesignId
            ? <span className="text-xs text-brand-600 shrink-0">saved</span>
            : <span className="text-xs text-gray-300 shrink-0">unsaved</span>}
        </div>

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

        <div ref={scrollRef} className="flex-1 bg-gray-100 overflow-auto">
          <div className="min-h-full min-w-full flex items-center justify-center p-10">
            <div className="relative">
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
                  <svg className="animate-spin w-8 h-8 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                </div>
              )}
              <canvas ref={canvasElRef} className="shadow-2xl" />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 bg-white px-5 py-3 flex items-center gap-4">
          <p className="text-sm text-gray-400 shrink-0">
            {!hasAssets ? 'Add a logo or QR code to get started.' : `${logos.length} item${logos.length > 1 ? 's' : ''} placed.`}
          </p>
          {exportMsg && (
            <span className={`text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 ${exportMsg.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>{exportMsg.text}</span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {/* Export menu — client previews + print files grouped */}
            <Menu
              disabled={!hasAssets || exporting}
              className="btn-secondary disabled:opacity-50"
              label={<><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg></>}
              items={[
                { heading: 'Client preview' },
                { label: 'Mockup PDF', onClick: handleDownloadPDF },
                { label: 'JPEG image',  onClick: handleDownloadJPEG },
                { heading: 'Print files' },
                { label: 'Print TIFF (download)', onClick: handleDownloadTIFF },
                { label: 'Send to Google Drive',  onClick: handleUploadToDrive },
              ]}
            />

            {/* More — design-level actions */}
            <Menu
              disabled={!hasAssets || exporting}
              className="btn-secondary px-3 disabled:opacity-50"
              label={<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>}
              items={[
                { label: 'Duplicate design', onClick: handleDuplicate,
                  icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> },
                ...(hasQR ? [{ label: 'Generate QR variants…', onClick: () => setShowVariants(true),
                  icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M17 20h3M20 17v3"/></svg> }] : []),
              ]}
            />

            <button className="btn-secondary" title="Save this design to your library (Ctrl+S)" disabled={!hasAssets || exporting} onClick={handleSaveDesign}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save
            </button>
            {prefill?.rowSlug && (
              <button className="btn-primary" title="Save and mark the order complete" disabled={!hasAssets || exporting} onClick={handleMarkComplete}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Done
              </button>
            )}
          </div>
        </div>
      </div>

      {showVariants && (
        <VariantsModal onClose={() => setShowVariants(false)} onGenerate={handleGenerateVariants} />
      )}
    </div>
  )
}

// ── QR variants modal ─────────────────────────────────────────────────────────

function VariantsModal({ onClose, onGenerate }) {
  const [codes, setCodes]   = useState([])
  const [sel,   setSel]     = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    apiFetch('/api/qr').then(r => r.ok ? r.json() : []).then(c => { setCodes(c); setLoading(false) }).catch(() => setLoading(false))
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(id) { setSel(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  const filtered = codes.filter(c => c.label.toLowerCase().includes(search.toLowerCase()))
  const chosen = codes.filter(c => sel.has(c.id))

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6 space-y-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Generate QR variants</h2>
            <p className="text-xs text-gray-400 mt-0.5">One new design per selected QR code — same layout, swapped QR.</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {codes.length > 5 && (
          <input className="input-field text-sm" placeholder="Search QR codes…" value={search} onChange={e => setSearch(e.target.value)} />
        )}

        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
          {loading ? (
            <div className="flex justify-center py-6"><svg className="animate-spin w-5 h-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No saved QR codes. Create some in the QR Codes tab first.</p>
          ) : filtered.map(c => (
            <label key={c.id} className="flex items-center gap-2.5 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="accent-brand-600" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{c.label}</p>
                <p className="text-xs text-gray-400 font-mono">/r/{c.id}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" disabled={chosen.length === 0} onClick={() => onGenerate(chosen)}>
            Create {chosen.length || ''} design{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const HANDLE_STYLE = { cornerSize: 10, transparentCorners: false, cornerColor: '#14b893', borderColor: '#14b893', borderScaleFactor: 1.5 }

function drawGuides(canvas, layout, safeMargin) {
  layout.forEach(({ face, x }) => {
    const ox = x * DISPLAY_SCALE
    const pw = face.width * DISPLAY_SCALE
    const ph = face.height * DISPLAY_SCALE
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
  const b = obj.getBoundingRect(true)   // absolute = content coords (ignores zoom)
  if (b.left < 0)            obj.set('left', obj.left - b.left)
  if (b.top  < 0)            obj.set('top',  obj.top  - b.top)
  if (b.left + b.width  > W) obj.set('left', W - b.width  - (b.left - obj.left))
  if (b.top  + b.height > H) obj.set('top',  H - b.height - (b.top  - obj.top))
}

function swapBgElement(fabricImg, src, faceWidth, xFull) {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => {
      fabricImg.setElement(el)
      fabricImg.scaleToWidth(faceWidth * DISPLAY_SCALE)
      fabricImg.set({ left: xFull * DISPLAY_SCALE, top: 0, objectCaching: false })
      fabricImg.dirty = true   // invalidate any cached render so the swap actually paints
      resolve()
    }
    el.onerror = reject
    el.src = src
  })
}

// Unified export naming (spec Feature H):
// {order#}_{Client}_{WhiteStand|BlackCard|...}[_{Front|Back}]_{YYYY-MM-DD}.{ext}
function buildFilename({ orderNumber, client, variantLabel, faceLabel, ext }) {
  const order = String(orderNumber || '').replace(/^#/, '').trim()
  const date  = new Date().toISOString().slice(0, 10)
  const base = [order, client, (variantLabel || '').replace(/\s+/g, ''), faceLabel, date]
    .filter(Boolean).join('_') || 'Design'
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
