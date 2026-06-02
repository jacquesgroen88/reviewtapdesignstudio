// Product canvas definitions at 300 DPI
// 1mm = 11.811 px at 300 DPI

const MM_TO_PX = 11.811
function mm(val) { return Math.round(val * MM_TO_PX) }

export const PRODUCTS = {
  stand: {
    id: 'stand',
    name: 'ReviewTap Stand',
    // Both templates are 1417×1654 px = 120×140mm at 300 DPI
    canvasWidth:  1417,
    canvasHeight: 1654,
    printWidth:   1417,
    printHeight:  1654,
    bleed:        0,
    safeMargin:   mm(5),
    description:  'Table stand',
    // Multiple template variants — user picks one before designing
    templateVariants: [
      { id: 'white', label: 'White Stand', template: '/templates/stand_white.png' },
      { id: 'black', label: 'Black Stand', template: '/templates/stand_black.png' },
    ],
    defaultVariant: 'white',
    // No snap zones — internal tool, designers know placement
    snapZones: [],
  },

  card: {
    id: 'card',
    name: 'ReviewTap Card',
    // CR80 standard: 85.6×54mm
    canvasWidth:  mm(85.6 + 6),
    canvasHeight: mm(54 + 6),
    printWidth:   mm(85.6),
    printHeight:  mm(54),
    bleed:        mm(3),
    safeMargin:   mm(3),
    description:  'Standard credit-card size (CR80)',
    templateVariants: [
      { id: 'default', label: 'Standard Card', template: '/templates/card_template.svg' },
    ],
    defaultVariant: 'default',
    snapZones: [],
  },
}

export function getProduct(id) {
  return PRODUCTS[id] ?? null
}

export function getAllProducts() {
  return Object.values(PRODUCTS)
}

// Display scale: canvas shown on-screen at this fraction of full print size
export const DISPLAY_SCALE = 0.28
