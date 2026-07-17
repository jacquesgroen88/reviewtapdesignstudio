// Order numbers arrive inconsistently: Formaloo sometimes records a leading '#'
// ("#1812"), sometimes not ("1810"); Shopify's order.name always has one;
// manual entries are whatever was typed. Rendering `#{orderNumber}` on top of a
// value that already had one is what produced "##1820" on the card and
// "King Chicken (##1812)" in the activity log.
//
// This is the same class of bug as the missing-logo false positives, where the
// two sides of a comparison stripped '#' differently. One helper, used
// everywhere a number is shown, so there is only one place to be wrong.
//
// Bare value, no '#': for matching, storage, or building your own label.
export const bareOrderNumber = n =>
  String(n ?? '').trim().replace(/^#+/, '')

// Display form, exactly one '#'. Empty input gives '' (not a lone '#').
export function displayOrderNumber(n) {
  const bare = bareOrderNumber(n)
  return bare ? `#${bare}` : ''
}
