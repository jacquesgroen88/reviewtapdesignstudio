// Product canvas definitions at 300 DPI
// 1mm = 11.811 px at 300 DPI

const MM_TO_PX = 11.811
function mm(val) { return Math.round(val * MM_TO_PX) }

// Each product has templateVariants (e.g. white/black). Each variant has
// one or more `faces` (Stand = 1 face; Card = front + back). A face carries
// its own pixel dimensions and template image(s).
export const PRODUCTS = {
  stand: {
    id: 'stand',
    name: 'ReviewTap Stand',
    description: 'Table stand',
    safeMargin: mm(5),
    defaultVariant: 'white',
    templateVariants: [
      {
        id: 'white', label: 'White Stand',
        faces: [
          { id: 'main', label: 'Stand', width: 1417, height: 1654,
            template: '/templates/stand_white.png',
            mockupTemplate: '/templates/stand_white_mockup.png' },
        ],
      },
      {
        id: 'black', label: 'Black Stand',
        faces: [
          { id: 'main', label: 'Stand', width: 1417, height: 1654,
            template: '/templates/stand_black.png' },
        ],
      },
    ],
  },

  card: {
    id: 'card',
    name: 'ReviewTap Card',
    description: 'Business card — front & back',
    safeMargin: mm(3),
    defaultVariant: 'white',
    templateVariants: [
      {
        id: 'white', label: 'White Card',
        faces: [
          { id: 'front', label: 'Front', width: 638, height: 1016, template: '/templates/card_white_front.png' },
          { id: 'back',  label: 'Back',  width: 638, height: 1016, template: '/templates/card_white_back.png' },
        ],
      },
      {
        id: 'black', label: 'Black Card',
        faces: [
          { id: 'front', label: 'Front', width: 638, height: 1016, template: '/templates/card_black_front.png' },
          { id: 'back',  label: 'Back',  width: 638, height: 1016, template: '/templates/card_black_back.png' },
        ],
      },
    ],
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
