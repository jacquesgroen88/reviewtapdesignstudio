// Shared QR generation (used by QRPanel and the editor's variant generator)

// Where dynamic QR codes redirect through. Override with VITE_QR_BASE_URL
// (e.g. https://link.reviewtap.co.za/r).
export const QR_BASE_URL = import.meta.env.VITE_QR_BASE_URL || `${window.location.origin}/r`

// QR shape presets → qr-code-styling dot + corner types
export const QR_STYLES = [
  { id: 'square',  label: 'Square',  dot: 'square',         corner: 'square' },
  { id: 'rounded', label: 'Rounded', dot: 'rounded',        corner: 'extra-rounded' },
  { id: 'dots',    label: 'Dots',    dot: 'dots',           corner: 'dot' },
  { id: 'classy',  label: 'Classy',  dot: 'classy-rounded', corner: 'extra-rounded' },
]

export async function generateStyledQR(data, { fg, bg, ec, styleId, width = 600 }) {
  const QRCodeStyling = (await import('qr-code-styling')).default
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
