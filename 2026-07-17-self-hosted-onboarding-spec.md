# Self-Hosted Onboarding (Formaloo Replacement) — Spec

**Date**: 2026-07-17
**Status**: BUILT 2026-07-17 (steps 1–6 of §8 live; step 7 = Jacques flips the Shopify email template; step 8 stays a later phase — Formaloo NOT retired). See CLAUDE.md "Destinations + /setup".
**Goal**: the customer buys, and within ~30 seconds of the order confirmation we have a verified logo and a verified Google review link for **every business the order is actually for**, without anyone chasing them.

> **v2 changes** (Jacques's answers reshaped two things):
> - **Cards are out.** §4.2's card step is gone. `cards.reviewtap.co.za/new` already owns the digital card; `/setup` hands off to it. Old G4/G5 were wrong and are rewritten. See §3a.
> - **The delivery channel is forced, not chosen.** WhatsApp cannot carry the first touch, because neither our app nor GHL is permitted to know the customer at order time. This is now §4.0, and it drives D1. This was the biggest hole in v1.

---

## 1. The actual problem

Jacques: *"since we now have a link.reviewtap why are we still sending people there?"* and *"what about when the user buys 7 but its for 6 different locations or different types of businesses?"*

Two problems with one root.

**(a) The intake is disconnected from the purchase.** A customer can pay on Shopify and never submit the Formaloo form. Nothing prevents it, so the whole missing-logo banner (`GET /api/orders/missing-logo`) exists to *detect* it afterwards. That is a leak being policed, not closed.

**(b) The intake cannot express what the order is for.** Formaloo's row, and `manual_orders` after it, hold a **singular** `company_name`, `logo_url`, `google_review_url`. One order, one business. Reality:

| Order | Reality | What the model did |
|---|---|---|
| 1795 | Rustenburg Toyota + Slices + Street Food Lane | 3 designs, no order-level link (Gotcha #15) |
| 1811 | Noble Village + Samancor Chrome + Jomo Kwadi | same |
| 1820 | Witsieshoek Mountain Lodge + Thaba Adventures | `company_name = 'Two (2) Companies: "Witsieshoek Mountain Lodge" and "Thaba Adventures"'` |
| Umndeni | 2 stands, 2 Google listings | 2 designs hand-cloned via service key |

**Order 1820 is the tell.** The customer answered correctly and clearly. The form had no slot for the answer, so it became a string that would have greeted them on WhatsApp, and `order_overrides` had to be built to suppress it.

Root cause of both: the intake is a third-party artifact that does not know what was bought and cannot express what it is for. Multi-destination is not an edge case to bolt on. It is the proof that the shape is wrong.

---

## 2. What already exists (verified against the code, 2026-07-17)

This is mostly an assembly job. Verified, with file refs:

| Thing | Where | State |
|---|---|---|
| Public no-login upload page | `services/logoRequestPage.js`, `routes/logoRequestPublic.js`, `netlify/functions/logo-request.js` | **Works.** Logo + one flexible name-or-link field. But token is minted by staff (`routes/logoRequests.js`), so it is a recovery tool, not a front door. |
| Per-order Shopify facts | `services/shopify.js` | **Already returns most of what we need**: `quantity`, `requiresLogo`, `requiresStand`, `requiresCard`, from `CUSTOM_TITLE_RE = /custom/i` over `lineItems{title,quantity}`. Needs the split in §4.3a. |
| Google Places lookup | `Reviewtap Fufillment/reviewtap-fulfillment.html` | **Working**: `places.PlacesService` + `textSearch` + `place_id`. On ReviewTap's own Google project, so it transfers with the sale. |
| Same-logo, N-listings production | `lib/qr.js` `generateStyledQR`, "QR variants" in `DesignCanvas` | **Already built**: N QR codes → N designs, same layout. This is the 6-branch case, already solved downstream. |
| Digital card onboarding | `Reviewtap/card-builder/` (separate Next.js app, `cards.reviewtap.co.za`) | **Already self-serve and self-hosted**: `/new`, `/cards/[slug]`, `/edit/[token]`, `/api/cards`, `/admin`. Owns the digital card. `/setup` must not duplicate it. |
| GHL send | `services/ghl.js` `sendLogoRequestViaGhl`, workflow `42f54a81-...`, field `rt_logo_upload` | **Live.** Default send path as of 2026-07-17. |
| Order key | Gotcha #15 | `owner_slug` / `row_slug` is the only real order link. `order_number` is free text. |
| Logo storage | `manualOrders.js` `uploadLogo`, bucket `manual-order-logos`, path `${rowSlug}/logo.${ext}` | Works. Path is per-order, which §4.1 must change. |
| Corrections | `order_overrides`, `applyOverride` in `routes/orders.js` | One company name per order. Ripples in §4.4. |
| Migrations | none | **No migrations directory.** Schema is applied by hand in Supabase. SQL in §4.1 must be run manually. |

---

## 3. Gaps (this is the real work)

- **G1. There is no front door.** The token is staff-minted, so Formaloo is the only public URL. Nobody chose Formaloo over link.reviewtap; the replacement was never given an entry point.
- **G2. One destination per order.** `manual_orders` and the Formaloo row are both singular. The model cannot hold 1795/1811/1820/Umndeni. This is the headline gap.
- **G3. Free-text business field.** `fulfillLogoRequest` routes anything URL-shaped to `google_review_url` and everything else to `company_name`, with no validation. Customers type business names into review-link fields, and printed QRs 302 to a relative path and 404. Three real client QRs needed hand repair.
- **G4. The Custom Smart Business Card has no fixed process.** Jacques, 2026-07-17: *"ad hoc, no fixed process."* It is the one genuinely dual-track product (print artwork **and** a digital landing page), and `requiresCard` currently cannot even distinguish it from a review card. See §3a.
- **G5. Formaloo is slow and read-only.** Cold Orders still pays ~2.4s (board ab096), and `order_overrides` exists solely because the submission cannot be edited at source.
- **G6. Both delivery paths point at Formaloo**: the Shopify order confirmation email and manual sends.

### 3a. The card fields are dead weight, not a blocker (corrects v1)

v1 assumed Formaloo's card fields were load-bearing and that `/setup` had to absorb a per-person card intake. **Both were wrong.** Grepped 2026-07-17:

| Field | Actually used for |
|---|---|
| `profilePicture`, `landingLinks`, `socialLinks` | **Nothing.** Captured in `formaloo.js`, normalised in `normaliseRow`, referenced nowhere else. |
| `landingPageText` | One display line in `OrdersPanel.jsx:617`, truncated to 100 chars |
| `cardEmail`, `cardPhone`, `cardAddress` | Display-only lines (`OrdersPanel.jsx:613-616`) + editable in `ManualOrderModal` |

Nothing builds anything from them. They are a fossil of a card intake that `cards.reviewtap.co.za` superseded. **Do not port them to `/setup`, and do not rebuild them.** They can stay on the order card as display until Formaloo retires, then simply not carry over.

**But `requiresCard` is genuinely ambiguous.** `CUSTOM_TITLE_RE = /custom/i`, and its own comment names *"Custom Smart Business Card"* alongside *"Custom Branded Google Review Card/Stand"*. Both match `/custom/i` **and** `/card/i`, so `requiresCard` is `true` for two different products with different needs:

| Product | Needs |
|---|---|
| Custom Branded Google Review Card | Print artwork only (logo + listing) → `/setup` |
| Custom Smart Business Card (R649, `custom-nfc-qr-business-card`) | Print artwork **and** a digital landing page → `/setup` **then** `cards/new` |

That ambiguity is almost certainly why Formaloo grew landing/social fields in the first place. §4.3a fixes it.

---

## 4. Proposed design

### 4.0 The delivery channel is forced (read this before designing anything)

Jacques asked whether the link should go by WhatsApp, since that is where the comms live. **It cannot, and this is a constraint rather than a preference.** Two independent systems are both blocked from knowing who the customer is at order time:

1. **Our Shopify app** (`services/shopify.js`, Dev Dashboard custom app, `read_orders` only): getting name/email/phone is Level-2 protected customer data. Verified live that this app's Dev Dashboard **has no UI to request it at all** (known Shopify platform bug, not fixable from our side).
2. **GHL**: RT's Shopify store is on the **Basic plan**, and Shopify's PII policy **blocks GHL Contact Sync and Order Sync on Basic** (found 2026-06-28). GHL cannot see Shopify orders or customers either.

So at order time we hold no phone number and no email address. **We cannot WhatsApp them and we cannot send our own email.** The Shopify order confirmation is the only channel that reaches every buyer, precisely because Shopify sends it using data neither system is permitted to read.

This drives everything:
- **D1 is forced tokenless.** Liquid renders that email and cannot compute an HMAC.
- **WhatsApp is the channel from first submit onward, not before.** The customer gives us their number on `/setup`; from that moment approval and chasing run on GHL exactly as they do today.
- **Non-submitters remain unreachable by WhatsApp**, which is precisely today's problem. `/setup` narrows it (one link, in the receipt, that knows what they bought) but does not eliminate it.

The exit from this constraint is upgrading Shopify Basic → the Shopify plan, which unlocks GHL Contact + Order sync (WhatsApp-first onboarding, no email dependency) **and** the native abandoned-checkout trigger for the cart-recovery work. **Decided (D7): later, after cash-recovery proves out.** Do not design for it now; note that `/setup`'s URL shape is unchanged if it ever happens.

**Resulting flow:**
1. Shopify confirmation email → `/setup/{{ order.order_number }}`
2. Page reads the order via the existing `read_orders` sync, shows what they bought
3. Customer picks locations, uploads logo(s), **and gives their WhatsApp number**
4. On submit: create the order row + destinations, upsert the GHL contact with that number
5. Approval and chasing run on WhatsApp via GHL, unchanged

### 4.1 The destination is the unit of onboarding

A **destination** = one business or branch: one Google listing, one logo, one QR, N units. An order is a payment that happens to contain several.

`row_slug` stays the order key. Destinations are children of it. This is deliberately the least invasive shape: `order_status`, `approvals`, and `designs.owner_slug` all already key on `row_slug` and none of them change.

```sql
create table order_destinations (
  id              text primary key,           -- nanoid(12)
  row_slug        text not null,              -- FK-by-convention to the order (Formaloo rowSlug OR manual_*)
  position        int  not null default 0,    -- display order; 0 = primary
  business_name   text,                       -- canonical, from the Places pick
  google_place_id text,
  google_review_url text,
  logo_url        text,
  qty_stand       int  not null default 0,
  qty_review_card int  not null default 0,
  qty_smart_card  int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index order_destinations_row_slug_idx on order_destinations (row_slug);
alter table order_destinations enable row level security;
-- No policies: deny-all, same as every other table. Backend uses the service key.
```

Notes:
- Works for **both** sources, because `row_slug` is the shared key. A Formaloo order and a self-hosted order get destinations the same way.
- **Storage path must change** from `${rowSlug}/logo.${ext}` to `${rowSlug}/${destinationId}.${ext}`, or destination 2's logo overwrites destination 1's. This is a real trap in `uploadLogo`.
- `manual_orders` keeps `company_name`/`logo_url`/`google_review_url` during dual-run and stops being written to at cutover. Do not drop the columns until the Formaloo retirement lands.
- The table name `manual_orders` becomes wrong (it is now "the order row for non-Formaloo orders", which it already half was). Renaming a live table is risk for no gain (D6).

**Migration**: every existing `manual_orders` row with a `company_name` or `logo_url` becomes its destination at `position = 0`. Formaloo rows get a destination synthesised on read (or backfilled at retirement). Order 1820 gets **two** destinations by hand, which is the first real proof the model works.

### 4.2 The setup page (public)

`GET /setup/:orderNumber` → server-rendered, no login, `noindex`. Same pattern as `approve.js` / `logo-request.js`: a **standalone Netlify function**, not an Express route through `api.js` (Gotcha #1 and #14).

Flow:
1. Look the order up via `fetchOpenShopifyOrders()`. Show what they bought: *"Order #1820 — 7 × Custom Branded Google Review Stand"*. This alone beats Formaloo, which never knew.
2. **One destination card by default**, prefilled, plus a quiet **"+ Add another business or location"**. The single-business majority never touches it and sees zero extra friction. The multi case gets an affordance instead of a text box to improvise into.
3. Per card: **Places picker** (name + review link in one action), **logo**, **qty stepper** per product type present on the order.
4. **"Use the same logo" toggle** on cards 2..N. This one control resolves the whole multi-location question without ever asking the customer to classify themselves:
   - *Same brand, 6 branches*: logo on, 6 different listings. Downstream this is a QR-variants job.
   - *Different businesses*: logo off, upload per card.
5. **WhatsApp number** (one per order, not per destination). This is what makes §4.0 step 4 possible.
6. **Smart-card handoff** (§4.3a), if and only if the order contains one.

Two rules that matter more than the UI:

- **Never hard-block on the quantities summing** (D2). Ordered 7, allocated 3+2+1? Flag it on the order card for Giorgio and accept the submission. The entire problem is people not submitting. Do not invent a new reason to abandon at 11pm.
- **The link stays live and re-openable.** A franchise coordinator will not have six listings to hand in one sitting. Today `request_submitted_at` stamps once and the page goes to a "thanks" terminal state. Partial submit, come back, add the rest. Every submit is an upsert, never a one-shot.

**Explicitly not on this page**: profile pictures, landing text, social links, per-person card details. See §3a.

### 4.3 Review link resolution

The Places pick returns `place_id`. Build the review URL as `https://search.google.com/local/writereview?placeid=<place_id>`.

**This format is already proven in production** and needs no fresh verification: the Fulfillment Console has been using it to encode real client NFC chips since June. `reviewtap-fulfillment.html:376`:

```js
const REVIEW = id => `https://search.google.com/local/writereview?placeid=${id}`;
```

It also already parses the format back out (`:642`, `const m = v.match(/placeid=([A-Za-z0-9_\-]+)/)`) and already maps `textSearch` results to `{placeId, displayName}` at `:582`. So step 1 is a **port of working, live code**, not a build. The CID → `g.page/r/<token>/review` derivation stays available but is not needed on this path.

Either way, the review link is now **derived from a picked listing rather than typed**, which is what kills G3 at the source rather than nagging staff about it.

### 4.3a Product split + the smart-card handoff (D3)

`services/shopify.js` must stop conflating the two card products:

```js
const SMART_CARD_RE   = /smart\s+business\s+card/i
// requiresCard today is true for BOTH products. Split it:
requiresSmartCard:  customLineItems.some(li => SMART_CARD_RE.test(li.title)),
requiresReviewCard: customLineItems.some(li => /card/i.test(li.title) && !SMART_CARD_RE.test(li.title)),
requiresStand:      customLineItems.some(li => /stand/i.test(li.title)),
```

Also return **per-type quantities** (`qtyStand`, `qtyReviewCard`, `qtySmartCard`), not just the current summed `quantity`, since the destination allocator needs them per type. Keep `quantity` as the sum for back-compat with the missing-logo banner.

**Handoff (D3, Jacques's pick):** `/setup` is the single front door for every order. It takes the logo + listing (which the smart card needs anyway, for its print artwork), and on submit, if `requiresSmartCard`, it ends with a clear **"Now build your digital card"** step linking to `cards.reviewtap.co.za/new`.

- One entry point for the customer, two apps that stay cleanly separate.
- This is a **strict improvement on "ad hoc, no fixed process"** (G4). It does not need to be perfect to be better than what exists.
- **Nice-to-have, not required**: `cards/new?order=<n>` so the card ties back to the order. That is a change in the *card-builder repo*, which is out of scope here. If it is cheap, take it; if not, the handoff still works without it.
- `/setup` does **not** write into the card-builder's API. That coupling is what §3a says to avoid.

### 4.4 Studio side (the ripple)

This is the bulk of the work and it is where the risk is.

- **Order card becomes a parent** with N destination children. Each child has its own logo thumbnail, business name, review link, qty, and its own "New design" that prefills *that* destination.
- **`enrichOrder` gains `order.destinations[]`.** For back-compat, `order.companyName` / `logoUrl` / `googleReviewUrl` continue to resolve to **destination 0**, so approvals, the GHL greeting, design names and log labels keep working unchanged during dual-run. This is the single most important compatibility decision in the spec: `applyOverride` is explicitly the one place corrections are applied, and everything downstream reads the enriched order.
- **`order_overrides` becomes per-destination.** A correction now targets a destination, not an order. During dual-run, an order-level override keeps applying to destination 0.
- **`matchesFilter('awaiting_logo')`** changes from `!order.logoUrl` to "any destination missing a logo". Same for `hasOpenLogoRequest`.
- **Same-logo, N-destinations should route into QR variants**, not be rebuilt by hand. This is the payoff: the 6-branch order falls into machinery that already exists.

### 4.5 Delivery

One URL, both paths (see §4.0 for why this shape is forced):
- **Shopify order confirmation template** → `/setup/{{ order.order_number }}`. Flipped **at launch** (D5).
- **GHL send** (`sendLogoRequestViaGhl`) → the same URL, for chasing anyone who has given us a number. Existing workflow and `rt_logo_upload` field, no GHL changes needed.

---

## 5. Out of scope

- **Retiring Formaloo.** Nothing gets switched off in this phase.
- **Syncing Formaloo's ~400 rows into Supabase.** That is board ab096 (the cold-start fix). It is the *same job* as the Formaloo retirement and should be done as one phase, later, not smuggled in here.
- **Any card/landing/social intake.** `cards.reviewtap.co.za/new` owns it (§3a). `/setup` links to it and nothing more.
- **The Shopify plan upgrade** (D7). Revisit after cash-recovery proves out.
- **Fulfillment Console port.** Already deferred by the 2026-07-14 spec. Not reopened.
- **`manual_orders` rename** (D6).

---

## 6. Risks

1. **The enrichment path is load-bearing.** `applyOverride` / `enrichOrder` feed the order card, the WhatsApp greeting, the GHL contact name, design names and log labels. §4.4's back-compat rule (destination 0 resolves the old singular fields) is what stops this being a rewrite. If that rule is broken, everything downstream breaks at once.
2. **Gotcha #14.** `/setup` is a public server-rendered page, so it is a standalone function like `approve.js`. But any new **authed** router (e.g. `/api/destinations`) must be mounted in **both** `backend/src/index.js` and `netlify/functions/api.js`, or it works locally and 404s in prod. An unauthenticated test will not reveal it.
3. **The Places key is domain-locked** to the Fulfillment Console's site. `link.reviewtap.co.za` must be added to its referrer allowlist. It is on ReviewTap's Google project, so there is no JCE entanglement and it transfers with the sale.
4. **Logo storage path collision.** `${rowSlug}/logo.${ext}` will silently overwrite across destinations. Must become per-destination before any multi-destination write.
5. **Flipping the email at launch (D5) means every new order is the test.** Accepted deliberately: it is the only way to get real traffic, and Formaloo's failure mode (silence) is worse than a visible bug. Mitigation: watch the first orders live, and keep the Formaloo form *reachable but unlinked* for a few days so a rollback is a template edit rather than a rebuild.
6. **Tokenless enumeration** (D1). Exposure is an unfilled form with no PII behind it, since neither our app nor GHL can access customer data anyway (§4.0). The irony is load-bearing: the same constraint that forces tokenless also makes it safe.
7. **RT is for sale.** Scope discipline. The counter-argument is that self-hosted intake is an asset that transfers, whereas Formaloo is a rented dependency a buyer inherits along with a form that can break printed QR codes. That argument only holds if the scope stays at §4.

---

## 7. Decisions — ALL CLOSED 2026-07-17

| # | Decision | Answer |
|---|---|---|
| **D1** | Tokenless `/setup/:orderNumber`, or a token? | **Tokenless.** Not a preference: §4.0 makes it the only option. `noindex` + rate-limit. |
| **D2** | Hard-block a quantity mismatch, or accept and flag? | **Accept and flag** (Jacques). Non-submission is the disease; do not add a symptom. |
| **D3** | Per-person card intake in `/setup`? | **No.** Cards leave `/setup` entirely. `/setup` collects the logo, then hands off to `cards/new` (§4.3a). The v1 framing was wrong (§3a). |
| **D4** | Dual-run length before Formaloo retires? | Superseded by D5. Formaloo stays reachable-but-unlinked as a rollback; retirement is its own phase (§5). |
| **D5** | When does the Shopify email flip? | **At launch** (Jacques). Every new order is the test; see Risk 5. |
| **D6** | Rename `manual_orders`? | **No.** Live table, no gain, real risk. Note it in CLAUDE.md instead. |
| **D7** | Upgrade Shopify Basic → Shopify plan? | **Later**, after cash-recovery proves out (Jacques). Does not change `/setup`'s design (§4.0). |

---

## 8. Build order (approved)

1. **Places picker onto the existing logo-request page.** Small, self-contained, ships alone, kills G3 today for every order Giorgio already sends a link for. Verify the review URL against King Chicken first (§4.3). No schema change.
2. **`shopify.js` product split** (§4.3a): `requiresSmartCard` / `requiresReviewCard`, per-type quantities. Small, isolated, unblocks 4.
3. `order_destinations` table + per-destination storage path + migration of existing rows + order 1820 by hand.
4. `enrichOrder` gains `destinations[]` with the destination-0 back-compat rule. Studio order card renders children. **This is the risky step; nothing customer-facing changes yet.**
5. `/setup/:orderNumber` public function: Shopify lookup, destination cards, add-another, same-logo toggle, WhatsApp capture, soft validation, re-openable, smart-card handoff.
6. Repoint the GHL send at `/setup`.
7. **Flip the Shopify order confirmation template** → `/setup` (D5). Watch the first orders live.
8. *(Separate phase, not this spec)* Formaloo history → Supabase, retire Formaloo, close ab096.

### Verification notes

- Steps 3 and 4 must be verified **against live data, not fixtures**. Both of the traps in Gotcha #15 and #16 were found by running against real orders and by nothing else. Orders 1795, 1811, 1820 and Umndeni are the test set: they are the reason this spec exists, and if the model does not hold them, it is wrong.
- Step 5's round trip must be driven end to end before deploy (URL → page render → Places pick → submit → storage upload → destination rows → GHL contact upsert → re-open and add a second destination), the same way Feature J was verified by curl before shipping.
- Step 7 is the one with a live blast radius. Place a real test order if possible, or verify against the very next real one within minutes.
- `node --check` is not verification (2026-07-17 lesson). A real request is.
