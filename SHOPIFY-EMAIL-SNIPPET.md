# Shopify order confirmation → /setup (spec step 7 — Jacques flips this by hand)

Shopify notification templates cannot be edited via the API, so this is a paste job:

**Shopify Admin → Settings → Notifications → Customer notifications → Order confirmation.**

1. Find the existing Formaloo block (search the template for `formaloo` — the link is
   `reviewtap.formaloo.me/6n4h9c`) and **replace it** with the block below.
2. Do NOT delete the Formaloo form itself — it stays reachable-but-unlinked as the
   rollback path (spec D4/D5). If /setup misbehaves, reverting is re-pasting the old link.
3. Send yourself a test order confirmation (Shopify has a "send test" on the template
   page) and click the button — it must land on a prefilled /setup page for that order.

```liquid
{% assign needs_setup = false %}
{% for line in subtotal_line_items %}
  {% if line.title contains 'Custom' %}{% assign needs_setup = true %}{% endif %}
{% endfor %}
{% if needs_setup %}
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:1px solid #f97316;border-radius:12px;background:#fff8f3">
  <tr><td style="padding:20px;text-align:center;font-family:-apple-system,'Segoe UI',Roboto,sans-serif">
    <p style="margin:0;font-size:16px;font-weight:700;color:#14202e">One quick step to get your design started</p>
    <p style="margin:8px 0 0;font-size:14px;color:#5b6b7c">Tell us which business each item is for and send us your logo &mdash; takes about 30 seconds.</p>
    <a href="https://link.reviewtap.co.za/setup/{{ order_number }}"
       style="display:inline-block;margin-top:14px;padding:12px 24px;background:#f97316;color:#ffffff;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none">
      Set up my order
    </a>
    <p style="margin:10px 0 0;font-size:12px;color:#8a97a5">Multiple locations or businesses? The same link handles that too.</p>
  </td></tr>
</table>
{% endif %}
```

Notes:
- `{{ order_number }}` renders the bare number (no `#`) — exactly what /setup expects.
- The `contains 'Custom'` guard matches how `services/shopify.js` classifies
  logo-requiring products (CUSTOM_TITLE_RE) — plain stand/card orders don't get the block.
- Once flipped, watch the first real orders arrive on the studio's Activity tab
  (`setup.submitted` events) — spec step 7 says verify against the very next real order.
