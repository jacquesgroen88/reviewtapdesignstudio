// Shared product definitions (server-side) — matches frontend/src/lib/products.js
// Used for TIFF export dimensions

const MM_TO_PX = 11.811  // px per mm at 300 DPI
function mm(val) { return Math.round(val * MM_TO_PX) }

export const PRODUCTS = {
  stand: {
    id: 'stand',
    name: 'ReviewTap Stand',
    canvasWidth:  1417,
    canvasHeight: 1654,
    printWidth:   1417,
    printHeight:  1654,
    bleed:        0,
  },
  card: {
    id: 'card',
    name: 'ReviewTap Card',
    canvasWidth:  mm(91.6),
    canvasHeight: mm(60),
    printWidth:   mm(85.6),
    printHeight:  mm(54),
    bleed:        mm(3),
  },
}
