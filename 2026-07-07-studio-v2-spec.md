# ReviewTap Design Studio V2 — Full Specification

**Date**: 2026-07-07
**Author**: Claude (investigated live codebase + Supabase schema on 2026-07-07)
**Applies to**: link.reviewtap.co.za (Netlify site `unrivaled-fairy-147ae5`, repo `jacquesgroen88/reviewtapdesignstudio`)
**Status**: SPEC, not yet built

---

## 0. Scope

Five requested features plus an investigated improvement backlog:

1. Logo cropping in the Design Studio
2. Real URL pages per section (`/orders`, `/designstudio`, `/qrcodes`)
3. Login security: magic-link invite, then username + password
4. Design attribution: show who created each design
5. QR codes: surface the created date in the data and UI
6. Improvement backlog (security, reliability, UX, hygiene) from a code audit

### Non-negotiable constraint (from project CLAUDE.md)

`/r/:code` QR redirects serve printed cards in the field. Every phase below is sequenced so the redirect path is never at risk. Nothing in this spec routes `/r/*` through the SPA, the Express function, or any auth wall. After any deploy touching `netlify.toml`, `redirect.js`, or Supabase policies: `curl -sI https://link.reviewtap.co.za/r/<known-code>` must 302, and a bogus code must 404.

---

## 1. Current state (verified 2026-07-07)

- **Navigation**: `App.jsx` uses a `tab` state (`orders` / `studio` / `admin`) with conditional rendering. No router installed. URL never changes; refresh loses all navigation state.
- **Auth**: none. Every `/api/*` endpoint is open. Supabase RLS policies are `USING true` with the anon key, so the DB is effectively public through the API. The Netlify `api.js` function sets `cors()` with no origin restriction.
- **Logos**: uploaded via react-dropzone in `LogoPanel.jsx`, stored as dataURLs, placed as `fabric.Image`. Browser-side background removal exists (`@imgly/background-removal`). No crop capability at all; only Fabric's native resize and rotate handles.
- **Designs**: Supabase `designs(id, name, owner_slug, product_id, variant_id, design JSONB, created_at, updated_at)`. No creator field.
- **QR codes**: Supabase `qr_codes(id, label, destination, scan_count, created_at, updated_at)`. `created_at` already exists and the API already returns it; the AdminPanel table simply does not display it. No creator field.
- **Dead code**: `EntryScreen.jsx`, `CompletionScreen.jsx`, `ProductNavigator.jsx` unused; `Menu.jsx` imported but not rendered; `removeBg.js` route unused; `jobs.js` routes have no UI.
- **Known bugs**: `FRONTEND_URL` unset in prod so Express CORS defaults to localhost (masked by the permissive function-level CORS); `renameIfSaved()` swallows errors; order status updates are optimistic with no failure feedback.

---

## 2. Feature A — URL routing (pages per section)

### Goal
`link.reviewtap.co.za/orders`, `/designstudio`, `/qrcodes` are real, shareable, refresh-safe URLs. Deep links open a specific design or order.

### Design
Add `react-router-dom` (v6). The existing SPA fallback in `netlify.toml` (`/* → /index.html 200`) already serves any path, so no infra change is needed. The `/r/:code` and `/api/*` redirects sit above the SPA fallback with `force = true`, so they are unaffected.

**Route map**

| Route | Renders | Notes |
|---|---|---|
| `/` | redirect → `/orders` | Preserves current default tab |
| `/orders` | `OrdersPanel` | |
| `/orders/:rowSlug` | `OrdersPanel` scrolled/filtered to that order | Optional, phase 2 of routing |
| `/designstudio` | `DesignLibrary` | |
| `/designstudio/new` | `ProductPicker` | Query params carry order prefill: `?owner=<rowSlug>` |
| `/designstudio/:designId` | `DesignCanvas` loading that design | Replaces the in-memory `session` handoff for saved designs |
| `/qrcodes` | `AdminPanel` | |
| `/login` | Login screen (Feature C) | |
| `/welcome` | First-time account setup after magic link (Feature C) | |
| `*` | 404 page with links back | Currently unknown paths render the app silently |

**Refactor notes**

- `App.jsx` swaps `tab` state for `<Routes>`; `NavTab` becomes `<NavLink>` (free active styling).
- The unsaved-canvas problem: `DesignCanvas` must register a navigation blocker (`useBlocker`) so switching pages with unsaved work prompts first. Today the tab switch silently discards work; this is an improvement, not just parity.
- New unsaved designs (no id yet) keep using in-memory session state under `/designstudio/new`; once first-saved, `navigate('/designstudio/'+id, {replace:true})` so refresh restores the design from the API.
- `EntryScreen` / `Menu` / `CompletionScreen` / `ProductNavigator` are deleted in the same PR (dead code, and a router makes their old purpose moot).

### Acceptance criteria
- Refresh on any route restores the same view (editor restores the saved design by id).
- Browser back/forward works between sections.
- `/r/:code` still 302s after deploy (regression check).
- Old bookmarked root URL still lands on Orders.

**Effort**: ~1 day including the blocker + deep-link load path.

---

## 3. Feature B — Authentication (magic link → username + password)

### Goal
Only invited team members can access the studio and its APIs. Invite by email; recipient clicks a magic link, sets a display name and password, and signs in with email + password from then on. Every API write is tied to a known user.

### Approach: Supabase Auth (recommended)
Supabase is already the datastore, `@supabase/supabase-js` is already a dependency, and Supabase Auth ships magic links (invite emails), password auth, JWT issuance, and session refresh out of the box. No new vendor, no password storage to build.

### 3.1 Data model

```sql
-- Profiles: one row per auth user
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,          -- the "username" shown on designs
  role        text not null default 'designer' check (role in ('admin','designer')),
  created_at  timestamptz not null default now()
);
```

- "Username" = `display_name` (what teammates see, e.g. "Jacques", "Giorgio"). Sign-in identifier stays the email address; a separate login username adds friction and a uniqueness system for zero benefit at this team size. The welcome screen labels it "Your name".
- Roles: `admin` can invite users and hard-delete; `designer` does everything else. Jacques = admin.

### 3.2 Flows

**Invite (admin)**
1. New "Team" page (`/team`, admin-only): list users, invite by email, deactivate.
2. Backend endpoint `POST /api/team/invite {email}` calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: 'https://link.reviewtap.co.za/welcome' })` using the **service role key** (server-side only).
3. Supabase emails the magic link.

**First login (invitee)**
1. Clicks magic link → lands on `/welcome` with a valid session (supabase-js picks the token out of the URL hash).
2. Form: display name + new password (min 10 chars) + confirm.
3. Client calls `supabase.auth.updateUser({ password })` then `POST /api/team/profile {displayName}` (backend upserts `profiles` row).
4. Redirect to `/orders`.

**Normal login**
1. `/login`: email + password → `supabase.auth.signInWithPassword`.
2. "Email me a login link" fallback button → `signInWithOtp` (also serves as password reset without building reset UI).
3. Session persisted by supabase-js (localStorage + auto-refresh). Route guard component redirects any unauthenticated route (except `/login`, `/welcome`) to `/login`.

### 3.3 API protection

Frontend attaches the Supabase access token to every API call: `Authorization: Bearer <jwt>` (axios interceptor).

Backend Express middleware (`backend/src/middleware/auth.js`):

```js
// Verifies the Supabase JWT locally (JWKS / JWT secret), attaches req.user = { id, email }
// then loads display_name from profiles (cached in-memory per instance).
```

- Applied to ALL `/api/*` routes except `GET /api/health`.
- `proxy-image` (standalone function) also checks the bearer token: it is only ever called by the logged-in canvas, and an open proxy is an SSRF/abuse vector.
- **NOT applied, ever**: `redirect.js` (`/r/:code`) and `keepalive.js`.

### 3.4 Locking the database (sequenced to protect QR uptime)

Today the anon key + `USING true` RLS means anyone can query Supabase directly. Fix in this exact order:

1. Add `SUPABASE_SERVICE_KEY` to Netlify env. Switch `redirect.js` and `keepalive.js` to prefer the service key. Deploy. **Test `/r/<code>` immediately.**
2. Switch `backend/src/services/database.js` to the service key. Deploy. Smoke-test QR CRUD, orders, designs.
3. Only now change RLS policies on `qr_codes`, `designs`, `order_status`, `jobs`, `fulfillment_runs` from `USING true` to deny anon (service role bypasses RLS, so the app keeps working; the leaked-anon-key attack surface closes).
4. Re-test `/r/<code>` again (it now runs on the service key, but verify).
5. Lock function CORS: `cors({ origin: ['https://link.reviewtap.co.za', 'https://unrivaled-fairy-147ae5.netlify.app'] })` in `netlify/functions/api.js`, and set `FRONTEND_URL` for local Express.

### 3.5 Config
- Supabase dashboard: enable Email provider (magic link + password), set Site URL to `https://link.reviewtap.co.za`, add `/welcome` to redirect allowlist.
- Default Supabase email sender is fine to start; custom SMTP (e.g. reviewtap.co.za domain) is a later polish item.
- New env vars: `SUPABASE_SERVICE_KEY` (server only), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (frontend auth client; anon key is safe to expose once RLS denies anon data access).

### Acceptance criteria
- Unauthenticated visit to any page redirects to `/login`; direct API calls without a token return 401.
- Invite email → set name + password → lands in app; second login works with password; magic-link fallback works.
- Printed QR scan works throughout every deploy step (spot-check after each).
- Anon key can no longer read `qr_codes`/`designs` via the Supabase REST endpoint.

**Effort**: 2–3 days including the DB lockdown sequence and Team page.

---

## 4. Feature C — Design attribution (who created what)

Depends on Feature B (needs users to attribute to).

### Data model

```sql
alter table designs  add column created_by uuid references profiles(id),
                     add column updated_by uuid references profiles(id);
alter table qr_codes add column created_by uuid references profiles(id);
```

Existing rows stay null and display as "Legacy". No backfill needed.

### Behaviour
- `POST /api/designs` and `POST /api/qr` stamp `created_by = req.user.id` server-side (never trust a client-sent value). `PUT /api/designs/:id` stamps `updated_by`.
- Design list APIs join `profiles.display_name` (add `created_by_name`, `updated_by_name` to `DESIGN_META` responses).
- **DesignLibrary cards**: "Created by Jacques · 3 Jul 2026" and, when different, "Last edited by Giorgio · 6 Jul 2026".
- **Order cards** (`OrdersPanel`): each listed design shows the creator name.
- **QR admin table**: creator column (see Feature E).
- Optional filter in the library: "Mine / All".

### Acceptance criteria
- New design saved while logged in as X shows "Created by X" everywhere designs are listed.
- Duplicating a design stamps the duplicator as creator of the copy.
- Legacy designs render "Legacy", not blank or an error.

**Effort**: 0.5–1 day.

---

## 5. Feature D — Logo cropping — BUILT 2026-07-08

### Goal
Crop an uploaded logo (trim whitespace, cut a lockup down to just the mark, straighten a rectangle out of a busy image) before or after placing it on the canvas, without losing the original.

### Design: crop modal on the original source (recommended over Fabric clipPath)
**As built**: `react-image-crop` instead of the originally-spec'd `react-easy-crop` — react-easy-crop only supports pan+zoom within a fixed-aspect frame (no drag-resize freeform rectangle), which can't trim asymmetric whitespace off a logo. react-image-crop gives a true draggable/resizable rectangle. Renders the crop to a new dataURL at the source's native pixel resolution via an offscreen canvas. Fabric `clipPath` cropping was considered and rejected: it complicates the export pipeline (`exactFaceCanvas`), the saved-design JSON schema, and undo/redo snapshots, all of which are hard-won stable code (Gotchas 7, 9, 10, 11).

**Gotcha discovered while building the companion right-click menu**: Fabric.js silently swallows right-clicks (and middle-clicks) unless `fireRightClick: true` (and `fireMiddleClick: true`) is set on canvas creation — without it, no `mouse:down` listener ever sees the event, no error, nothing. This also means the existing "middle-mouse to pan" feature was dead code until this fix (added as CLAUDE.md Gotcha 13).

**Flow**

1. **At upload** (LogoPanel): each logo card gets a "Crop" button next to the existing background-removal toggle.
2. **On canvas**: selecting a logo shows "Crop" in `CanvasToolbar`. Opens the same modal seeded with the asset's source.
3. Modal: free-form crop rect (drag + resize), zoom slider, aspect presets (Free / 1:1 / original), Apply / Cancel.
4. Apply renders the cropped region at the source image's native resolution (no downscaling: print output is 300 DPI, so crop from `originalSrc` full-res pixels, never from the canvas-scaled render).
5. The logo entry keeps `originalSrc` untouched and updates `processedSrc`; a stored `crop: {x, y, width, height}` (in source-pixel coords) makes the crop **re-editable**: reopening the modal restores the previous rect against the original.
6. Crop composes with background removal: pipeline is `originalSrc → bgRemoved? → crop rect → processedSrc`. Toggling either re-runs the pipeline.
7. On-canvas replace: swap the fabric.Image element's source in place, preserving `left/top/angle` and visual size (recompute `scaleX/scaleY` so the logo does not jump in size when its pixel dimensions change).
8. History: applying a crop pushes one undo snapshot (the asset src swap), consistent with `useHistory.js`.

**Persistence**
Saved-design asset JSON gains optional fields, backward compatible (old designs simply have none):

```js
{ id, isQR, src, left, top, scaleX, scaleY, angle,
  originalSrc,            // present when the asset was ever cropped/bg-removed
  crop: {x,y,width,height},
  bgRemoved: true }
```

Note: storing `originalSrc` grows the JSONB. Acceptable now; if design rows get heavy, the improvement backlog item "asset storage" (I-9) moves sources to Supabase Storage.

**Static import rule**: `react-easy-crop` is small; import it statically (Gotcha 11: anything a designer needs mid-job must not be a lazy chunk).

### Right-click context menu on the canvas (added 2026-07-08 per Jacques) — BUILT
Right-clicking an asset on the canvas opens a context menu at the cursor (dedicated `CanvasContextMenu.jsx`, fixed-position, dismisses on outside click/Escape/scroll):
- On a **logo**: Crop…, Remove background / Restore background, Bring forward, Send backward, Delete.
- On a **QR**: Bring forward, Send backward, Delete (crop/bg-removal don't apply).
- On empty canvas / background: no menu (browser default untouched — verified).
Calls the exact same handlers as the LogoPanel side buttons (bg-removal + crop logic lives in DesignCanvas, shared by both UIs — not duplicated).

### Acceptance criteria
- Crop at upload and crop of an already-placed logo both work; the placed logo keeps its position and on-canvas size.
- Re-opening crop shows the previous rect; Cancel changes nothing.
- Crop + background removal can be combined in either order.
- Export (PDF/TIFF/Drive) shows the cropped logo at full print resolution.
- Undo reverses a crop.

**Effort**: 1.5–2 days (the resolution-preserving apply and history integration are the fiddly parts).

---

## 6. Feature E — QR created date in the data and UI

`qr_codes.created_at` already exists (DB default `now()`) and is already returned by every QR API response. The gap is presentation and export. Changes:

1. **AdminPanel table**: add a "Created" column (format `3 Jul 2026`), sortable; default sort stays newest-first. Tooltip shows exact timestamp.
2. **QRPanel saved-list**: each saved QR row shows its created date under the label.
3. **Creator**: with Feature C, also show `created_by_name` ("Created 3 Jul 2026 by Jacques").
4. **CSV export** (small add): "Export CSV" button on AdminPanel dumping `id, label, destination, scan_count, created_at, created_by` for audits and client reporting.
5. **Bulk import**: imported legacy codes keep `created_at = now()` (import date); acceptable, but the CSV import format accepts an optional `created_at` column for true historical dates.
6. **PNG filename**: downloaded QR PNGs become `qr_<label>_<id>_<YYYY-MM-DD>.png` so the file itself carries the date.

Deliberately NOT changing: the encoded QR payload. It must remain exactly `https://link.reviewtap.co.za/r/<id>`; embedding a date in the encoded URL would change scan behaviour for zero benefit and violate the uptime constraint.

**Effort**: 0.5 day.

---

## 6b. Feature F — Client approval flow (approved 2026-07-07, replaces backlog item I-12)

### Goal
Replace "export PDF, attach in WhatsApp, wait for a reply" with a one-tap approval link. Approval becomes a tracked, timestamped event that moves the order status automatically.

### Flow
1. Designer clicks **Send for approval** on an order card or in the editor.
2. System renders a web-friendly mockup PNG of the current design (reusing the existing export pipeline, downscaled ~1200 px), stores it in Supabase Storage, and creates an approval record with a long unguessable token.
3. Designer gets a **pre-filled WhatsApp share link** (`wa.me/<clientNumber>?text=...` using the WhatsApp number already captured by Formaloo) containing `https://link.reviewtap.co.za/approve/<token>`.
4. Client opens the page: artwork full-screen (pinch-zoomable), company name, **Approve** and **Request changes** (+ comment box). No login.
5. Approve → `order_status` flips `pending_approval → pending_print` automatically, `approved_at` stamped. Request changes → status back to `in_progress`, comment shown on the order card.

### Sending the approval message (updated 2026-07-08 per Jacques)

**Primary (day one): one-click WhatsApp share (wa.me).** The "Send for approval" button produces a `wa.me/<clientNumber>?text=<prefilled message + approval link>` deep link — one click opens WhatsApp (desktop or phone) with the message and link already typed; the designer just hits send. Works with zero infrastructure, keeps the personal sender identity, and remains the permanent fallback. The client's number comes from the Formaloo WhatsApp field; if missing, the button falls back to copy-link-to-clipboard.

**Upgrade: auto-send via the Reviewtap System (GHL).** Backend calls the GHL Conversations API (existing ReviewTap PIT key) to send the WhatsApp message directly — designer never leaves the studio. Client-facing copy says "Reviewtap", never GHL. Mechanics and prerequisites:
1. **WhatsApp must be connected** on the ReviewTap GHL sub-account — CONFIRMED ACTIVE by Jacques 2026-07-08. Jacques creates the message template (exact text provided by Claude; category Utility); build needs the approved template's name.
2. **A WhatsApp template is required** for business-initiated messages. Meta's rule: free-form WhatsApp messages are only allowed within 24h of the client's last inbound message; an approval request sent cold (client only filled the Formaloo form) needs a pre-approved template. One template covers everything, created once in GHL's template manager and submitted to Meta (usually approved within hours):
   > "Hi {{1}}, your ReviewTap design for order {{2}} is ready to view! Open it here to approve or request changes: {{3}}. Reply here if you have any questions."
3. The backend fires the template with variables (client name, order number, approval link) and logs the send on the GHL contact's timeline, so the approval history is visible in the pipeline.
4. **Auto-chase**: if no response AND the link is unopened/unanswered after 48h, send one reminder via the same template mechanism (max 1; the order card shows "reminded").

### Approval page rendering — print vs client view (rule, never forget)
The client must see the **product mockup**, not the raw print file. The renderer (`lib/renderDesign.js`) gets a `mode` parameter:
- `mode: 'mockup'` (approval page, PDF mockups, JPEG previews): background = `face.mockupTemplate || face.template` — what the product actually looks like.
- `mode: 'print'` (TIFF, Drive, bulk export): background = `face.template` — the print-production file with the print-correct background per current editor rules.
This mirrors the editor's existing behaviour (`exactFaceCanvas` uses mockupTemplate for PDF/JPEG and template for TIFF/Drive) and MUST hold for every future export path.

### Extra approval-flow improvements (agreed 2026-07-08)
- Mockup-on-product rendering on the approval page (rule above).
- **Seen tracking**: stamp `viewed_at` when the client opens the link (distinguish "never opened" from "opened, no reply" for chasing).
- **Approved → fulfillment handoff**: approval flips status to pending_print, design automatically qualifies for the library's "Select approved" bulk export.
- **One link per order**: if an order has multiple designs (stand + card), a single approval page lists all of them, each independently approvable.
- **Version history**: a re-sent approval after change requests shows "updated since your feedback" with the previous comment.

### Data model
```sql
create table approvals (
  token        text primary key,            -- nanoid(21)
  design_id    text not null references designs(id),
  owner_slug   text,                        -- Formaloo order row_slug
  mockup_path  text not null,               -- Supabase Storage object
  design_snapshot jsonb not null,           -- exact JSONB the client approved
  sent_by      uuid references profiles(id),
  sent_at      timestamptz not null default now(),
  responded_at timestamptz,
  response     text check (response in ('approved','changes')),
  comment      text,
  superseded_at timestamptz                 -- set when a newer approval is sent
);
```

### Implementation notes
- The approval page is a **standalone server-rendered Netlify function** (`approve.js`, same pattern as `redirect.js`): plain HTML with OG meta tags (so WhatsApp shows the artwork preview card), inline JS posting the response. Not part of the React SPA: no auth wall, no chunk-rotation risk, instant load.
- `POST /api/approvals` (auth'd, creates record + mockup) and `POST /approve/:token/respond` (public, one response per token).
- **Version locking**: the approval stores the design snapshot. Any later `PUT /api/designs/:id` where a responded/unresponded approval exists marks it `superseded_at` and drops order status back to `pending_approval`. Nothing prints on a stale yes.
- Orders panel shows approval state per design: "Sent 3 days ago, no response" (chaseable), "Approved 4 Jul", or "Changes requested: <comment>".
- Sequenced after Feature B/C (needs `sent_by` attribution and Supabase Storage), i.e. lands as **Phase 4b** alongside/after crop.

**Effort**: ~1 day manual flow + ~0.5 day GHL auto-send.

---

## 6c. Feature G — QR styling in the QR Codes admin (added 2026-07-07)

### Goal
Choose the QR's visual design when creating it, and download any saved code in different styles later (e.g. a white-stand version and a black-stand version of the same code). Styling is presentation-only: the encoded `/r/<id>` URL never changes, so restyling never breaks printed material.

### Design

**1. Style picker in the New QR modal** (QR Codes tab)
The create/edit modal gains the same styling controls the editor's QRPanel already has (shape presets square/rounded/dots/classy, foreground/background colours, transparent background, error-correction level) plus a live preview, all driven by the existing `generateStyledQR` in `lib/qr.js`. Two one-click presets sit on top:
- **White stand/card**: black modules, transparent background
- **Black stand/card**: cream `#fff6ea` modules on black (matches the editor's convention)

The chosen style is saved with the code as its **default style**.

**2. Styled downloads from the table**
The download button opens a small popover instead of instantly downloading:
- Preset row: White stand · Black stand · Plain (black/white, current behaviour) · the code's saved default
- "Customise" expands the full controls (shape, colours, EC, size 600/1200 px)
- **Download both stand versions** does white + black in one click
- Filenames carry the style: `qr_<label>_<id>_black-stand_<created-date>.png`

**3. Editor prefill**
When a saved code with a default style is added to a canvas via QRPanel, the style controls prefill from it (still overridable per-design, since the stand colour on canvas decides).

### Data model
```sql
alter table qr_codes add column default_style jsonb;
-- e.g. {"styleId":"rounded","fg":"#fff6ea","bg":"#000000","transparent":false,"ec":"M"}
```
Null = plain (all existing codes render exactly as before). `POST /api/qr` and `PATCH /api/qr/:id` accept an optional `style` field.

### Non-goals
- Changing what the QR encodes (never).
- SVG export (possible later; PNG at 1200 px covers print needs since qr-code-styling renders raster).

**Effort**: ~0.5–1 day. No dependency on auth — can ship as Phase 1b.

---

## 6d. Feature H — Order number field + unified export filenames (added 2026-07-08) — BUILT

### Order number on new designs
The ProductPicker ("New design") has an optional **Order #** field next to the client/job name. Prefilled from Formaloo when started from an order card; manual and optional from the library. Stored on the design (`designs.order_number`) and drives naming + filenames.

### One filename convention across ALL export paths
`{order#}_{Client}_{Stand|Card}[_{Front|Back}]_{YYYY-MM-DD}.{ext}` — order number omitted when absent, client falls back to the design name. Applies to: editor PDF/JPEG/TIFF/Drive exports, bulk-export zip entries. QR PNG downloads keep their existing (label/id/style/date) scheme.

---

## 6e. Feature I — See what the client sees (added 2026-07-08 per Jacques) — BUILT

### Goal
Let a designer preview the client-facing mockup view without leaving the canvas, and let anyone check the exact link a client received from the Orders tab.

### Editor: Preview button
A **Preview** button next to Approval/Save renders the live (including unsaved) canvas in mockup mode and shows it in a modal — reuses `exactFaceCanvas(entry, face.mockupTemplate || face.template)`, the exact function PDF/JPEG export and the approval page renderer both already use. One rendering code path for "what does a client ever see," reused a third time here rather than reimplemented.

### Order card: View link
Each design row shows a **View** link when it has an active (non-superseded) approval, opening `link.reviewtap.co.za/approve/<token>` in a new tab — the literal link the client received, not a facsimile.

---

## 6f. Manual order entry (added 2026-07-08 per Jacques) — BUILT

### Goal
Add an order to the pipeline that didn't come through the Formaloo form — a walk-in client, a one-off job, anything that needs to sit in Orders/Design Studio without a form submission.

### Design
New `manual_orders` table, deliberately shaped so every downstream join (status, designs, approvals — all keyed by `row_slug`) works identically whether the row_slug came from Formaloo or was typed in by hand. A shared `enrichOrder()` function in `routes/orders.js` replaces what used to be Formaloo-only enrichment logic, applied to both sources.

**"+ New order"** button on the Orders tab opens a modal: company/client name (required), order #, logo upload (own storage bucket `manual-order-logos`), Google review URL, WhatsApp/email/phone/address, and Stand/Card ordered checkboxes. Manually-entered orders get a grey "Manual" tag and their own Edit/Delete actions (Formaloo orders have neither — they're read-only at the source).

**Known scoping limit**: Formaloo orders are paginated server-side (30/page); manual orders are not (there are expected to be few), so they're shown in full on page 1 of a normal browse and always when searching, rather than being woven into Formaloo's page windows. The total count includes them, but if a user pages past page 1 without searching, manual orders already listed on page 1 don't repeat — this is a deliberate "good enough for occasional use" tradeoff, not a bug.

---

## 7. Improvement backlog (investigated)

Ranked. P1 = do with the phases above; P2 = next; P3 = when it earns its keep.

### P1 — Security & correctness (mostly covered by Feature B, listed for completeness)
- **I-1 Lock CORS + RLS + service-key split** (spec §3.4–3.5). Today the whole DB is readable by anyone with the anon key, which ships in the frontend bundle.
- **I-2 Fix silent failures**: `renameIfSaved()` swallows errors (`.catch(()=>{})`); order status updates are optimistic with no rollback or toast on failure. Apply the project's own Gotcha 12 pattern everywhere.
- **I-3 Delete dead code**: `EntryScreen.jsx`, `CompletionScreen.jsx`, `ProductNavigator.jsx`, unused `Menu.jsx` usage, `removeBg.js` route. Less surface for the next change to trip on.
- **I-4 QR delete guard**: deleting a QR code with `scan_count > 0` (or at all) likely bricks a printed card. Replace hard delete with: confirmation naming the scan count, and a soft-delete (`archived_at`) so the redirect keeps working while the code disappears from pickers. Hard delete becomes admin-only.

### P2 — Reliability & designer UX
- **I-5 Supabase Pro (or edge redirect)**: the free tier pausing is the single biggest QR-uptime risk. Either pay the $25/mo or implement the CLAUDE.md idea: mirror `id → destination` into Netlify Blobs on every QR write and serve `/r/:code` from an Edge Function with the DB as fallback. The mirror also makes redirects sub-50 ms.
- **I-6 Autosave + unsaved-changes guard**: debounce-save the canvas 30 s after last change once a design has an id; `beforeunload` + router blocker for unsaved new designs. Directly protects against the deploy-mid-session failure class (Gotcha 11).
- **I-7 Design thumbnails**: on save, render a ~400 px PNG of the canvas and store it (Supabase Storage bucket `design-thumbs`, path = design id). DesignLibrary and order cards become visual instead of text rows. Big usability win for a growing library (71 designs already).
- **I-8 Library & QR search/filter**: text search on name/label, filter by product, by creator (needs Feature C). 71 designs and 137 QR codes are already past comfortable scrolling.

### P3 — Structural / when volume justifies it
- **I-9 Asset storage**: move logo sources out of design JSONB into Supabase Storage, keep JSONB as references. Shrinks rows, enables logo reuse across designs ("brand library" per client).
- **I-10 Design versioning**: keep the last N `design` JSONB snapshots in a `design_versions` table on every PUT; one-click restore. Cheap insurance once multiple people edit shared designs.
- **I-11 Audit log**: `activity(user_id, action, entity, entity_id, at)` written by the auth middleware for writes. With Feature C in place this is ~an afternoon and answers every "who changed this destination?" question.
- **I-12 Client approval flow**: PROMOTED to Feature F (§6b) on 2026-07-07, including the GHL WhatsApp auto-send.
- **I-13 Multi-product flow** (existing TODO): guided Stand + Card sequence sharing one logo/QR set.
- **I-14 Scan analytics**: `scan_events(qr_id, at, user_agent, referer_country)` behind the existing async counter, giving per-day scan charts in the admin panel. Useful for the ReviewTap Pro pitch (show clients their tap volume).

---

## 8. Phasing & sequence

Dependencies: attribution needs auth; everything else is independent. Suggested order optimises for security first (the tool is currently public) while shipping visible wins early.

| Phase | Contents | Effort |
|---|---|---|
| **1. Foundations** | Routing (Feature A) + QR created date (Feature E) + dead-code removal (I-3) + error-handling fixes (I-2) — BUILT 2026-07-07 | ~2 days |
| **1b. QR styling** | Feature G: style picker on create, styled/preset downloads, editor prefill | 0.5–1 day |
| **2. Auth** | Feature B end-to-end incl. DB lockdown sequence, Team page, CORS (I-1) | 2–3 days |
| **3. Attribution** | Feature C + QR delete guard (I-4) + Feature H (order # field, unified filenames) | ~1 day |
| **4. Crop + context menu** | Feature D + right-click menu — BUILT 2026-07-08 | 1.5–2 days |
| **4b. Approvals** | Feature F: approval link + WhatsApp tap-to-send, GHL auto-send env-gated — BUILT 2026-07-08 | ~1.5 days |
| **4c. Preview + manual orders** | Feature I (client-view preview) + manual order entry — BUILT 2026-07-08 | — |
| **5. Hardening** | I-5 (Supabase Pro — DECLINED for now by Jacques 2026-07-08; edge redirect stays the fallback QR-uptime option), I-6 autosave, I-7 thumbnails, I-8 search | 2–3 days |

Each phase ends with the QR regression check (known code 302s, bogus code 404s) and a designer smoke test (open order → design → QR → export PDF).

### New dependencies
- `react-router-dom` (Phase 1)
- `react-easy-crop` (Phase 4)
- No new backend deps: Supabase Auth rides on the existing `@supabase/supabase-js`.

### Costs
- Supabase Pro (recommended, I-5): $25/mo. Everything else: R0.

---

## 9. Out of scope (explicitly)
- Changing the encoded QR URL format or the `/r/:code` contract in any way.
- Public/client-facing accounts (auth is for the internal team only).
- Migrating off Formaloo intake.
- A separate login username distinct from email (display name covers the need).
