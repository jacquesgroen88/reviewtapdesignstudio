# Order History on the Card — Spec

**Date**: 2026-07-17
**Status**: APPROVED v3, 2026-07-17. All decisions closed (§7). Ready to build (§8).
**Goal**: stop duplicate follow-ups. Any person opening an order card should see, in under two seconds, what has happened to it and whether someone already chased the client.

---

## 0. Decision 1, answered (2026-07-17)

Jacques: *"The system will be the default sending method going forward. I want communication to be present inside of GHL and not on his personal phone."*

This is a better answer than the spec anticipated, and it reshapes Half B. The draft assumed Giorgio's out-of-system chases were a fact to be worked around, and proposed a "Log a follow-up" button to record them after the fact. Jacques's answer instead **removes the out-of-system path**. Closing the leak beats instrumenting it: if every send goes through GHL, every send self-logs, and the card history becomes true by construction rather than by everyone remembering to press a button.

Consequences:
- **GHL send becomes the primary action** in both share modals. The `wa.me` button demotes to a fallback.
- **The "Log a follow-up" button drops to a minor fallback**, not a headline feature. It is still needed for phone calls and email, and during the transition, but it is no longer load-bearing. Adoption risk (old §6) largely goes away.
- **`wa.me` clicks become a leak signal, not a send record.** See §3a.
- Half A (the timeline) is now the main deliverable, because Half B is solved by routing rather than recording.

---

## 1. The actual problem

Jacques's words: *"We don't want to duplicate efforts and I'm unsure which ones to follow up because Giorgio has been following up manually too."*

Note what that sentence is really asking for. A per-card timeline of in-app clicks is the *requested* feature, but on its own it will **not** solve the stated problem, because Giorgio's follow-ups happen on his own phone and never touch the studio. A history that only records button clicks will confidently show "no follow-up sent" on an order Giorgio chased three times yesterday, and the duplicate call gets made anyway.

So this spec has two halves:
- **Half A (requested)**: surface the history that already exists, per card.
- **Half B (required for the goal)**: make out-of-system follow-ups recordable, and make the card answer "who last touched this client, and when" rather than only "what buttons were pressed".

Half A without Half B is a nice audit trail that leaves the original problem intact.

---

## 2. What already exists (verified against live data, 2026-07-17)

Good news: most of the plumbing is built. `activity_log` (Feature K, added 2026-07-09) is live with 234 rows.

- Table: `activity_log(id, created_at, actor_type, actor_id, actor_label, action, target_type, target_id, target_label, metadata)`.
- RLS deny-all, written only by the backend service role via `services/activityLog.js`. `logActivity()` is fire-and-forget and swallows its own errors.
- Indexed on `(target_type, target_id)` and `created_at DESC`. **A per-order query is already fast, no migration needed for read performance.**
- `/activity` tab (`ActivityPanel.jsx`) renders a global feed with an action-to-sentence template map that is directly reusable per card.
- 20 call sites across `approvals.js`, `designs.js`, `logoRequests.js`, `orders.js`, `qr.js`, `team.js`, `services/approvals.js`, `services/manualOrders.js`.

Live event inventory:

| Action | Rows | target_id | Order-attributable? |
|---|---|---|---|
| `order.status_changed` | 77 | row_slug | Yes |
| `approval.sent` | 50 | row_slug | Yes |
| `design.updated` | 43 | design_id | **No** |
| `design.created` | 20 | design_id | **No** |
| `qr.created` | 20 | qr id | No (not order-scoped by nature) |
| `logoRequest.sent` | 9 | row_slug | Yes |
| `approval.approved` | 5 | row_slug | Yes |
| `manualOrder.updated` / `.created` | 3 | row_slug | Yes |
| `logo.uploaded` | 2 | row_slug | Yes |
| `design.duplicated` | 1 | design_id | **No** |

---

## 3. Gaps found (these are the real work)

### G1. Design events cannot be tied to an order
Jacques asked specifically for *"design created with date and time and person"* on the card. Today `design.created` / `design.updated` / `design.duplicated` write `target_id = design_id` with `metadata = null`. Nothing in the row says which order it belonged to. 64 of the 234 rows are affected.

Fix: add `ownerSlug` to the metadata on write, and backfill historic rows by joining `designs.owner_slug`. The join is reliable because `owner_slug` is exactly the row_slug shape used everywhere else.

### G2. "Sent" does not mean sent — this is the one that causes duplicate work
`approval.sent` and `logoRequest.sent` both fire on **link creation**, not on sending:
- `routes/logoRequests.js:32` logs `logoRequest.sent` inside `POST /` (the handler that mints the token and opens the share modal).
- `routes/approvals.js:92` logs `approval.sent` inside `POST /` (same pattern).

In the UI, `OrdersPanel.requestLogoForOrder` calls `createLogoRequest` and *then* opens `LogoRequestShareModal`. So clicking "Request logo" and immediately closing the modal without sending anything writes a permanent "Giorgio requested a logo from this client" into the history. **This is worse than no history**: it actively tells you a client was contacted when they were not. Of the 50 `approval.sent` rows, we have no way to know retroactively which were really sent.

### G3. The approval GHL send logs nothing at all
`routes/approvals.js` `POST /:token/send-ghl` (line ~115) has no `logActivity` call. The logo-request equivalent (`logoRequests.js:60`) does log, with `metadata.via = 'ghl'`. So the asymmetry is exactly backwards: **opening the approval modal is logged, actually WhatsApping the client is not.**

### G4. wa.me and copy-link clicks are invisible
Both share modals offer "copy link" and a `wa.me` button. Both are pure client-side. Neither is logged. This is the path Giorgio most likely uses.

### G5. "Sent via the Reviewtap System" only means GHL accepted the enrolment
Known and already boarded as `ab092`. With workflow "Allow Re-Entry" ON this is usually fine, but the app cannot currently prove delivery. Any history line must not overclaim.

### G6. History starts 2026-07-10
The log did not exist before then. Cards for older orders will show a short or empty timeline. This is unavoidable and just needs an honest empty state, not a fake one.

### G7. Giorgio's manual follow-ups are not capturable by any of the above
Covered in §1. No amount of click logging reaches a WhatsApp he sent from his phone.

---

## 3a. The WhatsApp button timestamp (Jacques's question)

Jacques: *"He does click send on WhatsApp button to get the link which should have a time stamp at least?"*

**Yes, and it is cheap.** `LogoRequestShareModal.jsx:41` and the approval equivalent render the wa.me button as a plain `<a href={result.waUrl} target="_blank">` with no `onClick`. Adding a fire-and-forget POST on click is a few lines and cannot break the share (the anchor navigates regardless).

**But be precise about what that timestamp proves.** Clicking the button opens WhatsApp with a prefilled message. It does **not** prove a message was sent. Giorgio can close WhatsApp, edit the text, or send it to the wrong chat. The honest reading is *"Giorgio opened WhatsApp to share this link at 14:32"*, which is an intent signal, not a delivery record. It must be labelled that way on the card. Calling it "sent" would recreate exactly the G2 problem this spec exists to fix.

**And note what it is really measuring now.** Given §0, a wa.me click is a send that **bypassed GHL** and landed on a personal phone. So the timestamp's main value going forward is not "proof we contacted them", it is **a leak detector**: it tells you how often the non-GHL path is still being used, and on which orders. That is genuinely worth having during the transition, and worth reviewing in a month to decide whether the button can be removed entirely.

**Current UI pushes the wrong way.** In `LogoRequestShareModal.jsx`, the wa.me button is `btn-primary`, full-width, WhatsApp-green (line 41-45). The GHL `GhlSendConfirm` block sits *below* it (line 50-58) and only renders when `result.ghlAvailable`. The visual hierarchy actively recommends the path Jacques wants to stop. Fixing the hierarchy matters more than the timestamp does.

Actions logged:
- `approval.shared` / `logoRequest.shared`, `metadata: { channel: 'whatsapp' | 'copy' }`.
- Card sentence: *"Giorgio opened WhatsApp to share the logo link"*, styled quieter than a real send, with a subtle "outside the system" marker.

---

## 4. Proposed design

### 4.1 Backend

**New**: `GET /api/orders/:rowSlug/history`
- Returns merged, reverse-chronological events for one order.
- Query 1: `activity_log` where `target_type='order' AND target_id = :rowSlug`.
- Query 2: `activity_log` where `target_type='design' AND metadata->>'ownerSlug' = :rowSlug` (post-backfill).
- Joins `profiles.display_name` for actor names; falls back to `actor_label` (already denormalised on the row, so old entries still render).
- Response: `[{ id, at, actorType, actorLabel, action, metadata }]`.
- **Gotcha #14 applies**: register in BOTH `backend/src/index.js` and `netlify/functions/api.js`, or it 404s in production only and looks fine in every unauthenticated test.

**Changed** (fixes G2/G3):
- Rename the create-time events to `approval.link_created` and `logoRequest.link_created`.
- Add true send events: `approval.sent` and `logoRequest.sent` fire **only** from the `send-ghl` handlers and from the new share-action endpoint below.
- Add `logActivity` to `approvals.js POST /:token/send-ghl` (G3).

**New** (fixes G4): `POST /api/orders/:rowSlug/share-logged` `{ channel: 'whatsapp'|'copy', kind: 'approval'|'logo' }`, called by the share modals when the user actually clicks the wa.me or copy button. Logs `approval.shared` / `logoRequest.shared` with `metadata.channel`. Fire-and-forget, never blocks the share.

**New** (fixes G7, now a fallback per §0): `POST /api/orders/:rowSlug/note` `{ text }` → logs `order.follow_up_logged` with `metadata.text`. For phone calls and email, not the main path.

**Migration**: backfill `metadata.ownerSlug` on the 64 design rows via `designs.owner_slug`. Additive, reversible, no schema change. Existing rows keep working if it is skipped (they just stay off the card).

### 4.2 Frontend

- `components/OrderHistory.jsx`: collapsible "History" section on the order card. Collapsed by default showing a one-line summary; expands to the full timeline. Lazy-fetches on first expand so the Orders list does not fire N requests on load.
- Reuse the `SENTENCES` map from `ActivityPanel.jsx`. **Extract it to `lib/activitySentences.js`** so the two panels cannot drift. Add entries for the new actions.
- Each row: actor name, sentence, absolute timestamp on hover, relative ("3d ago") inline. Reuse `timeAgo()`, extracted alongside.
- **Summary line (this is the anti-duplicate-work feature)**: `Last contacted: Giorgio, 3d ago (WhatsApp)` or `Never contacted`. Computed from the most recent `*.sent` / `*.shared` / `order.follow_up_logged` event. This is what someone reads before deciding to chase.
- **"Log a follow-up" button** on the card. One click, optional note, writes `order.follow_up_logged`. Giorgio must be able to do this in three seconds on his phone or he will not do it.
- Honest labels: a GHL send renders as "sent via the Reviewtap System" and never as "delivered" (G5). Link creation renders as "created a link" and is visually quieter than a real send.
- Empty state for pre-10-Jul orders: "No history recorded before 10 Jul 2026" rather than an implied "nothing happened".

### 4.2a Share modal hierarchy (new, from §0)

Both `LogoRequestShareModal.jsx` and `ApprovalShareModal.jsx` invert their current layout:
- **GHL send becomes the primary action**, top of the modal, full-width, keeping the existing `GhlSendConfirm` recipient-and-number confirmation gate (it is a good gate, it stays).
- **`wa.me` demotes to a secondary link** below it, with honest framing: *"Send from your own WhatsApp instead (this will not appear in the Reviewtap System)"*. That sentence is the whole point. Giorgio should feel the tradeoff at the moment of choosing.
- **Copy-link stays** where it is. It is the genuine fallback when there is no number.
- When `ghlAvailable` is false (no phone on the order, or GHL not configured), wa.me/copy return to primary. There is no system path to prefer in that case, and blocking the share would just push the work off-platform entirely.

This is the change that actually delivers "communication present inside GHL". The timestamp only measures it.

### 4.3 "Awaiting client" filter tab (IN SCOPE, decision 2)

An eighth filter tab beside the existing seven (All orders, Awaiting Logo, Ready, Pending Approval, Approved, Print Pending, Done). This converts the history from something you look up into something that tells you who to chase.

- **Matches**: orders waiting on a client response. Status `pending_approval` (approval sent, no answer) or missing a logo with a request already out.
- **Sorted by longest-since-last-contact, descending.** The order at the top is the one most overdue a nudge. This ordering is the feature.
- **Each row shows the summary line** from §4.2: `Last contacted: Giorgio, 3d ago (Reviewtap System)`.
- **Implementation**: follows the existing `matchesFilter` pattern in `routes/orders.js`. Any filter other than `'all'` already triggers a full in-memory scan (large Formaloo batch + all manual orders), so this adds a third source: a single grouped `activity_log` query for the most recent contact event per `row_slug`. One query, not N, and the `(target_type, target_id)` index covers it.
- **Watch the count.** The `Awaiting Logo` tab shipped with a bug that counted 132 orders instead of ~30 by matching any order with no logo, including 102 Formaloo submissions that never ordered a stand or card. Verify this tab's count against real data before shipping, same as that fix required (`orderedStand || orderedCard`).

---

## 5. Out of scope
- Porting the fulfillment console (still deferred, see `2026-07-14-fulfillment-and-bgremoval-spec.md`).
- GHL delivery-receipt verification (`ab092`, separate).
- Retention or archival policy for `activity_log`.
- Backfilling any history before 2026-07-10. It does not exist.

---

## 6. Risks
- **`fulfillment_runs` RLS stays anon-open.** Untouched by this work, still tracked.
- **Renaming actions breaks the existing `/activity` feed** for the 59 historic `approval.sent` / `logoRequest.sent` rows unless the sentence map keeps handling the old names. Keep both keys mapped; never rewrite history rows.
- **Write volume**: logging every share click adds rows. At current volume (234 rows in 7 days) this is negligible.
- ~~**Adoption risk on the follow-up button.**~~ Largely resolved by §0: routing sends through GHL means they self-log, rather than depending on anyone remembering to record them. Residual risk moves to habit (decision 5).
- **The wa.me button cannot be fully instrumented.** Its timestamp records intent to share, never delivery (§3a). No amount of code fixes this, which is itself an argument for the GHL path.

---

## 7. Decisions — ALL CLOSED 2026-07-17

1. **Does Giorgio follow up from the studio or his own phone?** → **Neither going forward.** GHL is the default send path, comms live in GHL. See §0.
2. **"Awaiting client" tab now, or timeline only?** → **Both, in the first build.** The tab is what answers the original question ("which ones do I follow up") without opening cards one by one. §4.3 is now in scope, not optional.
3. **Rename `approval.sent` → `approval.link_created`?** → **Yes.** Going forward, `*.sent` means the client was actually messaged. The 50 historic rows render as "created a link", with an explicit note that pre-17-Jul entries may or may not have been sent. Never rewrite the historic rows.
4. **History visible to designers or admin only?** → **All team members.** Giorgio is the person most likely to duplicate a follow-up; hiding it from him would defeat the feature. No role check needed on the endpoint beyond the existing `requireAuth`.
5. **Does Giorgio know GHL is now the default?** → **Yes, confirmed by Jacques.** The UI change (§4.2a) reinforces a decision he already knows about, rather than trying to carry it alone.
6. **Keep or remove the wa.me button?** → **Keep, demoted and logged** (§3a, §4.2a). Review the `*.shared` counts in roughly one month (target: mid-Aug 2026). If it is still used heavily, that is evidence of a real gap in the GHL path (most likely orders with no phone on file), not a discipline problem. Decide removal then, on data.

---

## 8. Build order (approved)

1. **Backfill migration**: `metadata.ownerSlug` on the 64 design rows, joined from `designs.owner_slug`. Dry-run and eyeball the join against real data before writing (G1). Additive and reversible.
2. **Backend**: `GET /api/orders/:rowSlug/history`; event corrections (G2 rename, G3 missing approval-GHL log); new `*.shared` and `order.follow_up_logged` endpoints. **Register every new router in BOTH `backend/src/index.js` and `netlify/functions/api.js`** (Gotcha #14).
3. **Extract** `lib/activitySentences.js` (the `SENTENCES` map + `timeAgo`) and refactor `ActivityPanel.jsx` onto it. No behaviour change; verify the existing `/activity` feed still renders identically before moving on. Keep the old action keys mapped so historic rows survive the rename.
4. **`OrderHistory.jsx`** + the `Last contacted:` summary line on the card. Lazy-fetch on first expand so the Orders list does not fire N requests on load.
5. **Share modal hierarchy flip** (§4.2a) + share-click logging + the follow-up-note fallback.
6. **"Awaiting client" tab** (§4.3). Verify the count against real data.
7. **Verify in production with a real authenticated request** on a real order with real history (Gotcha #14: an unauthenticated test returns 401 from `requireAuth` before Express ever looks for the route, so a missing route looks identical to a working one). Confirm `/r/:code` still 302s if anything touched `netlify.toml`.

### Verification notes
- The app is auth-walled, so headless UI checks are limited. Expect to drive the modal flip and the follow-up button by hand, or have Jacques eyeball them on a real order (same constraint as the bg-removal slider, still untested from the 15 Jul session).
- Test the neighbouring surface, not just the changed line. The `Awaiting Logo` count bug was found while testing search, not by a symptom report.
