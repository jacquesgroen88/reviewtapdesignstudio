// Headless design renderer — reproduces DesignCanvas's export pipeline without
// mounting the editor. Used by the library's bulk export; the client-approval
// mockup renderer (Feature F) will reuse it.
//
// Faithfulness matters more than elegance here: layout math, background
// scaling, asset placement, and the exact-face crop mirror DesignCanvas.jsx
// (layout block + exactFaceCanvas). Saved asset coords are in DISPLAY_SCALE
// space; the full-res render multiplies back out, then crops each face to its
// exact print pixel size (Gotcha 10).

import { fabric } from 'fabric'
// Static import (Gotcha 11): export must survive redeploys mid-session
import UTIF from 'utif'
import { getProduct, DISPLAY_SCALE } from './products.js'

const GAP_FULL = 120   // must match DesignCanvas.jsx

function loadFabricImage(src) {
  return new Promise((resolve, reject) => {
    fabric.Image.fromURL(src, img => {
      if (img && img.width) resolve(img)
      else reject(new Error('Image failed to load'))
    }, { crossOrigin: 'anonymous' })
  })
}

// Render a full design row ({product_id, variant_id, design:{assets}}) and
// return one exact-size canvas per face: [{ faceId, faceLabel, variantLabel, canvas }]
export async function renderDesignFaces(designRow) {
  const product = getProduct(designRow.product_id)
  if (!product) throw new Error(`Unknown product "${designRow.product_id}"`)
  const variant = product.templateVariants.find(v => v.id === designRow.variant_id) || product.templateVariants[0]
  const faces = variant.faces

  // Same left-to-right layout as the editor
  const layout = []
  let cursor = 0
  for (const f of faces) { layout.push({ face: f, x: cursor }); cursor += f.width + GAP_FULL }
  const totalWfull = cursor - GAP_FULL
  const totalHfull = Math.max(...faces.map(f => f.height))
  const W = Math.round(totalWfull * DISPLAY_SCALE)
  const H = Math.round(totalHfull * DISPLAY_SCALE)

  const canvas = new fabric.StaticCanvas(null, { width: W, height: H, backgroundColor: '#eef0f3' })
  try {
    // Backgrounds first (same scaling as the editor init)
    for (const { face, x } of layout) {
      const img = await loadFabricImage(face.template)
      img.scaleToWidth(face.width * DISPLAY_SCALE)
      img.set({ left: x * DISPLAY_SCALE, top: 0 })
      canvas.add(img)
    }
    // Assets in saved order (array order = z-order)
    for (const a of (designRow.design?.assets || [])) {
      const img = await loadFabricImage(a.src)
      img.set({ left: a.left, top: a.top, scaleX: a.scaleX, scaleY: a.scaleY, angle: a.angle || 0 })
      canvas.add(img)
    }
    canvas.renderAll()
    const full = canvas.toCanvasElement(1 / DISPLAY_SCALE)

    // Crop each face's panel to its exact print dimensions
    return layout.map(({ face, x }) => {
      const out = document.createElement('canvas')
      out.width = face.width
      out.height = face.height
      const sx = (x / totalWfull) * full.width
      const sw = (face.width / totalWfull) * full.width
      const sh = (face.height / totalHfull) * full.height
      out.getContext('2d').drawImage(full, sx, 0, sw, sh, 0, 0, face.width, face.height)
      return { faceId: face.id, faceLabel: face.label, variantLabel: variant.label, canvas: out }
    })
  } finally {
    canvas.dispose()
  }
}

// Exact-size canvas → 300 DPI TIFF blob (same UTIF tags as the editor export)
export function canvasToTiffBlob(cv) {
  const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  const buf = UTIF.encodeImage(id.data.buffer, cv.width, cv.height, { t282: [300], t283: [300], t296: [2] })
  return new Blob([buf], { type: 'image/tiff' })
}
