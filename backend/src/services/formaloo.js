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

  const form = new FormData()
  form.append('grant_type', 'client_credentials')

  const res = await axios.post(`${BASE}/oauth2/authorization-token/`, form, {
    headers: {
      'x-api-key':     APIKEY,
      'Authorization': `Basic ${SECRET}`,
    },
  })

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

export async function fetchOrders({ page = 1, pageSize = 50, onlyDesignNeeded = false } = {}) {
  const jwt = await getToken()
  const params = { page, page_size: pageSize, ordering: '-created_at' }

  const res = await axios.get(`${BASE}/forms/${FORM}/rows/`, { headers: headers(jwt), params })
  const rows = res.data?.data?.rows ?? []
  const count = res.data?.data?.count ?? 0

  const orders = rows.map(normaliseRow)

  if (onlyDesignNeeded) {
    return { orders: orders.filter(o => o.orderedStand || o.orderedCard), count }
  }

  return { orders, count }
}

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
