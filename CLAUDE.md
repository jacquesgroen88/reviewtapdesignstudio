# ReviewTap Design Studio — Project Context

Internal tool for ReviewTap staff to design print artwork (table stands, business cards)
for clients who submit logos/details via a Formaloo form. Designers pick up orders,
place the logo + a QR code on a fixed product canvas, export print-ready files, and
mark the order done. QR codes are **dynamic** (redirect through our own backend so the
destination can be changed without reprinting).

Live: Netlify site `unrivaled-fairy-147ae5.netlify.app` (GitHub: `jacquesgroen88/reviewtapdesignstudio`).
Everything (frontend + backend functions) runs on **Netlify**. DB is **Supabase**.

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
- `components/DesignCanvas.jsx` — **orchestrator**. Reads the active variant's `faces`,
  renders one `FaceCanvas` per face (Stand = 1, Card = Front+Back side by side), holds a
  shared toolbar + asset panel that act on the *focused* face. Owns variant switch, per-face
  logos/history/selection state, and export (iterates faces).
- `components/FaceCanvas.jsx` — **one editable face**. Self-contained Fabric canvas: background,
  guides, smart-centre guides, zoom/pan, undo/redo (own useHistory), add/replace/remove asset,
  `buildExportCanvas(templateUrl)`. Exposes an imperative API via `registerApi(faceId, api)`.
  Keyed by `face.id` so switching white↔black swaps the bg in place (keeps placed logos).
- `components/LogoPanel.jsx` — logo upload (dropzone), browser-side BG removal, hosts QRPanel.
  Operates on the focused face (DesignCanvas routes onLogoReady/onLogoRemove to the active API).
- `components/QRPanel.jsx` — create new dynamic QR (saves to backend) OR pick a saved one,
  add to canvas. Colours auto-set from stand variant.
- `components/AdminPanel.jsx` — QR CRUD, bulk import, copy URL, download QR PNG, scan counts.
- `components/CanvasToolbar.jsx` — undo/redo, layer order, delete, zoom controls.
- `hooks/useHistory.js` — undo/redo via Fabric JSON snapshots.
- `lib/products.js` — product canvas definitions (dimensions, template variants, safe margin).

### Backend (`backend/src/`)
- `services/database.js` — Supabase client (REST only). **Caches client, passes `ws` transport.**
- `services/formaloo.js` — Formaloo API client (auto-refreshing JWT). Field-slug map lives here.
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

### Mark complete
"Mark complete" (only shown for orders, i.e. `prefill.rowSlug`) → `PATCH /api/orders/:slug/status
{status:'done'}` → returns to Orders inbox. Status stored in Supabase `order_status` table.

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
   face (`main`); Card variants have `front` + `back`. DesignCanvas renders a FaceCanvas per
   face and exports per face: Mockup PDF = one page per face; Print TIFF / Drive = one file per
   face (named `..._Front.tiff` / `..._Back.tiff`). `backend/routes/upload.js` no longer resizes
   (faces vary) — it just tags 300 DPI and converts the incoming full-res PNG to LZW TIFF.

---

## Environment variables (set in Netlify → Site settings → Env vars)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_KEY`)
- `FORMALOO_API_KEY`, `FORMALOO_API_SECRET`, `FORMALOO_FORM_SLUG=CGQse2u9`, `FORMALOO_WORKSPACE=cHQuChHR`
- Optional: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID` (Drive upload),
  `VITE_QR_BASE_URL` (override the QR redirect base, e.g. `https://qr.reviewtap.co.za/r`).
Local: `backend/.env` (gitignored) holds the same. Real values are committed there locally only.

---

## Custom domain / QR hosting reliability (qr.reviewtap.co.za)
Goal: a scanned QR must redirect fast and never time out.
- **DNS**: point `qr.reviewtap.co.za` at Netlify (add as a domain alias). `/r/:code` then works on it.
  Set `VITE_QR_BASE_URL=https://qr.reviewtap.co.za/r` so newly-generated QR codes encode that host.
  (Existing codes already printed keep working as long as their host points at this site.)
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
Done: orders inbox, prefill logo+QR, dynamic QR system, admin panel, white/black stand,
zoom/pan, PDF+TIFF+Drive export (guides excluded), mark-complete, Netlify+Supabase deploy.
Not done: real business-card template (still placeholder SVG), multi-product sequencing
(Stand+Card in one order), email mockup to client for approval, Formaloo webhook for live
inbox updates, Supabase Pro / edge-redirect for max QR reliability.
