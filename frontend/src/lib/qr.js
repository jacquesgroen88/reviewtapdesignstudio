// Shared QR generation (used by QRPanel and the editor's variant generator)

// Static import (NOT dynamic): a deploy rotates chunk hashes, and an
// already-open tab can no longer fetch the old lazy chunk — QR add then
// fails with "Failed to fetch dynamically imported module". Bundling it
// into the main bundle makes QR generation immune to redeploys.
import QRCodeStyling from 'qr-code-styling'

// Where dynamic QR codes redirect through. Override with VITE_QR_BASE_URL
// (e.g. https://link.reviewtap.co.za/r).
export const QR_BASE_URL = import.meta.env.VITE_QR_BASE_URL || `${window.location.origin}/r`

// A saved default_style is presentation-only: {styleId, fg, bg, transparent, ec}.
// It NEVER changes what the QR encodes — restyling can't break printed codes.
export const PLAIN_STYLE = { styleId: 'square', fg: '#000000', bg: '#ffffff', transparent: false, ec: 'M' }

// One-click presets matching the product conventions (black stands print
// cream #fff6ea modules on black; white stands black on transparent).
export const STAND_PRESETS = [
  { id: 'white-stand', label: 'White stand / card', style: { styleId: 'rounded', fg: '#000000', bg: '#ffffff', transparent: true,  ec: 'M' } },
  { id: 'black-stand', label: 'Black stand / card', style: { styleId: 'rounded', fg: '#fff6ea', bg: '#000000', transparent: false, ec: 'M' } },
]

// Convert a saved style object into generateStyledQR options
export function styleToGenOpts(style, width = 600) {
  const s = { ...PLAIN_STYLE, ...(style || {}) }
  return { fg: s.fg, bg: s.transparent ? 'rgba(0,0,0,0)' : s.bg, ec: s.ec, styleId: s.styleId, width }
}

// QR shape presets → qr-code-styling dot + corner types
export const QR_STYLES = [
  { id: 'square',  label: 'Square',  dot: 'square',         corner: 'square' },
  { id: 'rounded', label: 'Rounded', dot: 'rounded',        corner: 'extra-rounded' },
  { id: 'dots',    label: 'Dots',    dot: 'dots',           corner: 'dot' },
  { id: 'classy',  label: 'Classy',  dot: 'classy-rounded', corner: 'extra-rounded' },
]

export async function generateStyledQR(data, { fg, bg, ec, styleId, width = 600 }) {
  const preset = QR_STYLES.find(s => s.id === styleId) || QR_STYLES[0]
  const qr = new QRCodeStyling({
    width, height: width, data, margin: 8,
    qrOptions: { errorCorrectionLevel: ec },
    dotsOptions:          { color: fg, type: preset.dot },
    backgroundOptions:    { color: bg },
    cornersSquareOptions: { color: fg, type: preset.corner },
    cornersDotOptions:    { color: fg, type: preset.id === 'dots' ? 'dot' : '' },
  })
  const blob = await qr.getRawData('png')
  return await blobToDataURL(blob)
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}
