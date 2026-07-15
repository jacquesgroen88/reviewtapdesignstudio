# Design Studio - Fulfillment Tab + Background-Removal Rebuild (Spec)

**Date:** 2026-07-14
**App:** ReviewTap Design Studio (`link.reviewtap.co.za`, repo `jacquesgroen88/reviewtapdesignstudio`)
**Author:** Claude (context-gathering + spec)
**Status:** Draft for Jacques's review - no code written yet

---

## Hardened spec - Fulfillment tab + BG removal (pressure-tested 2026-07-14)
- **Core bet:** worth the hours only if the pain is real and the BG fix matches the actual logos.
- **Verdict after hardening:** SPLIT. BG removal proceeds (validated by a real-logo test, below). Full
  fulfillment port is KILLED for now, downgraded to "cheap tidy" (nav links), because Jacques confirmed the
  3-tool split is "mildly untidy," not friction, and RT is listed for sale.
- **Decided:**
  - BG removal is a real, frequent, witnessed pain → build. Validated against 12 real intake logos.
  - Fulfillment tooling is RT's own and its Google key is on **ReviewTap's** Google project (per the
    console's own text) → welding into the RT app is fine, NOT a JCE tangle. Objection withdrawn.
  - Fulfillment consolidation is untidy-not-blocking → **no full port.** Shipped cheap-tidy nav links.
- **Residual risks accepted:** cheap-tidy leaves `fulfillment_runs` on the anon browser key (open-RLS gap
  stays until a real port); the standalone tools stay on their own Netlify sites (their domain-locked Google
  keys keep working — which is *why* cheap-tidy needs no key change).
- **Kill criteria:** if the cheap nav links remove the annoyance, the full port stays dead. If real photo
  logos ever dominate intake, re-open §B for BiRefNet.

### Real-logo test (ran 2026-07-14, 12 most-recent Formaloo intake logos)
Pulled via the Formaloo API + analysed corner/alpha stats with sharp, then eyeballed the edge cases.
- **5 / 12 were already-transparent PNGs** (Skinstitute, Funnah Medix, Witsieshoek, Your Pal, one unnamed) -
  they need a **whitespace trim, not a model.** Running the current @imgly AI on these *degrades* a clean
  cutout - a likely real cause of the "doesn't work well" complaint.
- **6 / 12 were flat logos on white/solid** (OGA, King Chicken on black, Cobrel, Auto Comms, Umndeni,
  iThreesixty) - **deterministic knockout wins.** (iThreesixty only looked "complex" to the stats because of
  a faint JPEG edge vignette; by eye it is flat-on-white.)
- **1 / 12 was a true photo/illustration** (Ourief - a watercolour building crest) - the only real AI case,
  and arguably a place-as-is asset you would not knockout at all.
- **Conclusion: 11 / 12 need no AI.** Confirms **Option 2**, plus a required new behaviour: **detect an
  existing alpha channel and trim instead of running any model.** AI is the rare fallback.

### Shipped this session (cheap tidy)
- `frontend/src/App.jsx`: added two external nav tabs - **Fulfillment** (→ jcereports fulfillment console)
  and **Review link** (→ reviewtaplink.netlify.app), via a new `ExtNavTab` component (opens in a new tab).
  Tools stay on their own sites so their domain-locked Google keys keep working; **no P0 key change needed.**
  Frontend build verified clean. Not yet deployed (push `master` to ship).

---

## 0. Goal (what Jacques asked for)

1. **Fold the fulfillment tooling into the app.** Bring the standalone **Fulfillment Console**
   (`jcereports.netlify.app/.../2026-06-11-fulfillment-console/`) and the standalone **Review Link
   Generator** (`reviewtaplink.netlify.app`) into `link.reviewtap.co.za` as a proper **Fulfillment tab**,
   so the whole order → design → encode → ship loop lives behind one login instead of three separate URLs.
2. **Replace the background-removal tool.** The in-editor "Remove background" toggle "doesn't work too
   well." Find a better solution (open-source preferred), spec the swap.

Both are additive to an app with a **sacred QR-uptime rule** (printed NFC devices in the field hit
`/r/:code`). Neither feature touches that path - see §A.6 safety analysis.

---

## 1. Current state - the three tools, inventoried

### 1a. Fulfillment Console (`Reviewtap/Reviewtap Fufillment/reviewtap-fulfillment.html`, 983 lines)
Single vanilla-JS HTML file, currently published on `jcereports.netlify.app`. It is the **Track-1
batch engine** (standard review devices - see the fulfillment-tracks memory). What it does:

- **Input:** drop a Shopify **packing-slip PDF** (one order per page) or a **CSV** export.
- **PDF parsing** (`parsePDF`/`parsePage`/`buildLines`): reconstructs text lines from pdf.js text items,
  extracts order #, date, ship-to block, and line items (stand/card, white/black, custom-branded,
  Google/Tripadvisor/AutoTrader, quantities). This logic is **validated against real ReviewTap slips**
  and is the crown-jewel code to preserve.
- **Google match** (`lookupOrder`/`searchPlaces`/`applyMatch`): for each order, searches Google Places
  by `business + city + province + "South Africa"`, scores candidates with a token-similarity function
  (`sim`), and produces a **direct write-a-review link** `search.google.com/local/writereview?placeid=<id>`.
  Confidence-scored (strong / verify / not-found). Uses **Places API (New)** with automatic fallback to
  legacy Places. Manual override: pick from candidate dropdown or paste a Place ID / review URL.
- **Not-found path:** a pre-written **WhatsApp message** (`waMessage`/`waLink`) that walks the client
  through creating a Google Business Profile, addressed from the signed-in operator's name.
- **4-step checklist per order:** Link → Encoded → Tested → Packed, with a progress bar.
- **Persistence:** everything in `localStorage` **plus** a shared Supabase table `fulfillment_runs`
  (save/open/delete named runs, "shared across devices"). Uses the Supabase **publishable key directly
  in the browser**.
- **Export:** "Copy all review links", "Export for Claude" (plaintext batch dump), print.

**Keys / infra it currently depends on:**
- Google Maps JS key `AIzaSyCYUFTODezWI6KwvMjWzBet1Y_03QfRkec` - **domain-locked to `jcereports.netlify.app`**.
  Moving the page to `link.reviewtap.co.za` breaks lookups until the key's allowed-referrers list is
  updated (or we go server-side - see §A.3).
- Supabase project `urwqhjcocnclvhomuksm` (**same project as the Design Studio**) - table `fulfillment_runs`,
  publishable key `sb_publishable_NIw8...`. Per the studio-v2 memory, `fulfillment_runs` is the **one table
  whose RLS is still anon-open** ("migrate before locking"). Folding this into the authed app is the natural
  moment to close that gap.
- pdf.js + supabase-js from CDN.

### 1b. Review Link Generator (`Reviewtap/Reviewtap Link Generator/index.html`, 460 lines)
Single vanilla-JS HTML file on `reviewtaplink.netlify.app`. **A strict subset of the console**: type a
business name → Google Places autocomplete → produces the same `writereview?placeid=` link, copy button.
No PDF, no batch, no checklist. Uses a **different, older** Google key `AIzaSyANTsMrAJ...` and the legacy
`AutocompleteService`/`PlacesService`. **Recommendation: retire it** - it is fully absorbed by a
"single-business quick lookup" mode inside the new tab (§A.5).

### 1c. Current background removal (in the editor)
- **Package:** `@imgly/background-removal@^1.7.0` (`frontend/package.json`), ~24 MB WASM, lazy-loaded.
- **Wiring:** `lib/logoPipeline.js` `removeBg()` → `@imgly` `removeBackground(blob)`; toggled per-logo in
  `LogoPanel.jsx` (and from the canvas right-click menu). Pipeline composes bg-removal + crop from an
  uncropped cache so toggling one doesn't discard the other. Model is **preloaded on mount** to warm the cache.
- **Model:** `@imgly` defaults to **`isnet_fp16`** (ISNet, half-precision, ~80 MB medium tier). ISNet is a
  **salient-object segmentation** model - trained to cut a photographic *subject* out of a scene.

---

## PART A - Fulfillment Tab

### A.1 Recommended architecture: port to an authed React route (not iframe)

Add a **`/fulfillment`** route + nav tab (between "QR Codes" and "Activity" in `App.jsx`), rendered by a
new `FulfillmentPanel.jsx`. **Do not** iframe or drop the raw HTML into `frontend/public/` - that would
leave it a public, unauthenticated silo on the domain and keep the data disconnected from Orders.

**Why a real port, despite the effort:**
- **One login, one design system.** The console's dark-GitHub palette becomes the studio's light/orange
  brand. Team already lives in this app.
- **The order number is the join key across the whole business** (per the fulfillment-tracks memory:
  "the single key tying Shopify → design name → printer's mark → packed bag → waybill"). Inside the app we
  can **link a fulfillment run's orders to their Orders-tab rows and their designs** - e.g. a packed order
  shows its approved design; a custom order in the batch links straight to its artwork. That cross-link is
  the real prize and is impossible while the console is a separate URL.
- **Closes the open-RLS gap** on `fulfillment_runs` (§A.4).
- **Activity-log integration** (who ran/saved which batch) for free.

**Keep the proven engine intact.** The parsing/matching/WhatsApp logic is framework-agnostic pure
functions. Lift them **near-verbatim** into `frontend/src/lib/fulfillment.js`:
`norm`, `tokens`, `sim`, `placeKey`, `buildLines`, `lineFull`/`lineLeft`, `classifyItem`, `parsePage`,
`parsePDF`, `parseCSV`, `waNumber`/`waMessage`/`waLink`, `REVIEW`. Only the **render + persistence + Places
transport** layers get rewritten for React. This de-risks the port: the battle-tested code that reads real
slips is copied, not reinvented.

**Static-import discipline (Gotcha #11).** `pdfjs-dist` is business-critical to this tab and must be a
**static import** in the bundle, not `await import()` - a mid-session deploy would otherwise 404 the chunk.
(Model-sized deps like background-removal are the only allowed lazy imports.) Add `pdfjs-dist` to
`frontend/package.json` and self-host the worker rather than the CDN.

### A.2 UI shape

`FulfillmentPanel.jsx` - three modes in one tab:
1. **Batch run** (the console): start screen (drop PDF/CSV | continue previous run) → order cards with
   items, Google-link block, match tools, 4-step checklist, progress bar, save/open runs. Straight port.
2. **Quick link** (absorbs the link generator): a single search box → autocomplete → one review link + copy.
   This replaces `reviewtaplink.netlify.app` entirely.
3. **Previous runs**: list from `fulfillment_runs` via the authed API.

Reuse studio primitives: `Menu.jsx`, `card`/`btn-*`/`brand-*` Tailwind classes, the existing toast/error
patterns, and the §12 "every async handler has a catch that surfaces the error" rule.

### A.3 Google Places - go server-side (decision point)

The console calls Google Places **from the browser** with a referrer-locked key. Two ways to make it work
on the new domain:

- **Option 1 - keep browser-side, just re-allowlist.** Add `link.reviewtap.co.za` (and `localhost` for dev)
  to the key's HTTP-referrer allowlist in Google Cloud Console. Zero backend work. *Jacques action.* Keeps
  the New-vs-legacy Places fallback complexity in the client and exposes the key in the bundle (it is
  referrer-locked, so low risk, but still).
- **Option 2 - route lookups through the backend (recommended).** New authed endpoints
  `GET /api/fulfillment/places?q=` and `/place/:id` in `backend/src/` proxy Google Places (server key,
  IP/none-restricted, never shipped to the browser). Cleaner: one Places code path, key hidden, and it rides
  the existing auth. **Remember Gotcha #14** - any new `/api/*` router must be mounted in **both**
  `backend/src/index.js` **and** `netlify/functions/api.js` or it 404s only in prod.

Recommendation: **Option 2.** It's ~an hour more work and removes a whole class of key/quirk problems. (The
Places responses are plain JSON, so no binary/serverless-http corruption concern - Gotcha #1 doesn't apply.)

### A.4 Persistence - move `fulfillment_runs` behind the API and lock RLS

- Add authed routes: `GET/POST/DELETE /api/fulfillment/runs` (list/save/delete), reading/writing
  `fulfillment_runs` with the **service-role key** server-side (same pattern as every other locked table).
- Then **flip `fulfillment_runs` RLS to deny-all** - closing the last anon-open table noted in the
  studio-v2 memory. Do this **after** the authed path is verified live (same sequencing discipline as
  DEPLOY-PHASE2.md's RLS flip).
- Log save/open to the activity feed via the existing `activityLog.js`.

### A.5 Retire the standalone tools (decision ripple)

Once the tab is live and verified:
- **Link generator** (`reviewtaplink.netlify.app`): retire - fully absorbed by Quick-link mode.
- **Fulfillment console** on `jcereports.netlify.app`: keep as a **read-only fallback** for one cycle, then
  retire the public copy. Update `reviewtap-fulfillment-tracks` memory + the two SOP files
  (`FULFILLMENT-SOP.md/.html`) to point at the in-app tab. (Per the org "decision ripple" rule, grep for
  both URLs across Skills/, memory, and CLAUDE.md files in the same session that ships this.)

### A.6 QR-uptime safety analysis (must-read before building)

This feature is **safe for the sacred `/r/:code` path**, but state it explicitly:
- It adds a **new SPA route** and **new `/api/fulfillment/*` routers** only. It does **not** touch
  `redirect.js`, `keepalive.js`, the `qr_codes` table, or the `/r/*`, `/approve/*`, `/logo-request/*`
  redirect rules in `netlify.toml`.
- The only `netlify.toml` change, if any, is **none** - new API routes ride the existing `/api/*` rule.
  (If a new dedicated redirect is ever added, it must go **above** the SPA fallback and be smoke-tested
  per the sacred rules.)
- Post-deploy smoke test still runs the standard
  `curl -sI https://link.reviewtap.co.za/r/<known-code>` (302) + bogus code (404) check, because we're
  touching `api.js`.

### A.7 Phasing

- **Phase 1 (core value):** `/fulfillment` route + tab; port batch engine (PDF/CSV parse, checklist,
  progress, copy/print) into React with `lib/fulfillment.js`; Quick-link mode; Places via backend (§A.3
  Option 2); brand restyle. Google key re-allowlist as the fast interim if backend Places slips.
- **Phase 2 (data unification):** `fulfillment_runs` behind authed API + RLS lock; activity logging;
  **link batch orders to Orders-tab rows + designs by order number** (the real payoff); retire standalone
  tools + ripple the docs.

---

## PART B - Background-Removal Rebuild

### B.1 Root-cause hypothesis (why it "doesn't work well")

The tool is being asked to do the **wrong kind of job with the wrong kind of model.** ReviewTap logos are
overwhelmingly **flat graphics / wordmarks on solid (usually white) backgrounds**. `@imgly`'s ISNet is a
**salient-object segmentation** network trained on *photographic subjects*. On a flat logo it tends to
either keep the whole rectangle, hallucinate a soft matte, or eat thin strokes and letter counters - exactly
the "doesn't work too well" symptom. Throwing a *bigger AI model* at this only partly helps, because the
task for most logos isn't "find the subject," it's "knock out the flat background color."

### B.2 Recommended solution: a tiered pipeline, not a single model swap

Replace the single `removeBg()` with **two mechanisms**, defaulting to the right one for logos:

**Tier 1 - Deterministic color/white knockout (new default for logos).**
A pure-canvas flood-fill from the four corners: sample the corner color, remove every connected pixel within
a tolerance, anti-alias/feather the boundary. Instant, offline, private, **zero licensing risk**, and
*perfect* for the logo-on-white / logo-on-solid case that is most of ReviewTap's intake. Expose a small
**tolerance slider** + optional "feather edge" so a designer can dial it in. This single addition likely
resolves the majority of complaints on its own.

**Tier 2 - AI segmentation (for photographic / complex-background logos).**
Keep an AI path for the minority of logos that are photos or sit on gradients. Options, cheapest first:
- **B.2a** Keep `@imgly` but pin it explicitly to `isnet_fp16` (cleaner edges) + latest version, and add a
  **Fast (quint8) / Best (fp16)** toggle. Lowest effort; modest ceiling.
- **B.2b** Swap the AI engine to **BiRefNet via `@huggingface/transformers` (transformers.js)** running ONNX
  in-browser. Meaningfully better hair/edge quality than ISNet, still 100% local and free. **BiRefNet is the
  best *commercially-usable* local model** (see licensing, B.3).
- **B.2c** (only if browser perf/quality is still short) A **hosted best-in-class endpoint** (fal.ai /
  Replicate BiRefNet, or Bria's licensed RMBG-2.0 API) called from the backend, pay-per-image. Best quality,
  but adds cost + an external dependency and is overkill for flat logos.

**Recommended:** ship **Tier 1 + B.2a** first (fixes most pain, no new deps, no license risk), then
**evaluate B.2b (BiRefNet)** against a folder of *real ReviewTap logos* before committing to it. Only reach
for B.2c if a paid quality tier is ever justified.

### B.3 Licensing - a real constraint (ReviewTap is a commercial product being sold)

This matters because RT is commercial and mid-exit; shipping non-commercial model weights is a liability.

| Model / lib | Quality | Runs | License for commercial use |
|---|---|---|---|
| **Deterministic knockout** (Tier 1) | Perfect for flat/solid bg; N/A for photos | Browser | None - it's our own code ✅ |
| **@imgly `isnet_fp16`** (current) | OK; weak on flat logos | Browser (WASM) | Free to use as shipped by imgly ✅ |
| **BiRefNet** (via transformers.js) | High (SOTA-class edges) | Browser (ONNX) or server | MIT code; research-friendly weights - **commercially usable** ✅ |
| **RMBG-1.4 / RMBG-2.0** (Bria) | Highest (RMBG-2.0 benchmarks ~90%) | Browser/server | **Non-commercial weights; commercial needs a paid Bria agreement** ⚠️ |
| **rembg** (Python, U2Net/ISNet/BiRefNet) | High | Server only (Python) | Depends on chosen model; heavy for Netlify Functions |

**Rule:** do **not** ship RMBG-1.4/2.0 *weights* in the product without a Bria license. If a hosted "best"
tier is ever wanted, use Bria's **licensed API** (they permit commercial use via API) or a BiRefNet endpoint.

### B.4 Notes / constraints

- **Keep it local by default** - Jacques's stated preference ("something open source"), and it preserves the
  current free + private property (no client logos leaving the browser).
- **Preserve the existing pipeline composition** in `logoPipeline.js` (bg-removal ⇄ crop compose from the
  uncropped cache). The Tier-1 knockout slots in as a new `removeBg`-equivalent that returns a data URL, so
  `LogoPanel.jsx` / the right-click menu wiring barely changes - swap the engine, keep the UX contract
  (`bgRemoved` flag, processing spinner).
- **`@imgly`/transformers.js stay lazy imports** (model-sized) - never promote them to static (Gotcha #11);
  the Tier-1 knockout, being tiny pure-canvas code, **can** be static.
- **Print quality:** operate at the logo's native resolution (the pipeline already crops at source res), and
  output PNG with alpha so the stand/card export stays 300 DPI.

### B.5 Phasing

- **Phase 1:** Tier-1 deterministic knockout as the default "Remove background" (tolerance + feather);
  relabel the current AI toggle as "AI cutout (photo logos)", pin `isnet_fp16`, add Fast/Best. Test on real
  logos.
- **Phase 2 (conditional):** if AI quality still short on real photo-logos, evaluate + swap to BiRefNet
  (transformers.js). Consider a paid hosted tier (B.2c) only if a genuine need appears.

---

## 2. Decisions - LOCKED (2026-07-14)

1. **Google Places transport:** **re-allowlist the existing browser key** (fastest). Stay browser-side; do
   NOT build the backend Places proxy. → **Jacques action:** in Google Cloud Console, add
   `link.reviewtap.co.za/*` and `http://localhost:3000/*` to the HTTP-referrer allowlist on key
   `AIzaSyCYUFTODezWI6KwvMjWzBet1Y_03QfRkec` (Maps JavaScript API + Places API New must stay enabled). This
   supersedes §A.3's "Option 2 recommended" - we take **§A.3 Option 1**.
2. **Standalone tools:** **retire both.** `reviewtaplink.netlify.app` absorbed into Quick-link mode; public
   console sunset after one verified cycle. (§A.5 as written.)
3. **Background removal:** **Option 2 - knockout default + keep `@imgly` AI as fallback** (pin `isnet_fp16`,
   Fast/Best toggle). Local/free only, no paid tier. BiRefNet (B.2b) is a documented future upgrade, not in
   scope now. (§B.5 Phase 1 only.)
4. **Fulfillment tab access:** **all signed-in team** (not admin-only). Route sits inside the normal auth
   gate, no `requireAdmin`.

---

## 3. BUILD PLAN

Three shippable milestones. Each ends with a deploy + smoke test. Ordered so the lowest-risk, highest-value
work lands first. Background removal (M3) is independent of the fulfillment work (M1-M2) and can be built in
parallel or first if preferred.

### Pre-work (Jacques, before M1 deploy is useful)
- [ ] **P0.** Re-allowlist the Google key (decision 1 above). Until this is done, batch lookups + Quick-link
  return zero results on the live domain. Local dev works once `localhost:3000` is on the list.

### Milestone 1 - Fulfillment tab, batch engine + Quick link (Part A Phase 1)
Goal: the console + link generator, working inside the authed app. ~1 day.

1. [ ] **Deps:** add `pdfjs-dist` to `frontend/package.json`. Import it **statically** in the fulfillment
   lib (Gotcha #11 - a designer must never lose a run to a chunk-hash 404). Self-host the pdf worker from the
   package (`pdfjs-dist/build/pdf.worker`), not the CDN.
2. [ ] **Engine lib:** create `frontend/src/lib/fulfillment.js`. Copy near-verbatim from
   `Reviewtap Fufillment/reviewtap-fulfillment.html`: `norm`, `tokens`, `sim`, `placeKey`, `cssId`, `esc`,
   `buildLines`, `lineFull`, `lineLeft`, `classifyItem`, `parsePage`, `parsePDF`, `parseCSVRows`, `parseCSV`,
   `waNumber`, `waMessage`, `waLink`, `REVIEW`, and the Places layer (`loadGoogle`, `searchPlaces` with the
   New→legacy fallback, `lookupOrder`, `applyMatch`). Export as pure functions; no DOM writes inside them.
   Feed the operator name from the signed-in `profile.display_name` instead of the console's localStorage
   `senderName`.
3. [ ] **Component:** `frontend/src/components/FulfillmentPanel.jsx` with a mode switcher:
   **Batch run** | **Quick link** | **Previous runs**.
   - *Batch run:* dropzone (PDF/CSV) → parse → order-card list (items, Google-link block with
     confidence + copy + "Open & test", match-tools dropdown / paste-Place-ID, WhatsApp-not-found button),
     4-step checklist (Link/Encoded/Tested/Packed) with progress bar, Copy-all-links, Print. Restyle to the
     studio light/orange brand (map the console's CSS vars → Tailwind `brand-*`/`card`/`btn-*`).
   - *Quick link:* single search box → Places autocomplete → one review link + copy. Replaces the link
     generator.
   - Per-order checklist + run state persists to `localStorage` for now (matches current behaviour; cloud
     runs come in M2).
   - Every async handler gets a `catch` that surfaces the error (Gotcha #12).
4. [ ] **Route + nav:** in `App.jsx`, add `<Route path="/fulfillment" element={<FulfillmentPanel/>} />` and a
   `<NavTab to="/fulfillment">` between QR Codes and Activity. No `requireAdmin` (decision 4). Add it to the
   `guardedNavClick` set and the 404 fallback links.
5. [ ] **Verify (browser preview):** load `/fulfillment`; drop the known-good slip
   `packing_slips_20260618T072046Z.pdf` (32 orders, #1682-#1747) → confirm 32 cards parse; run a lookup →
   confirm review links resolve; Quick-link a known business (King Chicken) → confirm the link. Check console
   for errors.
6. [ ] **Deploy** (push `master`) → **smoke test the sacred path**: `curl -sI .../r/<known-code>` = 302,
   bogus code = 404. Confirm `/fulfillment` loads for a signed-in non-admin.

### Milestone 2 - Cloud runs behind auth + data unification (Part A Phase 2)
Goal: shared runs move off the anon browser key; batch orders link to Orders + designs. ~half day.

7. [ ] **Runs API:** add `routes/fulfillment.js` - `GET/POST/DELETE /api/fulfillment/runs` reading/writing
   `fulfillment_runs` with the **service-role key** server-side. **Mount in BOTH `backend/src/index.js` AND
   `netlify/functions/api.js`** (Gotcha #14) and verify with an *authenticated* request, not just an
   unauthed 401.
8. [ ] **Wire the panel** to the runs API (list/save/open/delete), replacing the direct browser Supabase
   call. Log save/open via `services/activityLog.js`.
9. [ ] **RLS lock:** once the authed path is verified live, flip `fulfillment_runs` RLS to deny-all
   (closes the last anon-open table). Sequence exactly like DEPLOY-PHASE2.md's flip - verify first, flip
   after.
10. [ ] **Order linking (the payoff):** in each batch order card, match `order.no` against the Orders tab
    (Formaloo/manual) and, when found, show a link to that order + its designs. Reuse the existing orders
    lookup; the order number is the join key.
11. [ ] **Deploy + smoke test** (touches `api.js` → re-run the `/r/` 302/404 check).

### Milestone 3 - Background removal, Option 2 (Part B Phase 1)
Goal: fix the "doesn't work well" complaint. Independent of M1-M2. ~half day.

11b. [ ] **Alpha-first guard (from the real-logo test):** before any processing, detect an existing alpha
    channel (sample the image; if a meaningful fraction of border/interior pixels are already transparent,
    it's a transparent PNG). If so, **skip the model entirely** and offer **trim-whitespace** instead - the
    AI degrades already-clean cutouts, and ~5/12 real logos are this case.
12. [ ] **Knockout engine:** in `lib/logoPipeline.js`, add `knockoutBackground(imageSrc, {tolerance, feather})`
    - load to canvas at native res, sample the four corners, BFS/flood-fill connected pixels within
    `tolerance` of the corner colour to alpha 0, feather the boundary a px or two, return a PNG data URL.
    Tiny + pure-canvas → **static import** (no chunk-404 risk). Keep the bg-removed ⇄ crop composition
    (compose from the uncropped cache, as today).
13. [ ] **Rewire `LogoPanel.jsx`** (and the canvas right-click menu): make **"Remove background" = knockout**
    the default, with a **tolerance slider + feather** control. Relabel the existing AI toggle
    **"AI cutout (photo logos)"**. Keep the `bgRemoved` flag + processing-spinner UX contract so the parent
    (`DesignCanvas`) wiring barely changes.
14. [ ] **Pin the AI model:** in `removeBg()`, pass `{ model: 'isnet_fp16' }` explicitly and bump
    `@imgly/background-removal` to latest 1.x. Add a **Fast (quint8) / Best (fp16)** switch. Keep it a **lazy
    import**.
15. [ ] **Verify on real logos:** run knockout + AI over a handful of actual ReviewTap client logos (flat
    logo-on-white AND at least one photographic one). Confirm knockout cleanly clears white without eating
    strokes, and export stays 300 DPI PNG-with-alpha.
16. [ ] **Deploy** (frontend-only, QR-safe, but still run the `/r/` check per rule 4).

### Post-ship (same session as M2 ships - decision-ripple rule)
17. [ ] Update `reviewtap-fulfillment-tracks` + `reviewtap-design-studio-v2` memories and the two SOP files
    (`FULFILLMENT-SOP.md/.html`) to point at the in-app tab. Grep `reviewtaplink.netlify.app` +
    `fulfillment-console` across Skills/, memory, and CLAUDE.md files; update every hit.
18. [ ] Retire `reviewtaplink.netlify.app`; sunset the public console after one verified cycle.
19. [ ] Add a Design-Studio `CLAUDE.md` section for the Fulfillment tab + the new bg-removal pipeline.

### Documented future upgrade (NOT in scope now)
- **BiRefNet AI engine (B.2b)** via transformers.js if photographic logos become common. Contained swap of
  the AI tier only; knockout default stays. Re-open this spec's §B.2/§B.3 before building.

---

## Sources (background-removal research)
- [@imgly/background-removal - npm](https://www.npmjs.com/package/@imgly/background-removal)
- [briaai/RMBG-2.0 - Hugging Face (license terms)](https://huggingface.co/briaai/RMBG-2.0)
- [Bria RMBG-2.0 benchmark blog](https://blog.bria.ai/benchmarking-blog/brias-new-state-of-the-art-remove-background-2.0-outperforms-the-competition)
- [ComfyUI-RMBG (model landscape: RMBG-2.0/BiRefNet/BEN2/INSPYRENET)](https://github.com/1038lab/ComfyUI-RMBG)
