# Logo-request send friction — Spec

**Date**: 2026-07-20
**Status**: DRAFT, awaiting Jacques's decisions (§7). No code written.
**Goal**: sending a logo request should be one click in the Studio. Today it is a copy-link, a hand-built GHL contact, and three hand-filled template fields.

---

## 1. What Jacques asked

> "The Design Studio only gives me the link. So I have to then go to GHL and create a new contact which it just asks for number, email, name. But then the template wants the order number and a few other custom things that I will have to go manually add. Can't we update the template to just say like, 'Thanks for your order. we still need your logo. you can send it here' something more generic to speed things up?"

The template change is a good idea and §4 specs it. But the reason he is in GHL at all is a different problem, and fixing that removes the manual send entirely rather than making it cheaper. Both are in scope; the ordering matters.

---

## 2. What actually happened (live evidence, not theory)

Diane hit this **this morning at 09:44** on order **#1837**. The activity log caught the whole thing:

```
09:44:11  logoRequest.link_created   Order #1837
09:44:21  logoRequest.shared         channel: copy
09:44:33  logoRequest.link_created   Order #1837     <- did it again
09:44:46  logoRequest.shared         channel: copy   <- copied again
```

Two link creations, two copies, inside 35 seconds. That is someone going back and forth because the thing they expected was not there.

The row behind it (`manual_Jj54gheeinl0`):

| field | value |
|---|---|
| `company_name` | `Order #1837` ← placeholder, not a real name |
| `whatsapp` | **empty** |
| `order_number` | 1837 |

**That empty `whatsapp` is the whole cause.** `routes/logoRequests.js` returns
`ghlAvailable: ghlLogoConfigured() && !!updated.whatsapp`. No number → no auto-send button → the modal can only offer copy-link. Everything downstream (the hand-built GHL contact, the hand-filled fields) follows from that one missing field.

Contrast, same system, working: Diane sent an approval via GHL at 10:02 today (`approval.sent`, `via: ghl`) on an order that *had* a number. The GHL path is healthy. It is the **data** that is missing, not the integration.

### Why the number is missing
Orders created from the **missing-logo banner** are Shopify orders that never came through Formaloo. The app cannot read Shopify customer PII: `services/shopify.js`'s `OPEN_ORDERS_QUERY` requests no customer fields at all, because the Dev-Dashboard custom app has `read_orders` only and cannot request protected customer data (known Shopify platform limitation, recorded 2026-07-09). So the banner creates the order with a placeholder name and no contact details — by design, not by bug.

**Scale:** 2 of 19 manual orders are in this state. Small, but they are exactly the orders that need chasing, so they consume disproportionate time.

---

## 3. A bug this would have caused anyway

If auto-send *had* been available on #1837, the client would have received:

> **"Hi Order,** thanks for your ReviewTap order…"

`firstNameOf()` in `services/ghl.js` takes the first word of the company name. For placeholder orders that word is literally `Order`. So the current template's `{{contact.first_name}}` is a live embarrassment waiting for the first banner order that happens to have a phone number.

Jacques's instinct to drop the personalised greeting is right, and this is the reason: **we do not reliably know the customer's name on exactly the orders we most need to chase.** A generic greeting is not a downgrade here, it is a correctness fix.

---

## 4. The template change (Jacques's ask)

### 4.1 What the template needs today
| Variable | Source | Needed? |
|---|---|---|
| `{{contact.first_name}}` | company name's first word | **No** — often wrong (§3) |
| `#{{contact.order_number}}` | `order_number` custom field | Nice to have |
| `{{contact.rt_logo_upload}}` | `rt_logo_upload` custom field | **Yes** — it is the link |

Three fields to hand-fill. That is the friction.

### 4.2 What changed underneath: the link is now derivable
Since the `/setup` work (commits `d2593c7`, `addd0e4`), `chaseUrl()` returns
`link.reviewtap.co.za/setup/<orderNumber>` for any order with a number — **tokenless**. `getSetupState()` resolves the number against Shopify, `manual_orders` and Formaloo, and works even when no manual row exists yet.

Consequence worth stating plainly: **for any order with a number, the chase link is just `link.reviewtap.co.za/setup/<number>`.** It can be typed from the order number alone. No app round-trip, no token, no custom field.

Only walk-ins with **no** order number still need the token URL (`/logo-request/<token>`), because `/setup` has nothing to resolve them by.

### 4.3 Three template shapes

**Option A — one variable (recommended)**
> Hi! Thanks for your ReviewTap order. We still need your logo to start your design. Upload it here: link.reviewtap.co.za/setup/{{1}}
>
> `{{1}}` = `order_number`

- Manual send in GHL: **one field**, down from three.
- Customer gets a direct link, lands on their prefilled order. No extra step.
- Auto-send keeps working unchanged.
- Fails for no-order-number walk-ins → see §4.4.

**Option B — zero variables (what Jacques literally described)**
> Hi! Thanks for your ReviewTap order. We still need your logo. Head to link.reviewtap.co.za/setup and enter your order number.

- Manual send: **one click**, nothing to fill. Genuinely the fastest.
- **Requires a new bare `/setup` page** with an order-number input — it does not exist today, only `/setup/:orderNumber`.
- **Cost:** an extra step for a customer who has already ignored us once. Every added step loses some completion, and completion is the actual goal. Recommend against as the default, but it is the right answer if manual sending stays common.

**Option C — keep `rt_logo_upload` as the only variable**
> …Upload it here: {{1}} — where `{{1}}` = `rt_logo_upload`

- One field, and it covers **both** order-number and walk-in cases, since the app already writes whichever URL applies.
- But the field must be filled by hand on a manual send, and it is a long URL to retype. Worse ergonomics than A for the same field count.

### 4.4 Handling walk-ins under Option A
Two clean routes, pick one in §7:
1. **Two templates** — `logo_request` (order-number) and `logo_request_link` (token URL). The workflow picks by whether the order has a number. More GHL surface to maintain.
2. **One template, Option C shape** — accept the long-URL retype for the rare walk-in.

Walk-ins are rare (every current no-logo order has a number), so I lean to (2) — one template, and the ugly case stays ugly but works.

### 4.5 Meta constraints — the part that is not instant
- WhatsApp templates need **Meta approval**. Editing an approved template puts it **back into review**, and Meta limits how often a template can be edited.
- **Do not edit the live template.** Create a **new** template alongside it, wait for approval, then repoint the GHL workflow (`GHL_LOGO_WORKFLOW_ID`'s workflow) at the new one. The switch is instant and reversible; the live template keeps working throughout.
- Category stays **Utility** — it references the customer's own order.
- Code impact is near zero: `sendLogoRequestViaGhl` can keep writing `rt_logo_upload` and `order_number` harmlessly. Unused variables cost nothing.

---

## 5. The root-cause fixes (bigger levers, in payoff order)

### L1. Flip the Shopify order-confirmation email — **this is the biggest one, and it is not done**
`SHOPIFY-EMAIL-SNIPPET.md` has been sitting ready since 17 Jul: a paste-ready Liquid block putting a "Set up my order" button linking to `/setup/{{order_number}}` in the confirmation email, guarded to only show on `Custom` line items.

**Verified: `setup.submitted` has ZERO events in the activity log.** Nobody has ever completed the /setup flow, which means the email has not been flipped (or no qualifying order has arrived since).

This is the lever that stops logo-less orders existing. The customer is asked at the moment of purchase, when they are most engaged, instead of being chased days later. Every order that self-serves is a chase that never happens — and it needs no code, just the paste job in Shopify Admin.

### L2. Get contact details onto banner-created orders
So auto-send works and GHL is never opened by hand.
- **L2a — CSV import.** Jacques already exports `orders_export.csv` from Shopify; it carries name, email **and phone** for every order (verified against the 17 Jul export). A small importer that matches on order number and fills `company_name` / `whatsapp` / `email` would fix every banner order in one pass, and kill the `Order #1837` placeholder names at the same time.
- **L2b — paste one number.** Already possible today: edit pencil → paste WhatsApp → save → the auto-send button appears. Cheaper than the GHL detour and available right now, with no build. **Worth telling the team today regardless of what we build.**
- **L2c — re-check Shopify PII access.** The cleanest fix if it has changed. Recorded as a platform limitation on 2026-07-09; cheap to re-verify before assuming it still holds.

### L3. Surface the derivable link
Because `/setup/<number>` needs no token, the order card could simply *show* `link.reviewtap.co.za/setup/1837` as copyable text, with no "create link" round-trip at all. Would have saved Diane both of this morning's round-trips.

---

## 6. Recommendation

1. **L1 now** (no code): flip the Shopify email. Biggest lever, zero build, already written.
2. **L2b now** (no code): tell the team to paste the number into the order, not into GHL.
3. **Option A template** (small): new template, one variable, generic greeting — fixes the "Hi Order," bug too.
4. **L2a** (small build): CSV importer, so this stops recurring.
5. **L3** (tiny): show the derivable link on the card.

Note what is *not* recommended: editing the live template, and Option B, unless §7 says manual sending will stay the norm.

---

## 7. Decisions needed

1. **Template shape — A (one variable, direct link) or B (zero variables, customer types their order number)?** A protects completion; B is genuinely one click. Recommend A.
2. **Walk-ins: two templates, or one template using `rt_logo_upload`?** Recommend one.
3. **Has the Shopify confirmation email been flipped?** The log says no. If it is blocked on something, that is worth knowing — it is the biggest lever here.
4. **Build the CSV importer, or keep pasting numbers by hand?** Worth it if banner orders keep arriving; overkill if L1 makes them rare.
5. **Who owns the Meta template submission?** Code cannot do it. Someone has to create and submit it in the Meta/GHL console, and approval is not instant.

---

## 8. Out of scope
- The approval template (`design_approval`) — working, and Diane sent one via GHL at 10:02 today. Only the logo-request template is in question.
- The `window.prompt` follow-up button, `ab094` orphan designs, `ab095` wa.me leak review, `ab096` Formaloo sync. All still open, all unrelated.
