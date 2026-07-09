# ReviewTap Design Studio — Project Context

Internal tool for ReviewTap staff to design print artwork (table stands, business cards)
for clients who submit logos/details via a Formaloo form. Designers pick up orders,
place the logo + a QR code on a fixed product canvas, export print-ready files, and
mark the order done. QR codes are **dynamic** (redirect through our own backend so the
destination can be changed without reprinting).

Live: Netlify site `unrivaled-fairy-147ae5.netlify.app` (GitHub: `jacquesgroen88/reviewtapdesignstudio`).
Everything (frontend + backend functions) runs on **Netlify**. DB is **Supabase**.

---

## ⚠️ QR uptime is sacred — read before ANY change

Printed cards and NFC stands are **in the field with paying clients**. Every tap or scan
hits `https://link.reviewtap.co.za/r/:code`. If that path breaks, clients experience
downtime in front of *their* customers — there is no "refresh the page" for a printed card.

Non-negotiable rules:
1. **`/r/:code` stays a standalone Netlify function** (`netlify/functions/redirect.js`)
   behind a `force = true` redirect in `netlify.toml`. Never route it through the Express
   `api.js` function, never let the SPA fallback catch it, never remove the `force` flag.
2. **Never deploy a change that touches `redirect.js`, the `/r/*` redirect rule, or the
   `qr_codes` Supabase table without testing the redirect immediately after** — e.g.
   `curl -sI https://link.reviewtap.co.za/r/<known-code>` must 302 to the destination,
   and a bogus code must 404 (a 200 with HTML means the SPA fallback swallowed it = broken).
3. **`keepalive.js` (scheduled `@daily`) must never be deleted** — it stops the Supabase
   free tier from pausing, which would take every printed QR code down.
4. **Frontend deploys are safe for QR codes** (the redirect is a separate function), but
   verify rule 2 anyway whenever `netlify.toml` changes — redirect order/typos can reroute `/r`.
5. DNS for `link.reviewtap.co.za` is a CNAME → this Netlify site. Don't repoint it without
   migrating every code in `qr_codes` first; printed codes encode this exact host forever.

---

## Architecture

```
frontend/            React 18 + Vite 5 + Fabric.js 5 + Tailwind — the whole UI
backend/src/         Express routes + services (shared by Netlify Functions AND local dev)
netlify/functions/   Serverless entry points (import from backend/src)
package.json (root)  Holds the FUNCTION dependencies (critical — see Gotchas)
netlify.toml         Build + redirect config
```

Local dev: `frontend` (vite :3000) proxies `/api` and `/r` to `backend` Express (:4000)
via `frontend/vite.config.js`. On Netlify, those paths hit functions instead.

### Frontend structure (`frontend/src/`)
- `App.jsx` — top-level tabs: **Orders** (default), **Design Studio**, **QR Codes**. Holds
  `session` (the active design) and routes "Design this order" → prefilled canvas.
- `components/OrdersPanel.jsx` — Formaloo inbox. Filters (needs_design / all / done),
  per-order status dropdown, "Design" button. Logo thumbnail uses raw S3 URL (plain img OK).
- `components/DesignCanvas.jsx` — **single-canvas editor**. ONE Fabric canvas holds all of a
  variant's `faces` as side-by-side background panels (Stand = 1 panel; Card = Front+Back with a
  `GAP_FULL` px gap). Assets are a single `logos` array and can be dragged **freely across panels**
  (clamp is to the whole canvas, not per-panel). Owns variant switch, zoom/pan, one shared
  history, smart-centre guides (snap to whichever panel the asset's centre is over), and export.
  Export renders the full canvas at `1/DISPLAY_SCALE` then **crops each panel's region**
  (`exactFaceCanvas`) to produce per-face PDF pages / TIFF / Drive files. (There is no FaceCanvas
  component anymore — that per-face split was replaced so assets can move between front and back.)
- `components/LogoPanel.jsx` — logo upload (dropzone), browser-side BG removal, hosts QRPanel.
  Adds/removes on the single canvas (one logos array).
- `components/QRPanel.jsx` — create new dynamic QR (saves to backend) OR pick a saved one,
  add to canvas. Colours auto-set from stand variant.
- `components/AdminPanel.jsx` — QR CRUD, bulk import, copy URL, download QR PNG, scan counts.
- `components/CanvasToolbar.jsx` — undo/redo, layer order, delete, zoom controls.
- `hooks/useHistory.js` — undo/redo via Fabric JSON snapshots.
- `lib/products.js` — product canvas definitions (dimensions, template variants, safe margin).

### Backend (`backend/src/`)
- `services/database.js` — Supabase client (REST only). **Caches client, passes `ws` transport.**
- `services/formaloo.js` — Formaloo API client (auto-refreshing JWT). Field-slug map lives here.
- `services/shopify.js` — Shopify Admin API client (client-credentials grant, `read_orders` only).
  Bulk-fetches unfulfilled orders, matched to local orders by `order_number`. See "Shopify order
  sync" below.
- `routes/qr.js` — QR CRUD + bulk-import.
- `routes/orders.js` — list/get Formaloo orders merged with local status; PATCH status.
- `routes/redirect.js` — local-dev `/r/:code` (Netlify uses the dedicated function instead).
- `routes/upload.js` — PNG→TIFF (sharp) → Google Drive upload.
- `routes/proxyImage.js` — local-dev image proxy (Netlify uses dedicated function).
- `routes/removeBg.js` — legacy remove.bg proxy (BG removal is now browser-side; route unused).

### Netlify Functions (`netlify/functions/`)
- `api.js` — wraps the Express app with `serverless-http`. Handles `/api/*` (except proxy-image).
- `proxy-image.js` — **standalone** (NOT through Express). Returns image base64 + `isBase64Encoded`.
- `redirect.js` — **standalone** `/r/:code` redirect. Has DB timeout + cache headers.
- `keepalive.js` — scheduled `@daily`, pings DB so Supabase free tier never pauses.

---

## Key flows

### Orders tab vs Design Studio tab — how they're meant to be used (clarified 2026-07-08)
Two different mental models, on purpose:
- **Orders = client-driven, job-shaped.** One row per client submission (Formaloo, or manually
  entered). It's where you START work (New design), TRACK it through the status ladder
  (Pending → Ready → Pending Approval → Pending Print → Done), SEND it for approval, and see
  the client's answer. You live here for "what does client X need, and where is it."
- **Design Studio = design-shaped, reusable library.** Every design ever made, independent of
  which order it belongs to (or whether it belongs to one at all — a design can be a pure
  library piece, never linked to a client). It's where you OPEN, DUPLICATE, or bulk-export
  designs. You live here for "find/reuse/export artwork," not for tracking a job's status.
  A design started from an Order is automatically linked (`owner_slug`) and shows up on both
  screens; a design started directly from Design Studio ("New design" there) has no linked
  order and never gets an approval-status ladder — it's for house templates, one-off jobs
  that don't need client sign-off, or drafts you're not ready to attach to a real order yet.
- **The status ladder only lives on the Order**, not the design. Multiple designs on one
  order (e.g. Stand + Card) share the same status; "Send for approval" on the order card
  bundles every design on it into one link. Sending approval from inside the editor (the
  "Approval" button) does the same for just that one design.
- **Rule of thumb**: if a client is involved, start from Orders. If you're building/reusing
  artwork with no specific client attached yet (or doing bulk print-file work across many
  already-approved jobs), use Design Studio.

### Orders → Design (prefill)
`OrdersPanel` "Design" → `App.handleDesignOrder(order)` builds a `session.prefill` with
`{logoUrl, googleReviewUrl, orderNumber, companyName, rowSlug, orderedStand, orderedCard}` →
`DesignCanvas` prefill `useEffect` (fires once when canvas `ready`):
- Loads the logo via `/api/proxy-image?url=...` (NOT the raw S3 URL — see Gotchas) onto canvas.
- Passes `companyName`/`googleReviewUrl` to QRPanel to prefill the new-QR form.

### Dynamic QR
QRPanel "Create & add" → `POST /api/qr {label, destination}` → backend returns `{id,...}` →
QR encodes `${origin}/r/{id}` → added to canvas. Scanning hits `/r/:id` → `redirect.js`
looks up destination in Supabase, 302s, increments `scan_count`. Edit destination anytime
in the QR Codes tab — printed codes follow.

### Export
`buildExportCanvas()` in DesignCanvas: hides guide objects (`isGuide:true`), resets viewport,
renders full-res via `canvas.toCanvasElement(1/DISPLAY_SCALE)`. Then:
- **PDF**: `toDataURL` → jsPDF at exact mm dimensions.
- **TIFF**: `getImageData` → `UTIF.encodeImage` (300 DPI tags) → blob download. Client-side.
- **Drive**: PNG → `/api/upload` → sharp converts to 300 DPI LZW TIFF → Google Drive.

### Designs are first-class & reusable (one shared library)
Designs live in Supabase `designs(id, name, owner_slug, product_id, variant_id, design JSONB)`.
`owner_slug` ties a design to an order (Formaloo rowSlug) or is null for a library design.
An order/job can have **many** designs (e.g. one stand with 10 different QR codes).
- API: `/api/designs` (list `?owner=`), `GET/PUT/DELETE /api/designs/:id`,
  `POST /api/designs/:id/duplicate`. `design` JSONB = `{ assets: [...] }` (logo/QR placements).
- **Editor save** (`DesignCanvas`): first Save `POST`s a new design (prompts for a name,
  `ownerSlug = prefill.rowSlug || null`) and stores `currentDesignId`; later saves `PUT`.
- **Duplicate** button = save current canvas as a NEW design, then edit the copy (swap its QR).
- **QR variants** button = bulk: pick N saved QR codes → one new design per code (same layout,
  QR swapped via `generateStyledQR` from `lib/qr.js`).
- **Design Studio tab** = `DesignLibrary` listing all designs (open/duplicate/rename/delete).
- **Order cards** list that order's designs (`order.designs`), each with an **Edit** that opens
  it directly; a **New design** button routes to the picker scoped to the order.
- Restore loads only `design.assets` (backgrounds/guides redrawn fresh) — see Gotcha #11.
- Legacy `order_designs` table is kept as a backup; the migration backfilled `designs` from it.

### Mark complete (legacy note)
Status lives in `order_status`. The `done` status no longer disables the card — the Design
button becomes **Edit** and the order stays fully reusable.

---

## Data

### Supabase (project `reviewtap-studio`, ref `urwqhjcocnclvhomuksm`, eu-west-1)
- `qr_codes(id, label, destination, scan_count, created_at, updated_at)` — id is short nanoid(7) or custom.
- `order_status(row_slug, status, note, updated_at)` — status ∈ pending|in_progress|done|skipped.
- RPC `increment_scan_count(qr_id)` — atomic counter bump.
- RLS enabled, open policies (`USING true`) — backend uses anon key, fine for internal tool.

### Formaloo form (the client intake form)
- URL: `reviewtap.formaloo.me/6n4h9c`. **`6n4h9c` is the address, NOT the API slug.**
- Real API slug: `CGQse2u9`. Workspace: `cHQuChHR`. (Find via `GET /v3.0/forms/` and match `address`.)
- Auth is two-step: `POST /v3.0/oauth2/authorization-token/` with `x-api-key` + `Authorization: Basic {SECRET}`
  + form body `grant_type=client_credentials` → returns a JWT (≈30-day expiry). Then call endpoints
  with `x-api-key` + `Authorization: JWT {token}` + `x-workspace: {ws}`. Token cached in formaloo.js.
- Field slugs (in `formaloo.js` FIELDS): Order# `eIfCw2E1`, Company `VYIddv0M`, WhatsApp `UNp7D885`,
  Google review `PcQWad3z`, ordered-stand `kRVUys9e` (yes/no), Logo file `POFSwcNm` (array of {url}),
  ordered-card `17grICul`, profile pic `2UOZ1mqV`, landing text `BU0jpy6j`, email `LejbQqTb`,
  phone `JnD7JINw`, address `hgf7CcWL`, landing links `bWu5V3Ns`, social `8kRr02aT`.
- Logo files are public `s3.amazonaws.com/formaloo-en/...` URLs (200, but **no CORS headers**).

---

## Gotchas (hard-won — read before changing related code)

1. **Binary through serverless-http is corrupted.** Routing an image through the Express
   function mangles it as UTF-8 (a 223KB PNG came back as 399KB garbage). Binary responses
   MUST be standalone Netlify functions returning base64 + `isBase64Encoded:true`. That's why
   `proxy-image.js` and `redirect.js` are standalone, not Express routes.

2. **Formaloo S3 logos need proxying.** S3 sends no CORS headers, so loading with Fabric's
   `crossOrigin:'anonymous'` (required to keep the canvas exportable) silently fails. Route
   prefilled logos through `/api/proxy-image?url=...` so they're same-origin → loads AND exports.

3. **Supabase + Node 20 WebSocket error.** `@supabase/supabase-js` inits a Realtime WS client on
   creation; Node 20 (Netlify functions) has no native WebSocket → throws. Fix: pass `ws` package
   as `realtime.transport` in `createClient` (database.js). We only use REST anyway.

4. **Supabase free tier PAUSES after ~7 days idle.** A paused DB breaks QR redirects. `keepalive.js`
   (scheduled `@daily`) pings it. For production QR reliability, also consider Supabase Pro ($25/mo)
   so it never pauses. See "Custom domain / reliability" below.

5. **Netlify function deps live in ROOT `package.json`.** With no `base` dir set, Netlify installs
   root deps which esbuild resolves for functions (they walk up to repo-root node_modules). The
   build command then installs+builds frontend separately. `backend/package.json` is only for local dev.
   `sharp` is in `external_node_modules` (native binary, can't be bundled).

6. **netlify.toml redirect order matters.** `/api/proxy-image` must precede `/api/*` (first match wins).

7. **Export must hide guides.** Guide rects are tagged `isGuide:true`; `buildExportCanvas()` sets them
   invisible before rendering. Also add `isGuide` to the toJSON key list in useHistory.js or undo/redo
   drops the flag.

8. **Product dimensions.** Stand templates are 1417×1654 px = 120×140 mm @ 300 DPI.
   Card faces are 638×1016 px (portrait CR80). `DISPLAY_SCALE = 0.28` shows canvases smaller;
   export multiplies back by `1/DISPLAY_SCALE`. Each `face` carries its own width/height.

9. **Faces model.** Every variant has a `faces[]` array (products.js). Stand variants have one
   face (`main`); Card variants have `front` + `back`, rendered as side-by-side panels on ONE
   canvas so assets drag between them. Export crops each panel: Mockup PDF = one page per face;
   Print TIFF / Drive = one file per face (`..._Front.tiff` / `..._Back.tiff`).
   `backend/routes/upload.js` doesn't resize — it tags 300 DPI and converts the PNG to LZW TIFF.
   Saved-design schema: `{ product_id, variant_id, canvas: <full fabric JSON> }` (single canvas;
   the old per-face `{faces:{...}}` schema is ignored on load → falls back to prefill).

10. **Export must use exact face dimensions.** `DISPLAY_SCALE`-rounded canvas dims don't divide
    back evenly, so `toCanvasElement(1/DISPLAY_SCALE)` is a few px off the true face size. That
    mismatch made jsPDF stretch the image and shift the QR (TIFF was fine, PDF wasn't).
    `exactCanvas()` in DesignCanvas redraws onto a canvas of exactly `face.width×face.height`
    before PDF/TIFF/Drive, so the PDF page aspect matches perfectly. Don't pass `'FAST'` to
    jsPDF.addImage — it degrades the image.

11. **Never `await import()` business-critical libs — deploys break open tabs.** (Jun 2026
    incident.) Vite splits dynamic imports into hashed chunk files; every deploy rotates the
    hashes and deletes the old files. A Studio tab opened before a deploy then can't fetch
    the chunk — and the SPA fallback (`/* → /index.html 200`) masks the 404 by returning
    HTML with a 200, so the browser dies with "Failed to fetch dynamically imported module".
    This silently killed QR add ("nothing happens"), PDF export, and TIFF export for a
    designer mid-session. Fix: `qr-code-styling`, `jspdf`, and `utif` are now **static
    imports** in `lib/qr.js` and `DesignCanvas.jsx` — they live in the main bundle that's
    already loaded in the tab, immune to hash rotation. Rule going forward: anything a
    designer needs to finish a job (QR, export, save) must be a static import. Only
    genuinely huge deps may stay lazy (currently just `@imgly/background-removal`, ~24MB
    of WASM), and `main.jsx` has a `vite:preloadError` listener that tells the user to
    save + refresh instead of failing silently. Never auto-reload there — it would discard
    unsaved canvas work.

12. **Every async UI handler needs a `catch` that surfaces the error.** The QR bug above
    stayed invisible for so long because `addSavedQR` was `try { … } finally { … }` with
    no catch — the rejection vanished and the button just "did nothing". Silent failure in
    an internal tool means the designer blames themselves and works around it instead of
    reporting it. Pattern: `catch (err) { setError(err.message || '<action> failed') }`.

13. **Fabric.js silently swallows right-clicks and middle-clicks.** `Canvas.__onMouseDown`
    checks `checkClick(e, RIGHT_CLICK)` / `MIDDLE_CLICK` and does an early `return` unless
    `fireRightClick: true` / `fireMiddleClick: true` were set in the `new fabric.Canvas(...)`
    options — with neither set, no `'mouse:down'` listener EVER fires for those buttons, no
    error, nothing. Found while building the right-click context menu (2026-07-08); the fix
    also un-broke the existing "middle-mouse to pan" feature, which had been dead code the
    whole time for the same reason. Both flags are now set in DesignCanvas's canvas init.

---

## Auth (added 2026-07-08, Phase 2)
Supabase Auth. Frontend: `lib/supabase.js` (session) + `lib/api.js` (`apiFetch`
attaches the bearer token — use it for ALL /api calls). Backend:
`middleware/auth.js` (`requireAuth` on every /api route except /api/health;
`requireAdmin` for team management). `routes/team.js` = invite (magic link →
/welcome), list, remove. `profiles(id, display_name, role)` in Supabase.
PUBLIC always: `/r/:code`, keepalive, proxy-image (host-allowlisted instead —
it's loaded as a plain <img>/canvas URL and can't carry headers).
First-time flow: invite email → /welcome → set name + password → /orders.
Deploy sequencing + RLS lockdown steps: see DEPLOY-PHASE2.md (RLS flip only
AFTER the live site is verified on SUPABASE_SERVICE_KEY).

## Environment variables (set in Netlify → Site settings → Env vars)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_KEY`)
- `FORMALOO_API_KEY`, `FORMALOO_API_SECRET`, `FORMALOO_FORM_SLUG=CGQse2u9`, `FORMALOO_WORKSPACE=cHQuChHR`
- `SHOPIFY_SHOP_DOMAIN=aq6cc7-u1.myshopify.com`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`
  (Dev Dashboard custom app "Design Studio Sync", `read_orders` scope only — see Shopify sync below)
- Optional: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID` (Drive upload),
  `VITE_QR_BASE_URL` (override the QR redirect base, e.g. `https://qr.reviewtap.co.za/r`).
Local: `backend/.env` (gitignored) holds the same. Real values are committed there locally only.

---

## Shopify order sync (added 2026-07-09)
Formaloo only captures boolean "ordered stand/card" — never real quantities, and a
customer can pay on Shopify without ever filling in the Formaloo form. `services/shopify.js`
fixes both: a Dev Dashboard custom app ("Design Studio Sync", client-credentials grant,
`read_orders` scope only — no customer PII) pulls unfulfilled Shopify orders, matches them
to Formaloo/manual orders by `order_number`, and:
- Adds live `order.shopify = {quantity, fulfillmentStatus, financialStatus}` to every
  order card whose number matches (`enrichOrder` in `routes/orders.js`).
- Exposes `GET /api/orders/missing-logo` — Shopify orders needing a logo ("Custom" in the
  product title) with **no** matching Formaloo/manual order at all — rendered as a
  dismissible orange banner at the top of the Orders tab, each with a "+ Log manually"
  shortcut that opens `ManualOrderModal` prefilled with the order number + stand/card guess.
- In-memory cache (5 min) on the bulk fetch — fine on Netlify Functions since warm
  containers reuse it, same pattern as `formaloo.js`'s token cache.
Dev Dashboard app: `dev.shopify.com/dashboard/155113118/apps/395276976129`. Only Level-1
order data is used (line items/quantities/fulfillment status) — that tier is always
available on every Shopify plan, so no protected-customer-data review was needed.
Getting customer name/email/phone (Level 2) would need `read_customers` + a protected-data
grant — verified live that this app's Dev Dashboard has no UI to request it at all (known
Shopify platform bug, not fixable from our side): dev.shopify.com/dashboard/.../settings has
no such option, and partners.shopify.com doesn't even recognize this app (404s).

---

## Logo-request link (Feature J, added 2026-07-09)
Lets the customer upload their own logo instead of Jacques chasing them — same
server-rendered-public-page pattern as the approval flow (Feature F), reusing
`manual_orders` as the anchor row rather than a new table.
- `manual_orders` gained `request_token`, `request_sent_at`, `request_submitted_at`.
- `services/manualOrders.js`: `setLogoRequestToken`, `getManualOrderByToken`, `fulfillLogoRequest`.
- `POST /api/logo-requests` (authed) `{rowSlug}` → generates/returns `{token, url, waUrl}`
  (`routes/logoRequests.js`). wa.me link only built if the order already has a phone/whatsapp.
- Public page: `GET /logo-request/:token` + `POST /logo-request/:token/submit` — standalone
  Netlify function (`netlify/functions/logo-request.js`, mirrors `approve.js`) in prod, Express
  router (`routes/logoRequestPublic.js`, mounted before `requireAuth`) in local dev. Renders via
  `services/logoRequestPage.js` (plain HTML + inline script, FileReader→dataURL, no SPA).
- Frontend: `lib/logoRequest.js` + `LogoRequestShareModal.jsx` (copy-link always; WhatsApp
  button only when a phone is known).
- Two entry points in `OrdersPanel.jsx`: the missing-logo banner's "Request logo" button
  creates the manual order on the fly (`company_name` defaults to `Order #<number>` — rename
  later once the customer replies, since Shopify PII isn't available to prefill it) then
  requests a token in one motion; an order card with `isManual && !logoUrl` shows the same
  action once the order already exists.
- Verified full round-trip locally via curl (token → page render → submit → storage upload →
  `manual_orders` row updated → page shows "thanks" state) before deploying.

---

## Custom domain / QR hosting reliability (qr.reviewtap.co.za)
Goal: a scanned QR must redirect fast and never time out.
- **DNS**: production QR domain is **`link.reviewtap.co.za`** (CNAME → Netlify site, added as a
  domain alias). `/r/:code` works on it. Set `VITE_QR_BASE_URL=https://link.reviewtap.co.za/r`
  in Netlify env so newly-generated QR codes encode that host (redeploy after changing).
  (Existing codes already printed keep working as long as their host stays pointed at this site.)
  If on Cloudflare, keep the CNAME DNS-only (grey cloud) so Netlify manages SSL.
- **The redirect is already hardened**: 5s DB timeout (fail fast, no hang), `Cache-Control: max-age=300`
  on the 302 (repeat scans are instant + survive brief DB hiccups), async scan counting.
- **Biggest risk = Supabase pausing** (free tier). Mitigations in order of robustness:
  1. `keepalive.js` daily ping (done) — prevents idle pause.
  2. Upgrade to Supabase Pro so it never pauses (recommended before heavy print volume).
  3. (Future) Move the slug→destination map to Netlify Blobs (always-on, no pause) or an edge
     KV store, and read it in a Netlify **Edge Function** for sub-50ms redirects with no cold DB.
- Old QR host was QR-Me; we replaced it. Bulk-import old codes via QR Codes tab → Bulk import.

---

## Common commands
- Local dev: `cd frontend && npm run dev` (+ `cd backend && npm run dev` for API).
- Deploy: push to `master` → Netlify auto-builds.
- Inspect Formaloo: see the auth flow above; slug is `CGQse2u9`, not the public `6n4h9c`.

## Status / TODO ideas
Done: orders inbox, prefill logo+QR, dynamic QR system, admin panel, real branded
templates for **all** products (white/black stand + white/black card front&back),
5-stage order status (pending → pending_approval → pending_print → done / skipped),
standalone jobs (design work not tied to a Formaloo order), design library + QR variants
+ duplicate, zoom/pan, PDF+TIFF+Drive export (guides excluded), Netlify+Supabase deploy,
static bundling of QR/PDF/TIFF libs (Gotcha #11).
Not done: multi-product sequencing (Stand+Card in one guided flow), email mockup to
client for approval, Supabase Pro / edge-redirect for max QR reliability.

---

## Related & Connections

- **Part of**: ReviewTap (product pillar) → Mission Control portfolio
- **Brand**: ReviewTap (reviewtap.co.za) — this studio produces print artwork for ReviewTap table stands and business cards
- **Tech stack**: React 18 + Vite, Fabric.js canvas editor, Tailwind CSS, Supabase (auth + storage), Netlify Functions, Formaloo order intake
- **Workflow lineage**: client order via Formaloo → designer places logo + dynamic QR → print-ready export → fulfillment (`Reviewtap/Reviewtap Fufillment/`)
- **See also**: ReviewTap Ad Studio (`Reviewtap/Reviewtap Ads/`), ReviewTap Link Generator, ReviewTap Product Designer, card-builder (core product repo)
