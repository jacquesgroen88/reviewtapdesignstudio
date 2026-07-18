// Server-rendered public /setup/:orderNumber page (spec 2026-07-17 §4.2) —
// same pattern as approvalPage.js / logoRequestPage.js: plain HTML, zero SPA
// dependency, works in WhatsApp's in-app browser, immune to chunk rotation.
//
// NOTE ON THE CLIENT SCRIPT: string CONCATENATION only, never template
// literals — the whole page is itself inside a server-side template literal, so
// a stray backtick or ${...} in client code terminates it or interpolates at
// render time (same rule as logoRequestPage.js).
//
// The Places picker below is the DELIBERATE TWIN of the one in
// logoRequestPage.js, adapted to per-card instances. Same dual-mode search
// (Places New → legacy fallback), same gm_authFailure hook, same
// never-block-the-customer posture. A fix in one belongs in the other.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const DEFAULT_MAPS_KEY = 'AIzaSyCYUFTODezWI6KwvMjWzBet1Y_03QfRkec'

// What-they-bought summary line, e.g. "3 × stands · 2 × review cards".
function boughtLine(shopify) {
  if (!shopify) return ''
  const parts = []
  if (shopify.qtyStand) parts.push(`${shopify.qtyStand} × stand${shopify.qtyStand > 1 ? 's' : ''}`)
  if (shopify.qtyReviewCard) parts.push(`${shopify.qtyReviewCard} × review card${shopify.qtyReviewCard > 1 ? 's' : ''}`)
  if (shopify.qtySmartCard) parts.push(`${shopify.qtySmartCard} × smart business card${shopify.qtySmartCard > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

export function renderSetupPage(state, publicBase) {
  const mapsKey = process.env.GOOGLE_MAPS_BROWSER_KEY || DEFAULT_MAPS_KEY
  const title = `Set up your order #${esc(state.bare)} — ReviewTap`
  // Only what the page needs, JSON-inlined. `<` escaped so customer-supplied
  // strings (business names) can never close the script element.
  const clientState = JSON.stringify({
    bare: state.bare,
    shopify: state.shopify ? {
      qtyStand: state.shopify.qtyStand || 0,
      qtyReviewCard: state.shopify.qtyReviewCard || 0,
      qtySmartCard: state.shopify.qtySmartCard || 0,
      quantity: state.shopify.quantity || 0,
      requiresSmartCard: !!state.shopify.requiresSmartCard,
    } : null,
    destinations: state.destinations || [],
    companyPrefill: state.companyPrefill || '',
    whatsapp: state.whatsapp || '',
  }).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<meta property="og:title" content="Set up your ReviewTap order">
<meta property="og:description" content="Tell us which business each item is for — takes about 30 seconds.">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f6f7f9; color: #14202e; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 20px 16px 60px; }
  header { text-align: center; padding: 18px 0 6px; }
  header .logo { width: 40px; height: 40px; object-fit: contain; margin-bottom: 6px; }
  header .brand { font-weight: 800; font-size: 20px; letter-spacing: -0.3px; }
  header .brand span { color: #f97316; }
  header p { color: #5b6b7c; font-size: 14px; margin-top: 6px; }
  header .bought { display: inline-block; background: #fff; border: 1px solid #e4e9ee; border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600; margin-top: 10px; }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 1px 4px rgba(20,32,46,.08); padding: 20px; margin-top: 16px; position: relative; }
  .card h3 { font-size: 14px; color: #8a97a5; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 12px; }
  .field { margin-bottom: 14px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  input[type="text"], input[type="tel"] { width: 100%; border: 1px solid #d7dde4; border-radius: 10px; padding: 10px 12px; font: inherit; }
  input[type="number"] { width: 74px; border: 1px solid #d7dde4; border-radius: 10px; padding: 8px 10px; font: inherit; text-align: center; }
  .drop { border: 2px dashed #d7dde4; border-radius: 12px; padding: 18px; text-align: center; cursor: pointer; color: #5b6b7c; font-size: 14px; }
  .drop.has-file { border-color: #f97316; color: #14202e; }
  .drop img { max-width: 100%; max-height: 100px; border-radius: 8px; margin-bottom: 8px; }
  .btn { display: block; width: 100%; border: 0; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 16px; background: #f97316; color: #fff; }
  .btn[disabled] { opacity: .5; }
  .addbtn { display: block; width: 100%; border: 2px dashed #d7dde4; background: none; border-radius: 12px; padding: 12px; font: inherit; font-weight: 600; color: #5b6b7c; cursor: pointer; margin-top: 16px; }
  .addbtn:hover { border-color: #f97316; color: #f97316; }
  .done { text-align: center; padding: 30px 10px; }
  .done .tick { font-size: 40px; color: #16a34a; }
  .err { color: #dc2626; font-size: 13px; margin-top: 8px; }
  footer { text-align: center; color: #8a97a5; font-size: 12px; margin-top: 28px; }
  .searchrow { display: flex; gap: 8px; }
  .searchrow input { flex: 1; }
  .sbtn { border: 1px solid #d7dde4; background: #fff; border-radius: 10px; padding: 0 14px; font: inherit; font-weight: 600; cursor: pointer; color: #14202e; }
  .sbtn[disabled] { opacity: .5; }
  .results { margin-top: 10px; }
  .res { border: 1px solid #e4e9ee; border-radius: 10px; padding: 10px 12px; cursor: pointer; margin-bottom: 6px; }
  .res:hover { border-color: #f97316; background: #fff8f3; }
  .res .rn { font-weight: 600; font-size: 14px; }
  .res .ra { color: #5b6b7c; font-size: 12px; margin-top: 2px; }
  .res .rr { color: #8a97a5; font-size: 12px; margin-top: 2px; }
  .picked { border: 1px solid #16a34a; background: #f0fdf4; border-radius: 10px; padding: 10px 12px; }
  .picked .pn { font-weight: 700; font-size: 14px; }
  .picked .pa { color: #5b6b7c; font-size: 12px; margin-top: 2px; }
  .picked .px { color: #16a34a; font-size: 12px; margin-top: 6px; font-weight: 600; }
  .linkish { background: none; border: 0; padding: 0; margin-top: 8px; color: #5b6b7c; font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
  .hint { color: #8a97a5; font-size: 12px; margin-top: 6px; }
  .qtyrow { display: flex; gap: 16px; flex-wrap: wrap; }
  .qtyrow .q { text-align: center; }
  .qtyrow .q span { display: block; font-size: 12px; color: #5b6b7c; margin-bottom: 4px; }
  .same { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #14202e; cursor: pointer; }
  .same input { width: auto; }
  .remove { position: absolute; top: 14px; right: 16px; background: none; border: 0; color: #8a97a5; font-size: 12px; text-decoration: underline; cursor: pointer; }
  .alloc { text-align: center; font-size: 13px; color: #5b6b7c; margin-top: 12px; }
  .alloc.warn { color: #d97706; font-weight: 600; }
  .gotlogo { border: 1px solid #16a34a; background: #f0fdf4; border-radius: 10px; padding: 10px 12px; font-size: 13px; color: #16a34a; font-weight: 600; }
  .handoff { border: 1px solid #f97316; background: #fff8f3; border-radius: 12px; padding: 16px; margin-top: 18px; text-align: center; }
  .handoff a { display: inline-block; background: #f97316; color: #fff; border-radius: 10px; padding: 10px 18px; font-weight: 700; text-decoration: none; margin-top: 10px; }
</style>
</head><body>
<div class="wrap">
  <header>
    <img src="/reviewtap-icon.png" alt="ReviewTap" class="logo">
    <div class="brand">Review<span>Tap</span></div>
    <p>Thanks for your order! Tell us which business each item is for,<br>and send us your logo — about 30 seconds.</p>
    ${state.shopify ? `<div class="bought">Order #${esc(state.bare)} — ${esc(boughtLine(state.shopify))}</div>` : `<div class="bought">Order #${esc(state.bare)}</div>`}
  </header>

  <div id="cards"></div>
  <button class="addbtn" id="addBtn" type="button" onclick="addCard()">+ Add another business or location</button>
  <p class="alloc" id="alloc"></p>

  <div class="card" id="waCard">
    <div class="field" style="margin-bottom:0">
      <label for="whatsapp">Your WhatsApp number</label>
      <input type="tel" id="whatsapp" placeholder="e.g. 082 123 4567" autocomplete="tel">
      <p class="hint">We'll send your design here to approve before we print.</p>
    </div>
  </div>

  <button class="btn" id="submitBtn" onclick="submitAll()">Send it through</button>
  <p class="err" id="err" hidden></p>

  <div class="card" id="doneCard" style="display:none">
    <div class="done"><div class="tick">&#10003;</div>
      <p style="margin-top:10px;font-weight:600">All received — thank you!</p>
      <p style="color:#5b6b7c;font-size:13px;margin-top:6px">Our designer is on it. We'll WhatsApp you the design to approve shortly.</p>
      <p style="color:#8a97a5;font-size:12px;margin-top:10px">Need to add another location later? Just open this link again.</p>
    </div>
    <div class="handoff" id="handoff" style="display:none">
      <div style="font-weight:700">One more step for your Smart Business Card</div>
      <p class="hint" style="margin-top:6px">Your smart card also gets a digital profile page. Build yours now — it takes 2 minutes.</p>
      <a href="https://cards.reviewtap.co.za/new">Build your digital card</a>
    </div>
  </div>

  <footer>ReviewTap &middot; reviewtap.co.za</footer>
</div>
<script type="application/json" id="state">${clientState}</script>
<script>
var STATE = JSON.parse(document.getElementById('state').textContent)
var MAPS_KEY = '${esc(mapsKey)}'
var SUBMIT_BASE = '${publicBase}/setup/${esc(state.bare)}'
var mapsPromise = null
var placesMode = null
var placesSvc = null
var mapsBroken = false

// Qty types actually on this order (no Shopify match -> no qty UI at all).
var TYPES = []
if (STATE.shopify) {
  if (STATE.shopify.qtyStand) TYPES.push(['qtyStand', 'Stands'])
  if (STATE.shopify.qtyReviewCard) TYPES.push(['qtyReviewCard', 'Review cards'])
  if (STATE.shopify.qtySmartCard) TYPES.push(['qtySmartCard', 'Smart cards'])
}

// cards[i]: { id, businessName, placeId, reviewUrl, existingLogoUrl, locked,
//             fileDataUrl, sameLogo, qtyStand, qtyReviewCard, qtySmartCard }
var cards = []
if (STATE.destinations.length) {
  for (var di = 0; di < STATE.destinations.length; di++) {
    var d = STATE.destinations[di]
    cards.push({
      id: d.id, businessName: d.businessName || '', placeId: d.placeId || '',
      reviewUrl: d.googleReviewUrl || '', existingLogoUrl: d.logoUrl || null,
      locked: !!(d.businessName), fileDataUrl: null, sameLogo: false,
      qtyStand: d.qtyStand || 0, qtyReviewCard: d.qtyReviewCard || 0, qtySmartCard: d.qtySmartCard || 0,
    })
  }
} else {
  var first = { id: null, businessName: '', placeId: '', reviewUrl: '', existingLogoUrl: null,
    locked: false, fileDataUrl: null, sameLogo: false,
    qtyStand: 0, qtyReviewCard: 0, qtySmartCard: 0 }
  // Single-business default: everything they bought goes to the one card.
  if (STATE.shopify) {
    first.qtyStand = STATE.shopify.qtyStand
    first.qtyReviewCard = STATE.shopify.qtyReviewCard
    first.qtySmartCard = STATE.shopify.qtySmartCard
  }
  cards.push(first)
}

window.gm_authFailure = function () { mapsFailed() }
function mapsFailed() {
  mapsBroken = true
  var btns = document.querySelectorAll('.sbtn')
  for (var i = 0; i < btns.length; i++) { btns[i].disabled = false; btns[i].textContent = 'Search' }
  var hints = document.querySelectorAll('.searchhint')
  for (var j = 0; j < hints.length; j++) hints[j].textContent = 'Google lookup is unavailable right now — please type your business name below.'
  var manuals = document.querySelectorAll('.manualwrap')
  for (var k = 0; k < manuals.length; k++) manuals[k].style.display = 'block'
}

function withTimeout(p, ms) {
  return new Promise(function (resolve, reject) {
    var done = false
    var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')) } }, ms)
    p.then(
      function (v) { if (!done) { done = true; clearTimeout(t); resolve(v) } },
      function (e) { if (!done) { done = true; clearTimeout(t); reject(e) } }
    )
  })
}

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

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}

// ── card rendering ────────────────────────────────────────────────────────────

function renderCards() {
  var box = document.getElementById('cards')
  box.innerHTML = ''
  for (var i = 0; i < cards.length; i++) box.appendChild(cardEl(i))
  updateAlloc()
}

function cardEl(i) {
  var c = cards[i]
  var el = document.createElement('div')
  el.className = 'card'
  var h = '<h3>' + (cards.length > 1 ? 'Business ' + (i + 1) : 'Your business') + '</h3>'
  if (i > 0 || (c.id && !c.locked)) {
    if (!c.id) h = '<button class="remove" type="button" onclick="removeCard(' + i + ')">Remove</button>' + h
  }
  el.innerHTML = h

  // Business identity: picked box, or search row.
  var idBox = document.createElement('div')
  idBox.className = 'field'
  if (c.businessName && (c.locked || c.placeId || c.reviewUrl)) {
    idBox.innerHTML = '<div class="picked"><div class="pn">' + escapeHtml(c.businessName) + '</div>' +
      (c.reviewUrl ? '<div class="px">&#10003; Review link confirmed</div>' : '') + '</div>'
    if (!c.locked) {
      var again = document.createElement('button')
      again.className = 'linkish'; again.type = 'button'
      again.textContent = 'Not this one? Search again'
      again.onclick = (function (idx) { return function () {
        cards[idx].businessName = ''; cards[idx].placeId = ''; cards[idx].reviewUrl = ''; renderCards()
      } })(i)
      idBox.appendChild(again)
    }
  } else {
    idBox.innerHTML =
      '<label>Find this business on Google</label>' +
      '<div class="searchrow">' +
        '<input type="text" id="biz' + i + '" placeholder="e.g. Ourief Wedding Venue, Sasolburg" value="' + escapeHtml(c.businessName) + '" autocomplete="off">' +
        '<button class="sbtn" id="sbtn' + i + '" type="button" onclick="doSearchCard(' + i + ')">Search</button>' +
      '</div>' +
      '<div class="results" id="results' + i + '"></div>' +
      '<p class="hint searchhint">We use this to build the review link, so the QR code goes to the right place.</p>' +
      '<button class="linkish" type="button" onclick="showManualCard(' + i + ')">Can&#39;t find it? Enter it manually</button>' +
      '<div class="manualwrap" id="manual' + i + '" style="display:none;margin-top:10px">' +
        '<label>Business name (as it appears on Google) &mdash; or your Google review link</label>' +
        '<input type="text" id="manualIn' + i + '" placeholder="e.g. Ourief Wedding Venue, or https://g.page/r/...">' +
      '</div>'
  }
  el.appendChild(idBox)

  // Logo.
  var logoBox = document.createElement('div')
  logoBox.className = 'field'
  if (c.existingLogoUrl) {
    logoBox.innerHTML = '<label>Logo</label><div class="gotlogo">&#10003; Logo received</div>'
  } else {
    var inner = '<label>Logo</label>'
    if (i > 0) {
      inner += '<label class="same"><input type="checkbox" id="same' + i + '" ' + (c.sameLogo ? 'checked' : '') + ' onchange="toggleSame(' + i + ')"> Use the same logo as the first business</label>'
    }
    inner += '<div class="drop" id="drop' + i + '" style="' + (i > 0 && c.sameLogo ? 'display:none;' : '') + 'margin-top:8px" onclick="document.getElementById(\\'file' + i + '\\').click()">' +
      '<div id="dropInner' + i + '">' + (c.fileDataUrl ? 'Logo ready &#10003;' : 'Tap to choose a file (PNG, JPG, or PDF)') + '</div></div>' +
      '<input type="file" id="file' + i + '" accept="image/png,image/jpeg,image/webp,application/pdf" hidden>'
    logoBox.innerHTML = inner
  }
  el.appendChild(logoBox)

  // Quantities.
  if (TYPES.length) {
    var qBox = document.createElement('div')
    qBox.className = 'field'
    var qh = '<label>How many of each go to this business?</label><div class="qtyrow">'
    for (var t = 0; t < TYPES.length; t++) {
      var key = TYPES[t][0]
      qh += '<div class="q"><span>' + TYPES[t][1] + '</span><input type="number" min="0" max="999" id="' + key + '_' + i + '" value="' + (c[key] || 0) + '" onchange="qtyChanged(' + i + ',\\'' + key + '\\')"></div>'
    }
    qh += '</div>'
    qBox.innerHTML = qh
    el.appendChild(qBox)
  }

  return el
}

function afterRenderBind(i) {
  var f = document.getElementById('file' + i)
  if (f && !f.__bound) {
    f.__bound = true
    f.addEventListener('change', function () {
      var file = f.files[0]
      if (!file) return
      var reader = new FileReader()
      reader.onload = function () {
        cards[i].fileDataUrl = reader.result
        var drop = document.getElementById('drop' + i)
        if (drop) drop.classList.add('has-file')
        var inner = document.getElementById('dropInner' + i)
        if (inner) {
          if (file.type.indexOf('image/') === 0) inner.innerHTML = '<img src="' + reader.result + '"><div>' + escapeHtml(file.name) + '</div>'
          else inner.textContent = file.name + ' — ready to send'
        }
      }
      reader.readAsDataURL(file)
    })
  }
  var biz = document.getElementById('biz' + i)
  if (biz && !biz.__bound) {
    biz.__bound = true
    biz.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearchCard(i) } })
  }
}

// Rebind after every render (renderCards rebuilds the DOM).
var _origRender = renderCards
renderCards = function () {
  _origRender()
  for (var i = 0; i < cards.length; i++) afterRenderBind(i)
}

function addCard() {
  cards.push({ id: null, businessName: '', placeId: '', reviewUrl: '', existingLogoUrl: null,
    locked: false, fileDataUrl: null, sameLogo: true,
    qtyStand: 0, qtyReviewCard: 0, qtySmartCard: 0 })
  renderCards()
}

function removeCard(i) {
  cards.splice(i, 1)
  renderCards()
}

function toggleSame(i) {
  cards[i].sameLogo = document.getElementById('same' + i).checked
  var drop = document.getElementById('drop' + i)
  if (drop) drop.style.display = cards[i].sameLogo ? 'none' : 'block'
}

function qtyChanged(i, key) {
  var v = parseInt(document.getElementById(key + '_' + i).value, 10)
  cards[i][key] = isNaN(v) || v < 0 ? 0 : v
  updateAlloc()
}

// Live allocation hint — informative, NEVER a gate (D2: a customer stuck on
// arithmetic at 11pm just closes the tab).
function updateAlloc() {
  var el = document.getElementById('alloc')
  if (!STATE.shopify || !TYPES.length) { el.textContent = ''; return }
  var alloc = 0
  for (var i = 0; i < cards.length; i++) {
    alloc += (cards[i].qtyStand || 0) + (cards[i].qtyReviewCard || 0) + (cards[i].qtySmartCard || 0)
  }
  var ordered = STATE.shopify.quantity
  if (alloc === ordered) { el.className = 'alloc'; el.textContent = 'All ' + ordered + ' item' + (ordered === 1 ? '' : 's') + ' allocated ✓' }
  else { el.className = 'alloc warn'; el.textContent = alloc + ' of ' + ordered + ' items allocated — you can still send it, we’ll sort out the rest with you' }
}

function doSearchCard(i) {
  var input = document.getElementById('biz' + i)
  var box = document.getElementById('results' + i)
  var btn = document.getElementById('sbtn' + i)
  var q = input ? input.value.trim() : ''
  if (!q) return
  if (mapsBroken) { showManualCard(i); return }
  btn.disabled = true; btn.textContent = '…'
  box.innerHTML = ''
  withTimeout(searchPlaces(q), 10000).then(function (list) {
    btn.disabled = false; btn.textContent = 'Search'
    if (!list.length) {
      box.innerHTML = '<p class="hint">No match on Google. Try adding your town, or enter it manually below.</p>'
      showManualCard(i)
      return
    }
    for (var r = 0; r < list.length; r++) box.appendChild(resultEl(i, list[r]))
  }).catch(function () { mapsFailed() })
}

function resultEl(i, p) {
  var el = document.createElement('div')
  el.className = 'res'
  var h = '<div class="rn">' + escapeHtml(p.displayName) + '</div>'
  if (p.formattedAddress) h += '<div class="ra">' + escapeHtml(p.formattedAddress) + '</div>'
  if (p.rating != null) h += '<div class="rr">' + p.rating + '★' + (p.count != null ? ' (' + p.count + ' reviews)' : '') + '</div>'
  el.innerHTML = h
  el.onclick = function () {
    cards[i].businessName = p.displayName
    cards[i].placeId = p.placeId
    cards[i].reviewUrl = 'https://search.google.com/local/writereview?placeid=' + p.placeId
    renderCards()
  }
  return el
}

function showManualCard(i) {
  var m = document.getElementById('manual' + i)
  if (m) m.style.display = 'block'
}

// ── submit: phase 1 metadata, phase 2 one logo per POST ──────────────────────

function collectCards() {
  var out = []
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i]
    var name = c.businessName
    var reviewUrl = c.reviewUrl
    if (!name) {
      var manualIn = document.getElementById('manualIn' + i)
      var typed = manualIn ? manualIn.value.trim() : ''
      if (/^https?:\\/\\//i.test(typed)) reviewUrl = typed
      else name = typed
    }
    out.push({
      id: c.id, businessName: name, placeId: c.placeId, googleReviewUrl: reviewUrl,
      qtyStand: c.qtyStand || 0, qtyReviewCard: c.qtyReviewCard || 0, qtySmartCard: c.qtySmartCard || 0,
    })
  }
  return out
}

function fail(msg) {
  var err = document.getElementById('err')
  err.textContent = msg
  err.hidden = false
  var btn = document.getElementById('submitBtn')
  btn.disabled = false; btn.textContent = 'Send it through'
}

async function submitAll() {
  var err = document.getElementById('err')
  err.hidden = true
  var payloadCards = collectCards()

  for (var i = 0; i < payloadCards.length; i++) {
    if (!payloadCards[i].businessName && !payloadCards[i].googleReviewUrl) {
      return fail('Business ' + (i + 1) + ' still needs a name — search for it or type it in.')
    }
  }
  if (!cards[0].existingLogoUrl && !cards[0].fileDataUrl) {
    return fail('Please add the logo for ' + (payloadCards[0].businessName || 'your business') + '.')
  }
  for (var j = 1; j < cards.length; j++) {
    if (!cards[j].existingLogoUrl && !cards[j].fileDataUrl && !cards[j].sameLogo) {
      return fail('Business ' + (j + 1) + ' needs a logo — upload one or tick "use the same logo".')
    }
  }

  var btn = document.getElementById('submitBtn')
  btn.disabled = true; btn.textContent = 'Sending…'

  var result
  try {
    var res = await fetch(SUBMIT_BASE + '/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        whatsapp: document.getElementById('whatsapp').value.trim(),
        destinations: payloadCards,
      }),
    })
    if (!res.ok) throw new Error()
    result = await res.json()
  } catch (e) {
    return fail('Something went wrong — please try again.')
  }

  // Phase 2: logos. Server returns destinations in the order we posted them.
  var dests = result.destinations || []
  var firstId = dests[0] ? dests[0].id : null
  for (var k = 0; k < cards.length; k++) {
    var destId = dests[k] ? dests[k].id : null
    if (!destId) continue
    var body = null
    if (cards[k].fileDataUrl && !cards[k].existingLogoUrl) body = { destId: destId, logo: cards[k].fileDataUrl }
    else if (k > 0 && cards[k].sameLogo && !cards[k].existingLogoUrl) body = { destId: destId, copyFromDestId: firstId }
    if (!body) continue
    btn.textContent = 'Uploading logo ' + (k + 1) + ' of ' + cards.length + '…'
    try {
      var lres = await fetch(SUBMIT_BASE + '/logo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!lres.ok) throw new Error()
    } catch (e) {
      return fail('Your details were saved, but a logo upload failed — please try again; already-uploaded logos are kept.')
    }
  }

  // Done.
  document.getElementById('cards').style.display = 'none'
  document.getElementById('addBtn').style.display = 'none'
  document.getElementById('alloc').style.display = 'none'
  document.getElementById('waCard').style.display = 'none'
  btn.style.display = 'none'
  document.getElementById('doneCard').style.display = 'block'
  if (result.smartCardHandoff) document.getElementById('handoff').style.display = 'block'
  window.scrollTo(0, 0)
}

// Boot.
document.getElementById('whatsapp').value = STATE.whatsapp || ''
if (!STATE.destinations.length && STATE.companyPrefill) cards[0].businessName = ''
renderCards()
if (!STATE.destinations.length && STATE.companyPrefill) {
  var bootBiz = document.getElementById('biz0')
  if (bootBiz) bootBiz.value = STATE.companyPrefill
}
</script>
</body></html>`
}

export function renderSetupNotFound() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Order not found — ReviewTap</title></head>
<body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#14202e">
<h2>We couldn't find that order</h2>
<p style="color:#5b6b7c;max-width:400px;margin:10px auto">Double-check the link in your order confirmation email, or WhatsApp us and we'll sort it out.</p>
</body></html>`
}
