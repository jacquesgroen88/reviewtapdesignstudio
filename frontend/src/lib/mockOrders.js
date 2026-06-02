// V1 mock order lookup — replace with real Shopify/backend lookup in production
export const MOCK_ORDERS = {
  'RT-1001': {
    orderNumber: 'RT-1001',
    products: ['stand', 'card'],
  },
  'RT-1002': {
    orderNumber: 'RT-1002',
    products: ['card'],
  },
  'RT-1003': {
    orderNumber: 'RT-1003',
    products: ['stand'],
  },
  'TEST': {
    orderNumber: 'TEST',
    products: ['stand', 'card'],
  },
}

export function lookupOrder(orderNumber) {
  const key = orderNumber.trim().toUpperCase()
  return MOCK_ORDERS[key] ?? null
}
