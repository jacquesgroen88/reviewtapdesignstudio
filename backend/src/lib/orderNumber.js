// Order numbers arrive inconsistently: Formaloo sometimes records a leading '#'
// ("#1812"), sometimes not ("1810"); Shopify's order.name always has one; manual
// entries are whatever was typed. Interpolating `(#${orderNumber})` on top of a
// value that already had one produced "King Chicken (##1812)" in the activity
// log and "##1820" on the card.
//
// Same family as the missing-logo false positives, where the two sides of a
// comparison stripped '#' differently. Normalise at every boundary.
//
// NOTE: frontend/src/lib/orderNumber.js is the deliberate twin of this file —
// separate bundles, no shared import path. Keep the two in step (same trap as
// the proxy-image allowlist, CLAUDE.md Gotcha #14).

export const bareOrderNumber = n =>
  String(n ?? '').trim().replace(/^#+/, '')

// Display form with exactly one '#'. Empty input gives '' (not a lone '#').
export function displayOrderNumber(n) {
  const bare = bareOrderNumber(n)
  return bare ? `#${bare}` : ''
}

// "Acme Coffee (#1812)" — the standard label for logs and messages. Falls back
// to the bare number, then to null, so a label is never just " (#1812)".
export function orderLabel(name, orderNumber) {
  const num = displayOrderNumber(orderNumber)
  if (name && num) return `${name} (${num})`
  return name || num || null
}
