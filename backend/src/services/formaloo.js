// Formaloo API client with auto-refreshing JWT token
// Form: CGQse2u9  |  Workspace: cHQuChHR
// Auth: POST /v3.0/oauth2/authorization-token/ → JWT (30-day expiry)

import axios from 'axios'

const BASE   = 'https://api.formaloo.me/v3.0'
const FORM   = process.env.FORMALOO_FORM_SLUG      || 'CGQse2u9'
const WS     = process.env.FORMALOO_WORKSPACE      || 'cHQuChHR'
const APIKEY = process.env.FORMALOO_API_KEY
const SECRET = process.env.FORMALOO_API_SECRET

// Field slugs (from form inspection)
export const FIELDS = {
  orderNumber:     'eIfCw2E1',
  companyName:     'VYIddv0M',
  whatsapp:        'UNp7D885',
  googleReviewUrl: 'PcQWad3z',
  orderedStand:    'kRVUys9e',   // 'yes' | 'no'
  logoFile:        'POFSwcNm',   // array of { url }
  orderedCard:     '17grICul',   // 'yes' | 'no'
  profilePicture:  '2UOZ1mqV',
  landingPageText: 'BU0jpy6j',
  cardEmail:       'LejbQqTb',
  cardPhone:       'JnD7JINw',
  cardAddress:     'hgf7CcWL',
  landingLinks:    'bWu5V3Ns',
  socialLinks:     '8kRr02aT',
}

// Cached token
let tokenCache = { value: null, expiresAt: 0 }

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value

  if (!APIKEY || !SECRET) throw new Error('FORMALOO_API_KEY / FORMALOO_API_SECRET not set')

  const res = await axios.post(`${BASE}/oauth2/authorization-token/`,
    'grant_type=client_credentials',
    {
      headers: {
        'x-api-key':     APIKEY,
        'Authorization': `Basic ${SECRET}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
    }
  )

  const token = res.data.authorization_token
  // JWT expires in ~30 days; refresh 1 day early
  tokenCache = { value: token, expiresAt: Date.now() + 29 * 24 * 60 * 60 * 1000 }
  return token
}

function headers(jwt) {
  return {
    'x-api-key':     APIKEY,
    'Authorization': `JWT ${jwt}`,
    'x-workspace':   WS,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// ── Order rows: fetched whole, in parallel, and cached ────────────────────────
//
// Formaloo's API is slow and, measured against the live form, slow PER REQUEST
// rather than per row — so asking for everything at once is the worst option:
//
//     one 500-row page      8349ms
//     one 400-row page      8009ms
//     4 x 100 in parallel   3164ms
//     8 x  50 in parallel   2397ms   <- 3.5x faster for the same 382 rows
//
// So: pull page 1 (which also tells us the total), then fetch the remaining
// pages CONCURRENTLY and merge. The whole form is ~400 rows / ~150 KB, small
// enough to hold and serve every tab, filter, search and page from memory.
//
// Before this, nothing cached the rows (only the auth token), and the Orders
// route used two different shapes — 50-row pages for "All orders", one 500-row
// page for any filter — so browsing cost ~9s, switching to a filter cost ~9s
// AGAIN, and every debounced keystroke risked another. One cache, one shape.
//
// Caveat: this lives in the Netlify function container, so it only helps WARM
// containers — the case that matters (one person clicking around). A cold start
// still pays ~2.4s once. Eliminating that means syncing Formaloo into Supabase
// so filtering never touches their API; that's the real fix, not done here.
const PAGE = 50
const TTL  = 5 * 60 * 1000   // matches shopify.js's ordersCache; Refresh forces a live fetch

let cache = { orders: null, count: 0, expiresAt: 0 }

async function fetchPage(jwt, page) {
  const res = await axios.get(`${BASE}/forms/${FORM}/rows/`, {
    headers: headers(jwt),
    params: { page, page_size: PAGE, ordering: '-created_at' },
  })
  return { rows: res.data?.data?.rows ?? [], count: res.data?.data?.count ?? 0 }
}

// Every row on the form, newest first. Cached; `force` refetches.
export async function fetchAllOrders({ force = false } = {}) {
  if (!force && cache.orders && Date.now() < cache.expiresAt) return cache

  const jwt = await getToken()
  const first = await fetchPage(jwt, 1)
  const pages = Math.ceil(first.count / PAGE)

  // Pages 2..N concurrently. At ~400 rows that's 7 requests; it grows linearly
  // with the form, so if this ever gets big enough to bother Formaloo, that's
  // the signal to sync into Supabase rather than to quietly cap it here.
  const rest = pages > 1
    ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchPage(jwt, i + 2)))
    : []

  const rows = [...first.rows, ...rest.flatMap(r => r.rows)]
  // Never silently serve a partial list as if it were complete.
  if (rows.length < first.count) {
    console.warn(`formaloo: expected ${first.count} rows, got ${rows.length} — serving a PARTIAL list`)
  }

  cache = { orders: rows.map(normaliseRow), count: first.count, expiresAt: Date.now() + TTL }
  return cache
}

// Kept for callers that want one page's worth. Everything comes from the same
// cached full set, so paging is now an in-memory slice, not a network call.
export async function fetchOrders({ page = 1, pageSize = PAGE, onlyDesignNeeded = false, force = false } = {}) {
  const all = await fetchAllOrders({ force })
  const orders = onlyDesignNeeded
    ? all.orders.filter(o => o.orderedStand || o.orderedCard)
    : all.orders
  const start = (page - 1) * pageSize
  return { orders: orders.slice(start, start + pageSize), count: all.count }
}

// Drop cached rows so the next read hits Formaloo.
export function bustOrdersCache() { cache = { orders: null, count: 0, expiresAt: 0 } }

export async function fetchOrder(rowSlug) {
  const jwt = await getToken()
  const res = await axios.get(`${BASE}/rows/${rowSlug}/`, { headers: headers(jwt) })
  return normaliseRow(res.data?.data?.row ?? {})
}

function normaliseRow(row) {
  const data = row.data ?? {}
  const F = FIELDS

  const logoFiles = data[F.logoFile]
  const logoUrl = Array.isArray(logoFiles) ? logoFiles[0]?.url : (typeof logoFiles === 'string' ? logoFiles : null)

  return {
    rowSlug:         row.slug,
    submittedAt:     row.created_at,
    orderNumber:     data[F.orderNumber]     ?? '',
    companyName:     data[F.companyName]     ?? '',
    whatsapp:        data[F.whatsapp]        ?? '',
    googleReviewUrl: data[F.googleReviewUrl] ?? '',
    orderedStand:    data[F.orderedStand]    === 'yes',
    orderedCard:     data[F.orderedCard]     === 'yes',
    logoUrl,
    profilePictureUrl: typeof data[F.profilePicture] === 'string' ? data[F.profilePicture] : null,
    landingPageText: data[F.landingPageText] ?? '',
    cardEmail:       data[F.cardEmail]       ?? '',
    cardPhone:       data[F.cardPhone]       ?? '',
    cardAddress:     data[F.cardAddress]     ?? '',
    landingLinks:    data[F.landingLinks]    ?? '',
    socialLinks:     data[F.socialLinks]     ?? '',
  }
}
