// Parse a Shopify orders_export.csv in the browser, so importing customer
// details never uploads a file (and never hits a serverless body limit).
//
// Shopify's export is genuinely awkward: fields are quoted when they contain
// commas ("12 Augrabies Street, 45 bush willow"), quotes are doubled inside
// quoted fields, addresses can carry newlines, and there is ONE ROW PER LINE
// ITEM — so a two-item order appears twice with the customer columns filled only
// on the first row. Anything less than a real parser gets this wrong.

// RFC4180-style state machine. Handles quoted fields, embedded commas/newlines,
// doubled quotes, and both CRLF and LF endings.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  // A BOM survives Excel round-trips and would corrupt the first header name.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  while (i < text.length) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }   // escaped quote
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }

    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  // Trailing field/row (file may not end with a newline)
  if (field.length || row.length) { row.push(field); rows.push(row) }

  if (!rows.length) return []
  const headers = rows[0].map(h => h.trim())
  return rows.slice(1)
    .filter(r => r.some(v => String(v).trim() !== ''))   // drop blank lines
    .map(r => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ''])))
}

const first = (...vals) => vals.map(v => String(v ?? '').trim()).find(Boolean) || ''

// Shopify marks the artwork products with "Custom" in the title — same test
// services/shopify.js uses to decide an order needs a design.
const CUSTOM_TITLE_RE = /custom/i
const STAND_RE = /stand/i
const CARD_RE  = /card/i

// Group the per-line-item rows into one record per order, mapping only the
// columns the studio actually needs. Everything else in the export is ignored.
export function parseShopifyOrders(text) {
  const raw = parseCsv(text)
  if (!raw.length) return { orders: [], error: 'That file has no rows.' }
  if (!('Name' in raw[0]) || !('Lineitem name' in raw[0])) {
    return { orders: [], error: 'That does not look like a Shopify orders export (no "Name" / "Lineitem name" columns).' }
  }

  const byOrder = new Map()
  for (const r of raw) {
    const name = String(r['Name'] || '').trim()
    if (!name) continue
    if (!byOrder.has(name)) byOrder.set(name, [])
    byOrder.get(name).push(r)
  }

  const orders = []
  for (const [name, lines] of byOrder) {
    // Customer columns are only populated on an order's FIRST row, so read them
    // from whichever row actually carries them rather than assuming lines[0].
    const pick = (col) => first(...lines.map(l => l[col]))
    const titles = lines.map(l => String(l['Lineitem name'] || ''))

    orders.push({
      orderNumber: name.replace(/^#/, ''),
      companyName: first(pick('Shipping Company'), pick('Billing Company')),
      personName:  first(pick('Shipping Name'), pick('Billing Name')),
      whatsapp:    first(pick('Shipping Phone'), pick('Billing Phone'), pick('Phone')),
      email:       pick('Email'),
      needsLogo:   titles.some(t => CUSTOM_TITLE_RE.test(t)),
      orderedStand: titles.some(t => CUSTOM_TITLE_RE.test(t) && STAND_RE.test(t)),
      orderedCard:  titles.some(t => CUSTOM_TITLE_RE.test(t) && CARD_RE.test(t)),
      paid:        /paid/i.test(pick('Financial Status')),
      cancelled:   !!pick('Cancelled at'),
    })
  }

  return { orders, error: null }
}
