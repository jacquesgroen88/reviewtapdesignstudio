// Shared logo image pipeline: background removal + cropping.
// Pipeline order (spec Feature D): originalSrc -> bgRemoved? -> crop -> processedSrc.
// Both steps compose from the UNCROPPED bg-removed cache (bgRemovedFullSrc) so
// toggling background removal after a crop doesn't discard the crop, and
// re-cropping after bg removal doesn't re-run the (slow) WASM model.

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function removeBg(imageSrc) {
  // Lazy-load the heavy WASM model only when first needed
  const { removeBackground } = await import('@imgly/background-removal')
  // Fetch to a Blob first — reliably handles data URLs, object URLs, and
  // same-origin proxied logo URLs (a raw string URL can fail to resolve
  // inside the worker).
  const resp = await fetch(imageSrc)
  if (!resp.ok) throw new Error(`could not load image (${resp.status})`)
  const inputBlob = await resp.blob()
  const outBlob = await removeBackground(inputBlob)
  // Data URL (not a blob: object URL) so it survives a save/reload cycle.
  return readFileAsDataURL(outBlob)
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
