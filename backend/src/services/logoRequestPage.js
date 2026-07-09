// Server-rendered public "send us your logo" page — same pattern as
// approvalPage.js: plain HTML, zero SPA dependency, works in WhatsApp's
// in-app browser, immune to chunk rotation.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function renderLogoRequestPage(order, publicBase) {
  const submitted = !!order.request_submitted_at
  const title = `Send your logo — ${esc(order.company_name || 'ReviewTap')}`

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<meta property="og:title" content="Send us your logo">
<meta property="og:description" content="Quick upload — one form, no account needed.">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f6f7f9; color: #14202e; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 20px 16px 60px; }
  header { text-align: center; padding: 18px 0 6px; }
  header .logo { width: 40px; height: 40px; object-fit: contain; margin-bottom: 6px; }
  header .brand { font-weight: 800; font-size: 20px; letter-spacing: -0.3px; }
  header .brand span { color: #f97316; }
  header p { color: #5b6b7c; font-size: 14px; margin-top: 6px; }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 1px 4px rgba(20,32,46,.08); padding: 20px; margin-top: 16px; }
  .field { margin-bottom: 14px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  input[type="text"], input[type="url"] { width: 100%; border: 1px solid #d7dde4; border-radius: 10px; padding: 10px 12px; font: inherit; }
  .drop { border: 2px dashed #d7dde4; border-radius: 12px; padding: 20px; text-align: center; cursor: pointer; color: #5b6b7c; font-size: 14px; }
  .drop.has-file { border-color: #f97316; color: #14202e; }
  .drop img { max-width: 100%; max-height: 120px; border-radius: 8px; margin-bottom: 8px; }
  .btn { display: block; width: 100%; border: 0; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 14px; background: #f97316; color: #fff; }
  .btn[disabled] { opacity: .5; }
  .done { text-align: center; padding: 30px 10px; }
  .done .tick { font-size: 40px; color: #16a34a; }
  .err { color: #dc2626; font-size: 13px; margin-top: 8px; }
  footer { text-align: center; color: #8a97a5; font-size: 12px; margin-top: 28px; }
</style>
</head><body>
<div class="wrap">
  <header>
    <img src="/reviewtap-icon.png" alt="ReviewTap" class="logo">
    <div class="brand">Review<span>Tap</span></div>
    <p>Hi ${esc(order.company_name || 'there')}${order.order_number ? ` &mdash; order #${esc(order.order_number)}` : ''}!<br>
    We just need your logo to get your design started.</p>
  </header>
  <div class="card">
  ${submitted ? `
    <div class="done"><div class="tick">&#10003;</div><p style="margin-top:10px;font-weight:600">Got it — thanks!</p>
    <p style="color:#5b6b7c;font-size:13px;margin-top:6px">Our designer is on it. We'll send you the design to approve shortly.</p></div>
  ` : `
    <div class="field">
      <label>Your logo</label>
      <div class="drop" id="drop" onclick="document.getElementById('file').click()">
        <div id="dropInner">Tap to choose a file (PNG, JPG, or PDF)</div>
      </div>
      <input type="file" id="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden>
    </div>
    <div class="field">
      <label>Business name (exactly as it appears on Google) — or your Google review link</label>
      <input type="text" id="nameOrLink" placeholder="e.g. Ourief Wedding Venue, or https://g.page/r/..." value="${order.company_name && !/^Order #/.test(order.company_name) ? esc(order.company_name) : ''}">
    </div>
    <button class="btn" id="submitBtn" onclick="submit()">Send my logo</button>
    <p class="err" id="err" hidden></p>
  `}
  </div>
  <footer>ReviewTap &middot; reviewtap.co.za</footer>
</div>
<script>
let fileDataUrl = null
const fileInput = document.getElementById('file')
if (fileInput) {
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      fileDataUrl = reader.result
      const drop = document.getElementById('drop')
      drop.classList.add('has-file')
      if (f.type.startsWith('image/')) {
        document.getElementById('dropInner').innerHTML = '<img src="' + fileDataUrl + '"><div>' + f.name + '</div>'
      } else {
        document.getElementById('dropInner').textContent = f.name + ' — ready to send'
      }
    }
    reader.readAsDataURL(f)
  })
}
async function submit() {
  const err = document.getElementById('err')
  err.hidden = true
  const nameOrLink = document.getElementById('nameOrLink').value.trim()
  if (!fileDataUrl) { err.textContent = 'Please choose a logo file first.'; err.hidden = false; return }
  if (!nameOrLink) { err.textContent = 'Please enter your business name or paste your Google review link.'; err.hidden = false; return }
  const btn = document.getElementById('submitBtn')
  btn.disabled = true; btn.textContent = 'Sending…'
  try {
    const res = await fetch('${publicBase}/logo-request/${esc(order.request_token)}/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logo: fileDataUrl, nameOrLink }),
    })
    if (!res.ok) throw new Error()
    location.reload()
  } catch {
    err.textContent = 'Something went wrong — please try again.'
    err.hidden = false
    btn.disabled = false; btn.textContent = 'Send my logo'
  }
}
</script>
</body></html>`
}
