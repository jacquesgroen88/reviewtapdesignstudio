// Shopify Admin API client (Dev Dashboard custom app "Design Studio Sync", read_orders only)
// Auth: client-credentials grant — POST /admin/oauth/access_token → 24h token, auto-refreshed.

import axios from 'axios'

const SHOP          = process.env.SHOPIFY_SHOP_DOMAIN   || 'aq6cc7-u1.myshopify.com'
const CLIENT_ID      = process.env.SHOPIFY_CLIENT_ID
const CLIENT_SECRET  = process.env.SHOPIFY_CLIENT_SECRET
const API_VERSION    = '2026-07'

// Logo-requiring products all have "Custom" in the title (Custom Branded Google
// Review Card/Stand, Custom Smart Business Card) — the only Shopify products this
// tool needs to design for.
const CUSTOM_TITLE_RE = /custom/i

let tokenCache = { value: null, expiresAt: 0 }

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET not set')

  const res = await axios.post(`https://${SHOP}/admin/oauth/access_token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  const token = res.data.access_token
  const expiresInMs = (res.data.expires_in || 86399) * 1000
  tokenCache = { value: token, expiresAt: Date.now() + expiresInMs - 60_000 }
  return token
}

async function gql(query, variables = {}) {
  const token = await getToken()
  const res = await axios.post(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
  )
  if (res.data.errors) throw new Error(JSON.stringify(res.data.errors))
  return res.data.data
}

const OPEN_ORDERS_QUERY = `
  query OpenOrders {
    orders(first: 250, query: "fulfillment_status:unfulfilled OR fulfillment_status:partial") {
      edges {
        node {
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          lineItems(first: 20) { edges { node { title quantity } } }
        }
      }
    }
  }
`

// Cache the bulk open-orders snapshot for a few minutes — this is read on every
// /api/orders list load, and Shopify data doesn't need to be second-fresh.
let ordersCache = { value: null, expiresAt: 0 }

export async function fetchOpenShopifyOrders({ force = false } = {}) {
  if (!force && ordersCache.value && Date.now() < ordersCache.expiresAt) return ordersCache.value

  const data = await gql(OPEN_ORDERS_QUERY)
  const byNumber = {}

  for (const { node } of data.orders.edges) {
    const orderNumber = node.name.replace(/^#/, '')
    const lineItems = node.lineItems.edges.map(e => e.node)
    const customLineItems = lineItems.filter(li => CUSTOM_TITLE_RE.test(li.title))
    byNumber[orderNumber] = {
      orderNumber,
      quantity: customLineItems.reduce((sum, li) => sum + li.quantity, 0),
      requiresLogo: customLineItems.length > 0,
      requiresStand: customLineItems.some(li => /stand/i.test(li.title)),
      requiresCard: customLineItems.some(li => /card/i.test(li.title)),
      financialStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus,
      shopifyCreatedAt: node.createdAt,
    }
  }

  ordersCache = { value: byNumber, expiresAt: Date.now() + 5 * 60 * 1000 }
  return byNumber
}
