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

## 5. Feature D — Logo cropping

### Goal
Crop an uploaded logo (trim whitespace, cut a lockup down to just the mark, straighten a rectangle out of a busy image) before or after placing it on the canvas, without losing the original.

### Design: crop modal on the original source (recommended over Fabric clipPath)
A dedicated crop modal using `react-easy-crop` (~10 kB, actively maintained, touch-friendly), rendering the crop to a new dataURL via an offscreen canvas. Fabric `clipPath` cropping was considered and rejected: it complicates the export pipeline (`exactFaceCanvas`), the saved-design JSON schema, and undo/redo snapshots, all of which are hard-won stable code (Gotchas 7, 9, 10, 11).

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

### Auto-send upgrade (IN scope, per Jacques 2026-07-07)
After the manual tap-to-send version works, add **Send via Reviewtap System**: the backend sends the WhatsApp message directly through the GHL (Reviewtap System) API using the client's number, so the designer never leaves the studio. Client-facing copy says "Reviewtap", never GHL. Manual wa.me flow stays as fallback.

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
| **1. Foundations** | Routing (Feature A) + QR created date (Feature E) + dead-code removal (I-3) + error-handling fixes (I-2) | ~2 days |
| **2. Auth** | Feature B end-to-end incl. DB lockdown sequence, Team page, CORS (I-1) | 2–3 days |
| **3. Attribution** | Feature C + QR delete guard (I-4) | ~1 day |
| **4. Crop** | Feature D | 1.5–2 days |
| **4b. Approvals** | Feature F: approval link + WhatsApp tap-to-send, then GHL auto-send | ~1.5 days |
| **5. Hardening** | I-5 (Supabase Pro decision or edge redirect), I-6 autosave, I-7 thumbnails, I-8 search | 2–3 days |

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
