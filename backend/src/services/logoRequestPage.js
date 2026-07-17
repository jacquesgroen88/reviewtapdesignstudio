// Server-rendered public "send us your logo" page — same pattern as
// approvalPage.js: plain HTML, zero SPA dependency, works in WhatsApp's
// in-app browser, immune to chunk rotation.
//
// NOTE ON THE CLIENT SCRIPT BELOW: it uses string CONCATENATION, never template
// literals. The whole page is itself inside a server-side template literal, so a
// stray backtick or ${...} in the client code terminates it or interpolates at
// render time. This is why Google's official minified loader snippet is NOT used
// here (it contains both) — a plain script tag does the same job safely.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Public, domain-restricted browser key — the SAME key the Fulfillment Console
// uses (reviewtap-fulfillment.html:375), now allowlisted for link.reviewtap.co.za
// as well as jcereports.netlify.app. It ships in the HTML by design and is inert
// off those domains, so this is not a secret in the .env sense. Lives on
// ReviewTap's Google project, so it transfers with the business.
// Override per-environment with GOOGLE_MAPS_BROWSER_KEY if the key is ever rotated.
const DEFAULT_MAPS_KEY = 'AIzaSyCYUFTODezWI6KwvMjWzBet1Y_03QfRkec'

export function renderLogoRequestPage(order, publicBase) {
  const submitted = !!order.request_submitted_at
  const title = `Send your logo — ${esc(order.company_name || 'ReviewTap')}`
  const mapsKey = process.env.GOOGLE_MAPS_BROWSER_KEY || DEFAULT_MAPS_KEY
  // Only prefill the search box with a real business name — never the
  // "Order #1234" placeholder the missing-logo banner creates.
  const prefill = order.company_name && !/^Order #/.test(order.company_name) ? order.company_name : ''

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
  /* Places picker */
  .searchrow { display: flex; gap: 8px; }
  .searchrow input { flex: 1; }
  .sbtn { border: 1px solid #d7dde4; background: #fff; border-radius: 10px; padding: 0 14px; font: inherit; font-weight: 600; cursor: pointer; color: #14202e; }
  .sbtn[disabled] { opacity: .5; }
  .results { margin-top: 10px; display: none; }
  .res { border: 1px solid #e4e9ee; border-radius: 10px; padding: 10px 12px; cursor: pointer; margin-bottom: 6px; }
  .res:hover { border-color: #f97316; background: #fff8f3; }
  .res .rn { font-weight: 600; font-size: 14px; }
  .res .ra { color: #5b6b7c; font-size: 12px; margin-top: 2px; }
  .res .rr { color: #8a97a5; font-size: 12px; margin-top: 2px; }
  .picked { display: none; border: 1px solid #16a34a; background: #f0fdf4; border-radius: 10px; padding: 10px 12px; }
  .picked .pn { font-weight: 700; font-size: 14px; }
  .picked .pa { color: #5b6b7c; font-size: 12px; margin-top: 2px; }
  .picked .px { color: #16a34a; font-size: 12px; margin-top: 6px; font-weight: 600; }
  .linkish { background: none; border: 0; padding: 0; margin-top: 8px; color: #5b6b7c; font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
  .manual { display: none; margin-top: 10px; }
  .hint { color: #8a97a5; font-size: 12px; margin-top: 6px; }
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
      <label>Find your business on Google</label>
      <div class="searchrow" id="searchRow">
        <input type="text" id="bizSearch" placeholder="e.g. Ourief Wedding Venue, Sasolburg" value="${esc(prefill)}" autocomplete="off">
        <button class="sbtn" id="searchBtn" type="button" onclick="doSearch()">Search</button>
      </div>
      <div class="results" id="results"></div>
      <div class="picked" id="picked"></div>
      <p class="hint" id="searchHint">We use this to build your review link, so your QR code goes to the right place.</p>
      <button class="linkish" id="manualToggle" type="button" onclick="showManual()">Can't find your business? Enter it manually</button>
      <div class="manual" id="manualWrap">
        <label for="nameOrLink">Business name (exactly as it appears on Google) &mdash; or your Google review link</label>
        <input type="text" id="nameOrLink" placeholder="e.g. Ourief Wedding Venue, or https://g.page/r/..." value="${esc(prefill)}">
      </div>
    </div>
    <button class="btn" id="submitBtn" onclick="submit()">Send my logo</button>
    <p class="err" id="err" hidden></p>
  `}
  </div>
  <footer>ReviewTap &middot; reviewtap.co.za</footer>
</div>
<script>
var MAPS_KEY = '${esc(mapsKey)}'
var fileDataUrl = null
var selected = null
var mapsPromise = null
var placesMode = null
var placesSvc = null
var mapsBroken = false

// Google calls this global BY NAME on any key/auth failure —
// RefererNotAllowedMapError, billing off, Places API not enabled. It is the ONLY
// signal for that class of failure: the <script> tag itself returns 200 so
// onerror never fires, the loader callback still resolves, and then the legacy
// textSearch callback is simply NEVER INVOKED. Verified live on a
// non-allowlisted origin: without this hook the customer sits on a disabled
// "…" button forever, with no error and no way forward. That is the exact
// silent-failure shape this project has been bitten by before.
window.gm_authFailure = function () {
  mapsFailed('Google lookup is unavailable right now — please enter your business name below.')
}

// One place that gives up on Places and hands the customer the manual field.
// Always re-enables the button: a stuck spinner is worse than a typed answer.
function mapsFailed(msg) {
  mapsBroken = true
  var btn = document.getElementById('searchBtn')
  if (btn) { btn.disabled = false; btn.textContent = 'Search' }
  var hint = document.getElementById('searchHint')
  if (hint) hint.textContent = msg
  showManual()
}

// Belt and braces alongside gm_authFailure: covers a hung network, a blocked
// script in WhatsApp's in-app browser, or any future failure that leaves a
// promise pending rather than rejecting.
function withTimeout(p, ms) {
  return new Promise(function (resolve, reject) {
    var done = false
    var t = setTimeout(function () {
      if (!done) { done = true; reject(new Error('timeout')) }
    }, ms)
    p.then(
      function (v) { if (!done) { done = true; clearTimeout(t); resolve(v) } },
      function (e) { if (!done) { done = true; clearTimeout(t); reject(e) } }
    )
  })
}

var fileInput = document.getElementById('file')
if (fileInput) {
  fileInput.addEventListener('change', function () {
    var f = fileInput.files[0]
    if (!f) return
    var reader = new FileReader()
    reader.onload = function () {
      fileDataUrl = reader.result
      var drop = document.getElementById('drop')
      drop.classList.add('has-file')
      if (f.type.indexOf('image/') === 0) {
        document.getElementById('dropInner').innerHTML = '<img src="' + fileDataUrl + '"><div>' + f.name + '</div>'
      } else {
        document.getElementById('dropInner').textContent = f.name + ' — ready to send'
      }
    }
    reader.readAsDataURL(f)
  })
}

// Plain script-tag loader (see the note at the top of this file for why the
// official snippet is not used). Resolves once google.maps.places is usable.
function loadMaps() {
  if (mapsPromise) return mapsPromise
  mapsPromise = new Promise(function (resolve, reject) {
    if (window.google && window.google.maps && window.google.maps.places) return resolve()
    var s = document.createElement('script')
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + MAPS_KEY + '&libraries=places&v=weekly&callback=__mapsReady'
    s.async = true
    s.onerror = function () { reject(new Error('maps failed to load')) }
    window.__mapsReady = function () { resolve() }
    document.head.appendChild(s)
  })
  return mapsPromise
}

// Ported from the Fulfillment Console (reviewtap-fulfillment.html:561-587):
// try Places API (New) first, fall back to the legacy PlacesService. Which one
// the key has enabled is not something this page can know, so it tries both.
// Both branches normalise to the same shape.
function searchPlaces(q) {
  return loadMaps().then(function () {
    if (placesMode !== 'legacy') {
      return google.maps.importLibrary('places').then(function (lib) {
        return lib.Place.searchByText({
          textQuery: q,
          fields: ['id', 'displayName', 'formattedAddress', 'rating', 'userRatingCount'],
          maxResultCount: 4, region: 'ZA', language: 'en',
        }).then(function (out) {
          placesMode = 'new'
          return (out.places || []).map(function (p) {
            return {
              placeId: p.id,
              displayName: (typeof p.displayName === 'string' ? p.displayName : (p.displayName && p.displayName.text)) || '',
              formattedAddress: p.formattedAddress || '',
              rating: p.rating == null ? null : p.rating,
              count: p.userRatingCount == null ? null : p.userRatingCount,
            }
          })
        })
      }).catch(function (e) {
        placesMode = 'legacy'
        if (window.console) console.warn('Places API (New) unavailable — using legacy.', e && (e.message || e))
        return legacySearch(q)
      })
    }
    return legacySearch(q)
  })
}

function legacySearch(q) {
  if (!placesSvc) placesSvc = new google.maps.places.PlacesService(document.createElement('div'))
  return new Promise(function (resolve) {
    placesSvc.textSearch({ query: q, region: 'za' }, function (res, status) {
      if (status === google.maps.places.PlacesServiceStatus.OK && res) {
        resolve(res.slice(0, 4).map(function (p) {
          return {
            placeId: p.place_id, displayName: p.name || '',
            formattedAddress: p.formatted_address || '',
            rating: p.rating == null ? null : p.rating,
            count: p.user_ratings_total == null ? null : p.user_ratings_total,
          }
        }))
      } else resolve([])
    })
  })
}

function doSearch() {
  var q = document.getElementById('bizSearch').value.trim()
  var box = document.getElementById('results')
  var btn = document.getElementById('searchBtn')
  if (!q) return
  // Already known-broken (gm_authFailure fired, or a previous attempt timed out):
  // don't re-hang the button, just keep the manual field in front of them.
  if (mapsBroken) { showManual(); return }
  btn.disabled = true; btn.textContent = '…'
  box.style.display = 'none'; box.innerHTML = ''
  withTimeout(searchPlaces(q), 10000).then(function (list) {
    btn.disabled = false; btn.textContent = 'Search'
    if (!list.length) {
      box.style.display = 'block'
      box.innerHTML = '<p class="hint">No match on Google. Try adding your town, or enter it manually below.</p>'
      showManual()
      return
    }
    box.style.display = 'block'
    for (var i = 0; i < list.length; i++) box.appendChild(resultEl(list[i]))
  }).catch(function () {
    // Maps unreachable or timed out. NEVER block the customer: fall straight
    // back to the manual field. A submission with a typed name is worth far
    // more than a blocked customer who gives up.
    mapsFailed('Google lookup is unavailable right now — please enter your business name below.')
  })
}

function resultEl(p) {
  var el = document.createElement('div')
  el.className = 'res'
  var h = '<div class="rn">' + escapeHtml(p.displayName) + '</div>'
  if (p.formattedAddress) h += '<div class="ra">' + escapeHtml(p.formattedAddress) + '</div>'
  if (p.rating != null) h += '<div class="rr">' + p.rating + '★' + (p.count != null ? ' (' + p.count + ' reviews)' : '') + '</div>'
  el.innerHTML = h
  el.onclick = function () { pick(p) }
  return el
}

function pick(p) {
  // Same review-URL format the Fulfillment Console already encodes onto live
  // NFC chips (reviewtap-fulfillment.html:376). Derived from a picked listing,
  // never typed — which is the whole point of this picker.
  selected = {
    placeId: p.placeId,
    businessName: p.displayName,
    reviewUrl: 'https://search.google.com/local/writereview?placeid=' + p.placeId,
  }
  document.getElementById('results').style.display = 'none'
  document.getElementById('searchRow').style.display = 'none'
  document.getElementById('manualToggle').style.display = 'none'
  document.getElementById('manualWrap').style.display = 'none'
  document.getElementById('searchHint').style.display = 'none'
  var box = document.getElementById('picked')
  box.style.display = 'block'
  box.innerHTML = '<div class="pn">' + escapeHtml(p.displayName) + '</div>' +
    (p.formattedAddress ? '<div class="pa">' + escapeHtml(p.formattedAddress) + '</div>' : '') +
    '<div class="px">✓ Review link confirmed</div>'
  var again = document.createElement('button')
  again.className = 'linkish'
  again.type = 'button'
  again.textContent = 'Not this one? Search again'
  again.onclick = reset
  box.appendChild(again)
}

function reset() {
  selected = null
  document.getElementById('picked').style.display = 'none'
  document.getElementById('searchRow').style.display = 'flex'
  document.getElementById('manualToggle').style.display = 'inline'
  document.getElementById('searchHint').style.display = 'block'
}

function showManual() {
  document.getElementById('manualWrap').style.display = 'block'
  document.getElementById('manualToggle').style.display = 'none'
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}

var searchInput = document.getElementById('bizSearch')
if (searchInput) {
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doSearch() }
  })
}

async function submit() {
  var err = document.getElementById('err')
  err.hidden = true
  var manualVal = document.getElementById('nameOrLink').value.trim()
  if (!fileDataUrl) { err.textContent = 'Please choose a logo file first.'; err.hidden = false; return }
  if (!selected && !manualVal) {
    err.textContent = 'Please find your business on Google, or enter the name manually.'
    err.hidden = false
    showManual()
    return
  }
  var btn = document.getElementById('submitBtn')
  btn.disabled = true; btn.textContent = 'Sending…'
  // A picked listing wins over a typed one: it carries a verified review URL.
  var payload = selected
    ? { logo: fileDataUrl, businessName: selected.businessName, reviewUrl: selected.reviewUrl, placeId: selected.placeId }
    : { logo: fileDataUrl, nameOrLink: manualVal }
  try {
    var res = await fetch('${publicBase}/logo-request/${esc(order.request_token)}/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error()
    location.reload()
  } catch (e) {
    err.textContent = 'Something went wrong — please try again.'
    err.hidden = false
    btn.disabled = false; btn.textContent = 'Send my logo'
  }
}
</script>
</body></html>`
}
