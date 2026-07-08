// Scheduled daily: nudge clients who haven't answered an approval sent >48h
// ago (max one reminder per link). No-ops until the Reviewtap System (GHL)
// WhatsApp template is configured — the wa.me flow has no automated channel.
import { listChaseCandidates, markReminded } from '../../backend/src/services/approvals.js'
import { ghlConfigured, upsertContact, sendApprovalTemplate } from '../../backend/src/services/ghl.js'

export const config = { schedule: '@daily' }

export async function handler() {
  if (!ghlConfigured()) {
    console.log('approval-chase: GHL not configured, skipping')
    return { statusCode: 200, body: 'skipped' }
  }
  try {
    const due = await listChaseCandidates()
    let sent = 0
    for (const a of due) {
      if (!a.whatsapp) continue
      try {
        const contact = await upsertContact({ name: a.client_name, phone: a.whatsapp })
        await sendApprovalTemplate({
          contactId: contact.id,
          clientName: a.client_name,
          orderNumber: a.order_number,
          url: `${process.env.PUBLIC_URL || 'https://link.reviewtap.co.za'}/approve/${a.token}`,
        })
        await markReminded(a.token)
        sent++
      } catch (err) {
        console.error(`approval-chase: reminder failed for ${a.token}:`, err.message)
      }
    }
    console.log(`approval-chase: ${sent}/${due.length} reminders sent`)
    return { statusCode: 200, body: `sent ${sent}` }
  } catch (err) {
    console.error('approval-chase failed:', err.message)
    return { statusCode: 200, body: 'error' }
  }
}
