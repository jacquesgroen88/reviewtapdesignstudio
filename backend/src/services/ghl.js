// Reviewtap System (GHL) integration for approval sends.
// GATED: only active when GHL_PIT_KEY + GHL_LOCATION_ID + GHL_APPROVAL_TEMPLATE_ID
// are all set. Until the WhatsApp template is approved by Meta, the wa.me
// tap-to-send flow is the primary channel and this module reports unconfigured.
// NOTE: the template-send payload needs one live verification once the
// template exists — schema confirmed against docs, not yet against the wire.
import axios from 'axios'

const BASE = 'https://services.leadconnectorhq.com'

export function ghlConfigured() {
  return !!(process.env.GHL_PIT_KEY && process.env.GHL_LOCATION_ID && process.env.GHL_APPROVAL_TEMPLATE_ID)
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_PIT_KEY}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    // GHL's WAF 403s some default UAs — always set one explicitly
    'User-Agent': 'reviewtap-studio/1.0',
  }
}

// SA numbers: "082..." → "+2782...", "27..." → "+27...", keep "+..." as-is
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '')
  if (!digits) return null
  if (digits.startsWith('27')) return `+${digits}`
  if (digits.startsWith('0'))  return `+27${digits.slice(1)}`
  return `+${digits}`
}

// Find-or-create by phone (Jacques-approved default: auto-create contacts)
export async function upsertContact({ name, phone }) {
  const res = await axios.post(`${BASE}/contacts/upsert`, {
    locationId: process.env.GHL_LOCATION_ID,
    phone: normalizePhone(phone),
    name: name || undefined,
  }, { headers: headers(), timeout: 15000 })
  return res.data?.contact ?? res.data
}

// Business-initiated WhatsApp = template message (Meta rule).
// Variables: {{1}} client name, {{2}} order number, {{3}} approval link.
export async function sendApprovalTemplate({ contactId, clientName, orderNumber, url }) {
  const res = await axios.post(`${BASE}/conversations/messages`, {
    type: 'WhatsApp',
    contactId,
    templateId: process.env.GHL_APPROVAL_TEMPLATE_ID,
    templateParams: [clientName || 'there', orderNumber || 'your order', url],
  }, { headers: headers(), timeout: 15000 })
  return res.data
}
