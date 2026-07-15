// Reviewtap System (GHL) integration for WhatsApp sends.
//
// HOW IT WORKS (reworked 2026-07-11): GHL's public API does not expose Meta
// WhatsApp business templates (only SMS/email templates), so the studio never
// sends a template directly. Instead it (1) upserts the contact with the link
// written into a custom field, then (2) adds the contact to a GHL WORKFLOW
// whose only action is "Send WhatsApp template" — the template's variables
// resolve from the contact fields GHL-side. This is the documented pattern,
// and it keeps the message editable by Jacques inside GHL without code changes.
//
// Custom fields (created 2026-07-11 in the RT sub-account):
//   rt_studio_link  — approval page URL   (approval template)
//   rt_logo_upload  — logo-request URL    (logo_request template)
//
// GATED per flow: approvals need GHL_PIT_KEY + GHL_LOCATION_ID +
// GHL_APPROVAL_WORKFLOW_ID; logo requests swap in GHL_LOGO_WORKFLOW_ID.
// Until configured, the manual wa.me + copy-link flows are the only channel —
// and they STAY available regardless (Jacques wants the manual path kept).
import axios from 'axios'

const BASE = 'https://services.leadconnectorhq.com'

export function ghlConfigured() {
  return !!(process.env.GHL_PIT_KEY && process.env.GHL_LOCATION_ID && process.env.GHL_APPROVAL_WORKFLOW_ID)
}

export function ghlLogoConfigured() {
  return !!(process.env.GHL_PIT_KEY && process.env.GHL_LOCATION_ID && process.env.GHL_LOGO_WORKFLOW_ID)
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

// Find-or-create by phone, writing the link into the given custom field so
// the WhatsApp template can resolve it (Jacques-approved default: auto-create).
// firstName is set so the templates' {{contact.first_name}} greeting resolves.
export async function upsertContact({ name, firstName, phone, customFields }) {
  const res = await axios.post(`${BASE}/contacts/upsert`, {
    locationId: process.env.GHL_LOCATION_ID,
    phone: normalizePhone(phone),
    name: name || undefined,
    firstName: firstName || undefined,
    ...(customFields ? { customFields } : {}),
  }, { headers: headers(), timeout: 15000 })
  return res.data?.contact ?? res.data
}

// Build the customFields payload for a template send: the link field plus
// order_number (both templates greet with #{{contact.order_number}}). Verified
// against the wire that GHL accepts { key, field_value } with the bare fieldKey.
function templateFields(linkKey, url, orderNumber) {
  const fields = [{ key: linkKey, field_value: url }]
  if (orderNumber != null && String(orderNumber).trim()) {
    fields.push({ key: 'order_number', field_value: String(orderNumber).trim() })
  }
  return fields
}
const firstNameOf = (s) => (String(s || '').trim().split(/\s+/)[0] || undefined)

export async function addToWorkflow(contactId, workflowId) {
  const res = await axios.post(`${BASE}/contacts/${contactId}/workflow/${workflowId}`, {}, { headers: headers(), timeout: 15000 })
  return res.data
}

// Approval: write the approval URL to rt_studio_link, enroll in the approval
// workflow (which sends the design_approval WhatsApp template).
export async function sendApprovalViaGhl({ clientName, phone, url, orderNumber }) {
  const contact = await upsertContact({
    name: clientName, firstName: firstNameOf(clientName), phone,
    customFields: templateFields('rt_studio_link', url, orderNumber),
  })
  await addToWorkflow(contact.id, process.env.GHL_APPROVAL_WORKFLOW_ID)
  return contact
}

// Logo request: write the upload URL to rt_logo_upload, enroll in the
// logo-request workflow (which sends the logo_request WhatsApp template).
export async function sendLogoRequestViaGhl({ clientName, phone, url, orderNumber }) {
  const contact = await upsertContact({
    name: clientName, firstName: firstNameOf(clientName), phone,
    customFields: templateFields('rt_logo_upload', url, orderNumber),
  })
  await addToWorkflow(contact.id, process.env.GHL_LOGO_WORKFLOW_ID)
  return contact
}
