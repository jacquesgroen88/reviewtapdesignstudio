// Server-rendered client approval page — plain HTML, zero SPA dependency.
// Same pattern as redirect.js: standalone, fast, immune to chunk rotation,
// works in WhatsApp's in-app browser, carries OG tags for the link preview.
import { mockupPublicUrl } from './approvals.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function renderApprovalPage(approval, publicBase) {
  const superseded = !!approval.superseded_at
  const items = approval.items || []
  const allDone = items.every(i => i.response)
  const firstMockup = items[0]?.mockups?.[0] ? mockupPublicUrl(items[0].mockups[0]) : ''
  const title = `Design approval — ${esc(approval.client_name || 'ReviewTap')}`

  const itemBlocks = items.map((item, idx) => {
    const label = items.length > 1 ? `${idx + 1}. ${esc(item.name)}` : esc(item.name)
    const imgs = (item.mockups || []).map(p =>
      `<img src="${esc(mockupPublicUrl(p))}" alt="${esc(item.name)}" loading="lazy">`).join('')
    let action
    if (item.response === 'approved') {
      action = `<p class="done ok">&#10003; Approved${item.responded_at ? ' · ' + new Date(item.responded_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : ''}</p>`
    } else if (item.response === 'changes') {
      action = `<p class="done changes">Changes requested${item.comment ? ': &ldquo;' + esc(item.comment) + '&rdquo;' : ''}<br><span>Our designer is on it &mdash; you'll get an updated link.</span></p>`
    } else if (superseded) {
      action = `<p class="done changes">This link has been replaced by a newer version &mdash; please use the latest link we sent you.</p>`
    } else {
      action = `
      <div class="actions" data-design="${esc(item.design_id)}">
        <button class="btn approve" onclick="respond(this,'approved')">&#10003;&nbsp; Approve this design</button>
        <button class="btn changes" onclick="toggleComment(this)">Request changes</button>
        <div class="commentbox" hidden>
          <textarea placeholder="Tell us what to change&hellip;" rows="3"></textarea>
          <button class="btn send" onclick="respond(this,'changes')">Send change request</button>
        </div>
      </div>`
    }
    return `<section class="design"><h2>${label}</h2>${imgs}${action}</section>`
  }).join('')

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<meta property="og:title" content="Your ReviewTap design is ready">
<meta property="og:description" content="Tap to view and approve your design${items.length > 1 ? 's' : ''}.">
${firstMockup ? `<meta property="og:image" content="${esc(firstMockup)}">` : ''}
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f6f7f9; color: #14202e; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 20px 16px 60px; }
  header { text-align: center; padding: 18px 0 6px; }
  header .brand { font-weight: 800; font-size: 20px; letter-spacing: -0.3px; }
  header .brand span { color: #f97316; }
  header p { color: #5b6b7c; font-size: 14px; margin-top: 6px; }
  .banner { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 12px; padding: 10px 14px; font-size: 13px; margin: 12px 0; text-align: center; }
  .design { background: #fff; border-radius: 16px; box-shadow: 0 1px 4px rgba(20,32,46,.08); padding: 18px; margin-top: 16px; }
  .design h2 { font-size: 15px; margin-bottom: 12px; }
  .design img { width: 100%; border-radius: 12px; background: #eef0f3; margin-bottom: 10px; }
  .btn { display: block; width: 100%; border: 0; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 8px; }
  .btn.approve { background: #16a34a; color: #fff; }
  .btn.changes { background: #eef0f3; color: #14202e; }
  .btn.send { background: #f97316; color: #fff; }
  .btn[disabled] { opacity: .5; }
  .commentbox textarea { width: 100%; border: 1px solid #d7dde4; border-radius: 12px; padding: 10px; font: inherit; margin-top: 8px; }
  .done { border-radius: 12px; padding: 12px 14px; font-weight: 600; font-size: 14px; }
  .done.ok { background: #f0fdf4; color: #15803d; }
  .done.changes { background: #fff7ed; color: #9a3412; }
  .done.changes span { font-weight: 400; font-size: 13px; }
  footer { text-align: center; color: #8a97a5; font-size: 12px; margin-top: 28px; }
</style>
</head><body>
<div class="wrap">
  <header>
    <div class="brand">Review<span>Tap</span></div>
    <p>Hi ${esc(approval.client_name || 'there')}${approval.order_number ? ` &mdash; order #${esc(approval.order_number)}` : ''}!<br>
    ${allDone ? 'Thanks — we have your answer for every design.' : `Please review your design${items.length > 1 ? 's' : ''} below.`}</p>
  </header>
  ${superseded ? '<div class="banner">A newer version of this design exists &mdash; use the latest link we sent you.</div>' : ''}
  ${itemBlocks}
  <footer>ReviewTap &middot; reviewtap.co.za</footer>
</div>
<script>
function toggleComment(btn) {
  const box = btn.parentElement.querySelector('.commentbox')
  box.hidden = !box.hidden
}
async function respond(btn, response) {
  const wrap = btn.closest('.actions')
  const designId = wrap.dataset.design
  const comment = response === 'changes' ? (wrap.querySelector('textarea')?.value || '').trim() : ''
  if (response === 'changes' && !comment) { alert('Please tell us what to change first.'); return }
  wrap.querySelectorAll('button').forEach(b => b.disabled = true)
  try {
    const res = await fetch('${publicBase}/approve/${esc(approval.token)}/respond', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designId, response, comment }),
    })
    if (!res.ok) throw new Error()
    location.reload()
  } catch {
    alert('Something went wrong — please try again.')
    wrap.querySelectorAll('button').forEach(b => b.disabled = false)
  }
}
</script>
</body></html>`
}
