// Shared logo image pipeline: background removal + cropping.
// Pipeline order (spec Feature D): originalSrc -> bgRemoved? -> crop -> processedSrc.
// Both steps compose from the UNCROPPED bg-removed cache (bgRemovedFullSrc) so
// toggling background removal after a crop doesn't discard the crop, and
// re-cropping after bg removal doesn't re-run the (slow) processing.
//
// Background removal is TIERED (2026-07-14 rebuild — see
// 2026-07-07... / 2026-07-14-fulfillment-and-bgremoval-spec.md). A real-logo test
// of the live Formaloo intake showed ~11/12 client logos need NO AI model:
//   • ~5/12 are already-transparent PNGs  -> running the AI model DEGRADES them,
//     so we detect existing alpha and leave them untouched.
//   • ~6/12 are flat logos on a solid (usually white) background -> a deterministic
//     corner flood-fill knockout is cleaner AND instant.
//   • ~1/12 is a true photo/illustration -> the AI model (@imgly ISNet) is the fallback.
// So the DEFAULT ('auto') is: existing alpha? leave it. else knockout. AI is opt-in.

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Draw an image onto a fresh canvas, optionally capped to maxDim on the long edge.
// Knockout runs at capped resolution (default 2000px): the placed logo on a
// 120x140mm stand @300 DPI is well under 500px, so a 2000px working copy is far
// more than the print ever needs and keeps the flood-fill fast (<=4MP) and light.
async function drawToCanvas(src, maxDim = 0) {
  const img = await loadImage(src)
  let w = img.naturalWidth || img.width
  let h = img.naturalHeight || img.height
  if (maxDim && Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h)
    w = Math.round(w * s); h = Math.round(h * s)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, w); canvas.height = Math.max(1, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { canvas, ctx }
}

// How much of the image is already transparent? Sampled on a small copy for speed.
export async function getAlphaInfo(src) {
  try {
    const { ctx, canvas } = await drawToCanvas(src, 256)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let transparent = 0, total = 0
    for (let i = 3; i < data.length; i += 4) { total++; if (data[i] < 24) transparent++ }
    return { transparentFraction: total ? transparent / total : 0 }
  } catch {
    return { transparentFraction: 0 }
  }
}

// Deterministic corner/solid-colour knockout. Flood-fills from the four corners
// over pixels within `tolerance` (RGB distance) of the sampled background colour,
// so INTERIOR solid areas (e.g. white letter counters) are preserved — only the
// background-connected region is cleared. A light `feather` softens the boundary.
export async function knockoutBackground(src, { tolerance = 32, feather = 1 } = {}) {
  const { canvas, ctx } = await drawToCanvas(src, 2000)
  const W = canvas.width, H = canvas.height
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  const N = W * H

  const idx = (x, y) => (y * W + x)
  // Background colour = the DOMINANT border colour (16-bucket histogram mode over
  // all four edges), not the corner average — robust to a logo element touching
  // one edge. Where it can't cleanly separate (soft vignette/photo), the caller's
  // 'auto' policy falls back to the AI model based on the cleared fraction below.
  const hist = new Map()
  const sx = Math.max(1, Math.floor(W / 300)), sy = Math.max(1, Math.floor(H / 300))
  const acc = (p) => {
    const k = (d[p * 4] >> 4) + ',' + (d[p * 4 + 1] >> 4) + ',' + (d[p * 4 + 2] >> 4)
    const e = hist.get(k) || { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += d[p * 4]; e.g += d[p * 4 + 1]; e.b += d[p * 4 + 2]; hist.set(k, e)
  }
  for (let x = 0; x < W; x += sx) { acc(idx(x, 0)); acc(idx(x, H - 1)) }
  for (let y = 0; y < H; y += sy) { acc(idx(0, y)); acc(idx(W - 1, y)) }
  let mode = null
  for (const e of hist.values()) if (!mode || e.n > mode.n) mode = e
  const br = mode.r / mode.n, bg = mode.g / mode.n, bb = mode.b / mode.n

  const dist = (p) => {
    const r = d[p * 4] - br, g = d[p * 4 + 1] - bg, b = d[p * 4 + 2] - bb
    return Math.sqrt(r * r + g * g + b * b)
  }

  let clearedCount = 0
  // Iterative flood fill from every edge pixel that matches the background.
  const isBg = new Uint8Array(N)   // 1 = background (to clear)
  const seen = new Uint8Array(N)
  const stack = []
  const seed = (p) => { if (!seen[p] && d[p * 4 + 3] > 8 && dist(p) <= tolerance) { seen[p] = 1; isBg[p] = 1; stack.push(p) } }
  for (let x = 0; x < W; x++) { seed(idx(x, 0)); seed(idx(x, H - 1)) }
  for (let y = 0; y < H; y++) { seed(idx(0, y)); seed(idx(W - 1, y)) }
  while (stack.length) {
    const p = stack.pop()
    const x = p % W, y = (p - x) / W
    if (x > 0)     { const q = p - 1; if (!seen[q]) { seen[q] = 1; if (d[q * 4 + 3] > 8 && dist(q) <= tolerance) { isBg[q] = 1; stack.push(q) } } }
    if (x < W - 1) { const q = p + 1; if (!seen[q]) { seen[q] = 1; if (d[q * 4 + 3] > 8 && dist(q) <= tolerance) { isBg[q] = 1; stack.push(q) } } }
    if (y > 0)     { const q = p - W; if (!seen[q]) { seen[q] = 1; if (d[q * 4 + 3] > 8 && dist(q) <= tolerance) { isBg[q] = 1; stack.push(q) } } }
    if (y < H - 1) { const q = p + W; if (!seen[q]) { seen[q] = 1; if (d[q * 4 + 3] > 8 && dist(q) <= tolerance) { isBg[q] = 1; stack.push(q) } } }
  }

  // Clear background; feather the boundary (kept pixels touching a cleared pixel
  // whose colour is still near the bg get partial alpha for a soft edge).
  const featherRange = Math.max(0, feather) * tolerance * 0.6
  const touchesBg = (p, x, y) =>
    (x > 0 && isBg[p - 1]) || (x < W - 1 && isBg[p + 1]) ||
    (y > 0 && isBg[p - W]) || (y < H - 1 && isBg[p + W])
  for (let p = 0; p < N; p++) {
    if (isBg[p]) { d[p * 4 + 3] = 0; clearedCount++; continue }
    if (featherRange > 0) {
      const x = p % W, y = (p - x) / W
      if (touchesBg(p, x, y)) {
        const over = dist(p) - tolerance
        if (over < featherRange) {
          const a = Math.max(0, Math.min(255, Math.round(255 * (over / featherRange))))
          if (a < d[p * 4 + 3]) d[p * 4 + 3] = a
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0)
  return { src: canvas.toDataURL('image/png'), cleared: clearedCount / N }
}

// AI segmentation (fallback for photographic logos). Pinned to isnet_fp16 for
// cleaner edges; caller may pass a lighter model for a "Fast" mode.
export async function removeBg(imageSrc, { model = 'isnet_fp16' } = {}) {
  const { removeBackground } = await import('@imgly/background-removal')
  // Fetch to a Blob first — reliably handles data URLs, object URLs, and
  // same-origin proxied logo URLs (a raw string URL can fail to resolve
  // inside the worker).
  const resp = await fetch(imageSrc)
  if (!resp.ok) throw new Error(`could not load image (${resp.status})`)
  const inputBlob = await resp.blob()
  const outBlob = await removeBackground(inputBlob, { model })
  // Data URL (not a blob: object URL) so it survives a save/reload cycle.
  return readFileAsDataURL(outBlob)
}

// Unified entry point. Returns { src, method } where method is what was ACTUALLY
// applied so the UI can label it and avoid re-running the wrong tool.
//   method 'auto'     -> already-transparent? return unchanged ('none'); else knockout.
//   method 'knockout' -> deterministic corner knockout.
//   method 'ai'       -> @imgly model.
export async function removeBackgroundSmart(imageSrc, { method = 'auto', tolerance = 36, feather = 1, aiModel = 'isnet_fp16' } = {}) {
  if (method === 'ai') {
    return { src: await removeBg(imageSrc, { model: aiModel }), method: 'ai' }
  }
  if (method === 'knockout') {
    const ko = await knockoutBackground(imageSrc, { tolerance, feather })
    return { src: ko.src, method: 'knockout' }
  }
  // auto: already-transparent PNG? leave it (the AI model degrades a clean cutout).
  const { transparentFraction } = await getAlphaInfo(imageSrc)
  if (transparentFraction > 0.12) return { src: imageSrc, method: 'none' }
  // else try the deterministic knockout; if it barely cleared anything the background
  // wasn't a clean solid (soft vignette / photo) → fall back to the AI model.
  const ko = await knockoutBackground(imageSrc, { tolerance, feather })
  if (ko.cleared >= 0.04) return { src: ko.src, method: 'knockout' }
  return { src: await removeBg(imageSrc, { model: aiModel }), method: 'ai' }
}

// Crop at the SOURCE image's native resolution — never the on-screen display
// size — so print output stays full quality. pixelCrop is {x,y,width,height}
// in the source image's own pixel coordinates.
export async function cropToDataUrl(src, pixelCrop) {
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width  = Math.max(1, Math.round(pixelCrop.width))
  canvas.height = Math.max(1, Math.round(pixelCrop.height))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    img,
    Math.round(pixelCrop.x), Math.round(pixelCrop.y), Math.round(pixelCrop.width), Math.round(pixelCrop.height),
    0, 0, canvas.width, canvas.height,
  )
  return canvas.toDataURL('image/png')
}
