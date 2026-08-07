# Console improvement program — agent coordination file

Working doc for the multi-agent build. Each wave: implement → `npm run build` passes → commit → push to `main` (auto-deploys) → verify deploy READY → tick your boxes here (commit the tick too) → report.

## Hard rules (every agent)
- **NEVER touch the `eco-mech` client record** (real client). Test with new clients (never reserved slugs: console/dev/www/api/…); DELETE test clients when done (the delete endpoint archives + removes domain).
- Read `CLAUDE.md`-style conventions from the code itself; match existing patterns (globals.css tokens, `.card`, `.btn`, q-* form classes, ConfirmDialog for confirmations, no browser alert/confirm/prompt).
- **No "Claude"/AI mentions in any UI or client-facing email.** Client emails only on explicit operator action.
- Light+dark theme via existing tokens; mobile-first (no horizontal overflow at 390px; never inline maxWidth overriding responsive caps — use classes).
- Secrets: `.env.local` (strip quotes when parsing). PATH can corrupt: use `/usr/bin/curl`, `/usr/bin/python3` or export PATH first.
- Deploy check: poll `https://api.vercel.com/v6/deployments?projectId=prj_pK8jvT3YlYlOpMa3CezuzpDIOTIG&teamId=team_koRXXg51bnoBmXpHCrRzkK7S&limit=1` with `Authorization: Bearer $VERCEL_TOKEN`.
- **Authed testing without OTP**: craft a session cookie locally — token = `{abs}.{idle}.{sid}.{sig}`, sig = base64url(HMAC-SHA256(SESSION_SECRET, "lum-admin.{abs}.{idle}.{sid}")), abs=now+24h ms, idle=now+30min ms, sid=16 lowercase hex chars (8 random bytes; Wave 3 session registry — a crafted sid won't appear in the dashboard Sessions card unless registered, and must not be on the revoked list). Send as `Cookie: lum_session=<token>`. (Python hmac works; urllib is blocked by api.resend.com's Cloudflare — use curl there.)
- Store: **Cloudflare R2 (S3 API)** behind `lib/store.ts` — use its helpers (`readState/writeState/clearState`, `putAsset/fetchAsset/deleteAssets`); NEVER hand-roll an S3 command for state. State lives on FIXED keys (one GET to read, one PUT to overwrite — no listing, no versions: listing per read is what exhausted the old store's quota); assets get unique keys because records point at them. Assets are referenced as `/api/asset/<key>` and MUST be read back with `fetchAsset`, never `fetch()`. The bucket is private — a link that leaves the app (email) needs `signedAssetUrl`. Sequential writes only; the store has no concurrency control, and `getClient`/`getIndex` sit behind a 5s per-instance cache.
- Doc/billing numbers must never be reused (monotonic counter exists). Billing slugs = max+1.
- After your wave: run a quick regression (login gate 401, eco-mech GET intact via crafted cookie, portal of your test client renders, build clean).

## Waves

### Wave 1 — Foundations (types + activity/email logs) ✅ prerequisites for all
- [x] `lib/types.ts`: extend ClientRecord with `stage?: "lead"|"quoted"|"accepted"|"development"|"delivered"|"warranty"|"closed"` (derive default from existing status/docs), `payments?: Payment[]` (`{at, amount, method, note?, invoiceSlug?}` — `amount` is a **number**, LKR, for balance math), `acceptance?: {name, at, ip?}`, `notes?: string`, `tasks?: {text, done, at}[]`, `emailLog?: {at, to, subject, docs?: string[]}[]`. (Types: `ClientStage`, `Payment`, `Acceptance`, `Task`, `EmailLogEntry`.)
- [x] `lib/activity.ts`: append-only audit log at `state console/activity.json` (cap last 500): exported as `logActivity(actor, action, target, detail?)` + `recentActivity(limit=100)` (newest first). Actor = email from session where available else "operator". Best-effort: both swallow errors.
- [x] Hook activity log into: login success (auth route, actor = verified email), publish/unpublish/regenerate (docs route), generate/publish/unpublish/regenerate/delete (billing route), send route (also append to client.emailLog + saveClient), client create/delete, questionnaire submission (actor = client contact).
- [x] `GET /api/activity` (authed) returns last 100.
- [x] Build, deploy, tick. (Verified on prod: authed GET /api/activity 200 JSON, unauthed 401, eco-mech record intact.)

### Wave 2 — Money: payments, acceptance, lifecycle, dashboard ✅
- [x] Invoice due dates: generation includes `dueDate` (default: advance = +7 days, final = +14; overridable via instructions). Show on invoice doc + console.
- [x] Payments: `POST /api/clients/[slug]/payments` add/remove `{amount, method, at?, invoiceSlug?, note?}`; BillingCard shows per-invoice paid state (Mark paid → ConfirmDialog) and outstanding balance = invoiced(published) − paid.
- [x] Quotation acceptance: portal quotation page gets an "Accept this quotation" block (typed full name → POST `/c/[slug]/accept`, public, honeypot + name required, only when quotation published & not yet accepted). Stores `acceptance`, stamps a visible acceptance line into the quotation render (name/date), emails studio, activity-logs. Idempotent: second accept → friendly "already accepted".
- [x] Lifecycle `stage`: auto-advance (quotation published→quoted; acceptance→accepted; advance payment recorded→development; final receipt published→delivered→warranty(30d auto)→closed) + manual override dropdown on client page. Show stage pill on dashboard rows.
- [x] Dashboard: pipeline summary (count per stage) + "LKR X outstanding across N clients" from payments math.
- [x] Test with a scratch client end-to-end incl. arithmetic; delete it. Tick. (Prod-verified with `wave2-test`: publish→accept (public POST, no cookie)→stamp in HTML+PDF→advance invoice due +7d→partial/full payments→outstanding math on dashboard→stage overrides→final receipt→delivered; edge cases all correct: accept before publish 404, double accept friendly, honeypot swallowed, empty name 400, garbage/negative/zero amounts 400, bad invoiceSlug 400, remove bad index 404, unauthed 401. Deleted after; eco-mech record byte-identical before/after.)

### Wave 3 — Security/ops: rate limiting, backups, DNS health, sessions ✅
- [x] Rate limiting (in-function, fixed-window via Map — per instance is fine): submit 5/10min/IP, upload 30/10min/IP, auth 10/10min/IP (429 + friendly error; form shows it). IP from x-forwarded-for first hop. (Also accept 5/10min; `lib/ratelimit.ts` exports `rateLimit(req, bucket)` with a reserved `comment` bucket for Wave 4.)
- [x] Weekly backup cron (`vercel.json`/`vercel.ts` crons or GitHub Action schedule): route `GET /api/cron/backup` (protected by CRON_SECRET env — generate + set on Vercel) that zips all client records+index (JSON only, not PDFs) and emails to studio. (Dependency-free ZIP writer in `lib/zip.ts`; CRON_SECRET set on Vercel prod/preview/dev + .env.local; proxy allowlists `/api/cron/*` — the bearer check is the route's own guard.)
- [x] DNS health: same cron (or second) verifies each client's CNAME + Vercel domain still attached; mismatch → studio email.
- [x] Session registry: on login create `sid` in token + blob registry (`state console/sessions.json`, cap 50) with email/ua/time; proxy checks sid not revoked (cache 60s in module scope to avoid per-request blob reads — acceptable staleness); `/api/sessions` list + revoke (sign out everywhere) UI in a small Settings card on dashboard. (Token format is now `{abs}.{idle}.{sid}.{sig}` — pre-Wave-3 tokens fail verification, so everyone re-logs-in once.)
- [x] Tick. (TOTP explicitly deferred — email OTP already covers 2FA; note this.)
- **TOTP is deferred**: the email OTP at login already provides a second factor bound to the operator's mailbox; adding TOTP would duplicate that with real enrolment/recovery complexity. Revisit only if the email channel itself becomes a concern.

### Wave 4 — Portal & console UX ✅
- [x] Portal: progress indicator (stage-driven: questionnaire → quotation → advance → development → delivery → warranty), "new" badge for docs published since client's last portal visit (cookie), per-document comment box (public POST `/c/[slug]/comment`, honeypot, rate-limited, stores `comments?: {doc, by, text, at}[]`, emails studio, shows in console client page).
- [x] Questionnaire Sinhala toggle: EN/සිං switch; static translations for section titles/hints/buttons (hand-write good Sinhala for chrome; question labels stay EN with Sinhala sub-hint where feasible — translate the fixed base schema at build time into `lib/questions.si.ts`; answers accepted in any language). Went further than the spec: the fixed base schema's labels/hints/placeholders/checkbox options are fully Sinhala, keyed by field id (several labels are templated with the company short name, so keying on rendered English would miss them); only Claude's per-client extra questions stay English, noted in-form.
- [x] Console: per-client Notes card (autosave textarea → `notes`) + Tasks checklist (add/toggle/remove → `tasks`); revision history — before regenerate/revise, push current `{htmlUrl, pdfUrl, no, at}` onto `meta.history[]` (cap 10) and list versions in console with preview links; email history card from `emailLog`; activity feed page `/activity` (authed) rendering the log.
- [x] Tick.

> **RESOLVED (2026-08-07) — storage migrated off Vercel Blob to Cloudflare R2.** Kept as the record of why. `luminary-console-store` flipped to `limits-exceeded-suspended` at 2026-08-06T22:37Z: not a storage cap (3.1 MB across 32 blobs) but the Hobby plan's Blob **operations** quota, which the store's design burned through — Blob has no overwrite, so every read LISTed a prefix to find the newest version and every `saveClient` was 2 puts + 2 prunes-of-100. Every read then 403'd and the whole console + every client portal 404'd. **The data did not survive** the suspension window and eco-mech is rebuilt from known facts by `npm run recreate:ecomech` (which also seeds the doc counter to 60, so no document number is ever reused). R2 removes the amplification rather than raising the ceiling: fixed keys, one GET per read, one PUT per write, no listing anywhere on the hot path.

### Wave 5 — AI assistant + handover pack ✅
- [x] Client-page assistant card (operator-only): textarea → `POST /api/clients/[slug]/assist` (authed) with the full client record as context (Claude Opus 5, stream not required; reuse lib/generate `client` setup, `claude-opus-5`, cache system prompt). Prompt use-cases: summarize submissions, draft follow-up email, explain outstanding money. Output rendered as text with a Copy button. NO client-facing sending from here.
- [x] Handover pack: button on client page (enabled when stage ≥ delivered or final receipt exists) → `POST /api/clients/[slug]/handover` generates a branded HTML+PDF doc (existing shell/templates): credentials placeholder table, warranty terms (30d from delivery), care-plan pitch, doc index with numbers. Stored as billing-style asset, previewable, publishable to portal, emailable per-doc like others. Doc no: `LUM-HOP-{base}`.
- [x] Tick.
- **The handover pack is NOT AI-generated** — every field is derived from the record (`lib/handover.ts`). A handover pack is a statement of fact (document numbers, dates, totals); a model has no business inventing those, and deriving them makes a rebuild free and instant.
- **NOTE for Wave 6 — the eco-mech baseline moved on 2026-08-07, legitimately.** At 05:03:38Z, mid-Wave-5, the real client submitted their questionnaire (activity log: actor `Minuli Hewapathirana`, `submitted questionnaire`, submission #1). eco-mech is therefore no longer `created`/0 submissions: it is `drafts_ready` with one submission, an answers PDF, and stage-2 drafts (`LUM-Q-0043`, `LUM-P-0043`, `LUM-MSA-0043`, all **draft** — nothing new is client-visible; only `LUM-EST-0043` is published). The whole arc ran unattended and correctly on real traffic. Wave 5 never wrote to that record — every Wave 5 activity entry targets `w5-test` — but re-baseline before asserting byte-identity, and **leave those drafts alone**: publishing them is the maintainer's commercial decision, not a test step.

### Wave 6 — Full E2E QA (fresh agent) ✅
- [x] Re-run whole-platform test matrix (auth+OTP mechanics, guards, questionnaire+uploads, docs lifecycle, billing arc incl. payments/due/acceptance, new features, crons, rate limits — expect 429s, portal UX incl. comments/badges/Sinhala, mobile+desktop light+dark screenshots, JS console errors, no horizontal overflow).
- [x] Fix everything found (commit fixes), re-test, document results at the bottom of this file. eco-mech must be byte-identical (record + doc URLs) before/after.

## Env additions
- `CRON_SECRET` (Wave 3 — generate, set on Vercel all targets + .env.local). ✅ done (64-hex, set on production/preview/development + .env.local; Vercel Cron sends it as the Authorization bearer automatically).
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` (storage migration — set on Vercel all targets + .env.local, then `npm run r2:init`). `BLOB_READ_WRITE_TOKEN` is dead and can be removed. (`R2_ENDPOINT` exists as a local-testing override only — never set it on Vercel.)

## Progress log
(append: date — wave — agent summary — deploy sha)
- 2026-08-07 — Wave 1 — extended ClientRecord types (stage/payments/acceptance/notes/tasks/emailLog), added lib/activity.ts audit log (activity.json, cap 500, best-effort) hooked into auth/docs/billing/send/clients-CRUD/submit, new authed GET /api/activity (last 100, newest first); prod verified (activity 200 + JSON, unauthed 401, eco-mech intact) — 46994c3
- 2026-08-07 — Wave 2 — money: lib/stage.ts (STAGES/currentStage/advanceStage; auto-advance persists on equal rank since the triggering fact lands on the record first, time drift delivered→warranty(≥1d)→closed(>30d) off `deliveredAt`, legacy inference for stage-less records) + lib/money.ts (parseAmount rejects ranges/prose → null, summarizeMoney = published invoices − payments, clamped ≥0, unparsable totals surfaced not summed); new routes POST /api/clients/[slug]/payments (add/remove, numeric LKR validation), POST /api/clients/[slug]/stage (manual override; below-delivered clears deliveredAt), public POST /c/[slug]/accept (honeypot=`company`, idempotent, re-renders quotation keeping original issue date, studio email); quotation web render embeds the accept form (print-hidden) or the acceptance stamp box + "Accepted" pill/meta row; invoice due-date defaults stated verbatim in the generateBilling prompt (advance +7d, final/other +14d, Colombo tz); BillingCard due/paid state + Mark paid (ConfirmDialog `prompt` input prefilled with remaining balance) + payments list + outstanding line; StageSelect dropdown + acceptance line on client page; dashboard pipeline counts + outstanding summary + stage pill column (dashboard now fetches all records). NOTE for later waves: client DELETE API needs a real CONSOLE_USERS password (ADMIN_PASSWORD isn't one) — scratch teardown used scripts/delete-client.ts + lib/domains.removeClientDomain — 8ff9685 + 797d2b6
- 2026-08-07 — Wave 3 — security/ops: lib/ratelimit.ts fixed-window per-IP limiter (module-scope Map, per-instance — documented; buckets submit 5 / accept 5 / auth 10 / upload 30 per 10 min, `comment` reserved for Wave 4; 429 with friendly `error` JSON that all public forms already surface, rate check runs BEFORE getClient so unknown-slug floods are cheap); GET /api/cron/backup (Mon 03:00 UTC via new vercel.json, CRON_SECRET bearer is the sole guard — proxy allowlists /api/cron/*) zips index + all client records (JSON only) with dependency-free lib/zip.ts (deflate + hand-rolled CRC-32, `unzip -t` clean) and emails studio, then DNS-health-checks every client (Cloudflare CNAME → vercel-dns + Vercel domain attachment; mismatches emailed), activity actor "system"; session registry: token format now `{abs}.{idle}.{sid}.{sig}` (sid = 8 random bytes hex; old tokens invalid → one-time re-login), logins recorded in state sessions.json (cap 50, >24h pruned), revocations in revoked.json, proxy rejects revoked sids with 60s module-scope cache (fails open on blob errors), /api/sessions GET (newest-first, `current` flag) / POST revoke|revokeAll (activity actor = registry email), dashboard SessionsCard with ConfirmDialog revoke + "Sign out everywhere" (self-revocation → /api/logout → /login). Local verify: all four buckets trip at limit+1 with readable 429; cron 401/401 (no/bad bearer) then 200 with a real backup email (1 client, 6.9 KB zip, 0 DNS issues); revoked sid 401s after the cache window while a live one stays 200; revokeAll → revokedSelf:true. Prod smoke (unauthenticated): cron 401, /api/sessions 401, /login 200, eco-mech questionnaire 200, root → /login redirect, and 6th POST to a temporarily-attached no-record subdomain's /submit → 429 (temp domain detached after). Cron registered on the deployment (0 3 * * 1). TOTP deferred — email OTP is already the second factor. NOTE: authenticated prod verification (dashboard Sessions card UI, live revoke round-trip) intentionally left to the maintainer — 9060791
- 2026-08-07 — Wave 4 — portal & console UX: portal stepper (`components/PortalProgress.tsx`, six client-facing steps off `currentStage()`, state classes namespaced `is-done/is-now/is-todo` — a bare `done` inherits the thank-you screen's `.done{padding:60px…}` and shoved the first step 60px down; short labels swap in ≤560px so six columns fit 266px of card without breaking words); "New" badges — the proxy stamps a per-slug `lum_visit_<slug>` cookie on the portal root (client host `/` and console preview `/c/<slug>`) and passes the PREVIOUS value in an `x-lum-last-visit` request header, because **Next propagates cookies set on a middleware response back onto the request**, so `cookies()` in the page already holds the stamp just written and nothing would ever look new (header is overwritten unconditionally → unforgeable; no cookie = first visit = nothing flagged); public `POST /c/[slug]/comment` (honeypot `company`, `comment` rate bucket checked before the blob read, name ≤120, text ≤2000, doc key resolved against **published** docs only via new `lib/doclabels.ts`, appends `comments[]` capped at 200, studio email with replyTo=support, activity-logged) surfaced as ONE portal box with a document picker (six stacked forms would bury the documents at 390px); questionnaire EN/සිංහල toggle — `lib/questions.si.ts` (hand-written Sinhala for all nine base sections, every base field label/hint/placeholder, all ~60 checkbox options and the full form chrome; `{co}` slot for the company short name; industry vocabulary left in English) + `lib/questions.i18n.ts` (English table, `UIStrings` type so the two can't drift, lookups), page now renders through `components/QuestionnaireSheet.tsx` so head/meta/how-it-works/footer switch with the form, choice in `localStorage`, **answers unaffected** (keyed by field id, checkbox values stay English), Sinhala drops the mono chrome's uppercase+tracking (it breaks conjuncts); console client page gained Notes (debounced autosave → new `POST/PATCH /api/clients/[slug]/notes`, deliberately NOT activity-logged — keystroke-driven entries would drown the feed), Tasks (optimistic, server list authoritative → new `POST /api/clients/[slug]/tasks` add/toggle/remove), Emails sent (from `emailLog`) and Client questions cards; revision history — `archiveVersion()` in `lib/pipeline.ts` pushes `{no,htmlUrl,pdfUrl,at}` onto `history[]` (cap 10) before both regenerate paths re-render, `saveDoc` now carries `history` across the meta replacement, billing delete also drops archived assets, `<details>` expander per row (works with JS off); `/activity` authed page (reads `lib/activity` directly, relative times via new `lib/time.ts`, known slugs linked) linked from the dashboard. Local verify against a throwaway client (deleted after; eco-mech only ever GET-read): stepper correct per stage incl. eco-mech at `lead`, badges appear only for docs newer than the previous visit and ignore a forged header, comment matrix 200/200(honeypot)/400×5/404 + 429 on the 11th, notes & tasks round-trip with their edge cases (bad type, >20k, bad index, empty text, unknown action, 401 unauthed), history 0→1→2 with archived URLs still 200 and the current URL rotating, Sinhala switches every chrome string + survives reload with typed answers intact while `extra_0` stays English, 16/16 no-overflow at 390px & 1280px in both themes, zero console errors. Prod smoke (unauthenticated): `/login` 200, `/` → `/login` 307, **`/activity` → `/login` 307**, `/api/activity` 401, `/comment` returns our JSON 404. **eco-mech portal/questionnaire returned 404 — NOT a regression: the Vercel Blob store is suspended (see the blocker note above), so every record read 403s.** — e3744d6
- 2026-08-07 — storage migration — Vercel Blob → **Cloudflare R2** (S3 API, `@aws-sdk/client-s3` + `s3-request-presigner`). `lib/r2.ts` builds the client (region `auto`, `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, `requestChecksumCalculation/responseChecksumValidation: WHEN_REQUIRED` — R2 rejects the SDK's default CRC32 trailer); `lib/store.ts` keeps its exported surface but drops the version-and-list design: index/record/counter/state on FIXED keys (1 GET / 1 PUT, no listing, no pruning), assets on locally-suffixed unique keys, `deleteClient` a paginated prefix sweep in 1000-key batches, 5s per-instance read cache on records+index (never the doc counter). Bucket is PRIVATE: `putAsset` returns `/api/asset/<key>`, new authed `app/api/asset/[...key]` streams it (PDF/raster inline, HTML+SVG forced to `attachment` under `default-src 'none'; sandbox` so client-supplied bytes can't run on the console origin), `fetchAsset` reads straight from R2 with no HTTP hop (all nine former raw `fetch(meta.pdfUrl)` sites converted), and the one email that links attachments presigns a 7-day GET. Questionnaire uploads swapped from `@vercel/blob/client` to presigned PUT — the route signs content-type AND content-length (the S3 presigner forces content-type unsignable, so it is listed in `signableHeaders` explicitly) so the 15 MB cap and type whitelist survive leaving the server; `isOwnAttachmentUrl` now validates the key shape and refuses absolute URLs outright. `proxy.ts` imports lib/sessions lazily so the S3 SDK isn't loaded on every request. `@vercel/blob` removed; `scripts/delete-client.ts` rewritten onto the store (and refuses eco-mech); new `scripts/r2-init.ts` (credential probe + CORS guidance) and `scripts/recreate-ecomech.ts` (idempotent, runs the real runStage1, renumbers to 0043, seeds the counter to 60). Verified without credentials: `npm run build` + `tsc --noEmit` clean, no `@vercel/blob` imports remain, and 18/18 behavioural checks passed against a local S3-compatible server (fixed-key overwrite, read-after-write, monotonic counter, presign round-trip, 1205-object prefix delete, traversal/cross-client rejection, asset-route headers). **Not yet verified against live R2** — credentials pending.
- 2026-08-07 — Wave 5 — AI assistant + handover pack: new authed `POST /api/clients/[slug]/assist` (claude-opus-5, adaptive thinking, studio-facts system prompt cached with `cache_control`, streamed for transport only so a long thinking pass can't hit the SDK's non-streaming timeout, `maxDuration=300`, new `assist` rate bucket 20/10min/IP checked before the body is parsed) — context is a flat per-area text dump of the record (company/brief/stage, every doc with its structured data, billing with per-invoice paid state, payments + the outstanding arithmetic, change orders, portal questions, notes, tasks, email log) plus the latest questionnaire answers fetched from R2 and re-paired with the questions they answered via `buildSections` (the stored file is keyed by field id and reads like a database dump alone); per-field truncation (1.2k per answer, 4k per free-text block, 120k overall) keeps a chatty client inside the window. `components/AssistantCard.tsx` is operator-only and says so in the card copy: 4 one-click presets, ⌘+Enter, Copy on the output, prompts bounded at 4k chars, and NO send path — a drafted email comes back as text. Handover pack: `lib/handover.ts` derives every field from the record (summary from quotation scope → proposal overview → brief; deliverables from proposal or quotation line items; doc index sorted oldest-first; warranty = `deliveredAt` + 30d; money from `summarizeMoney`/`paidAgainst`) and `lib/templates/handover.ts` renders it through the existing shell — **no AI call**, because a handover pack is a statement of fact and a rebuild should be free. `POST /api/clients/[slug]/handover` refreshes in place (archiveVersion → same slug/number, keeps published state) rather than issuing a second pack. **Storage decision: extended `BillingDoc["kind"]` to a `BillingKind` union with `"handover"`** instead of a new `DocType` or a parallel `extras[]` — the portal doc route, its `/pdf`, `/preview`, per-doc email, publish/unpublish/delete and revision history are already implemented against `billing[]` and keyed on `slug`, so this cost zero new plumbing, whereas `docs` is a fixed one-slot-per-type map wired into the AI drafting pipeline. Widening the union in one place made the compiler enumerate every site that names a billing document; all now share the new `billingLabel()` in `lib/doclabels.ts`, so console/portal/email/PDF-filename/delete-archive naming can't drift ("Handover pack", never "Additional handover"). Money math already filters `kind === "invoice"`, so the pack is invisible to the outstanding balance; billing `regenerate` refuses a handover (400, pointing at its own card) and BillingCard hides Revise for it. Doc no. `LUM-HOP-<base>` (suffix only from a hypothetical second pack, so numbers are never reused). Local E2E on a throwaway `w5-test` (deleted after, domain detached; eco-mech only ever READ): full arc runStage1 → questionnaire submit → stage-2 drafts → publish quotation/proposal/contract → advance invoice+receipt → payment → final invoice+receipt → auto-`delivered`, then handover generate → 23.6 KB HTML → 3-page PDF → publish → portal row + `/handover-1` 200 + `/handover-1/pdf` 200 with the right filename → per-doc email delivered with the PDF attached → rebuild (history archived, superseded render still 200, stays published) → unpublish (portal 404) → delete → regenerate. Gating: 400 before delivery, button disabled with a wrapper `title` (a disabled button swallows its own tooltip). Assistant: all four presets answered correctly and grounded — it caught a payment/receipt mismatch I'd seeded by accident and refused to write a chasing email for an already-settled balance; empty 400, >4k 400, unknown slug 404, unauthed 401, 21st request in the window 429 with Retry-After. 12/12 no-overflow at 390px+1280px in both themes (client page, portal, rendered pack), zero page errors, and the preset→loading→answer→Copy round-trip verified in a real browser. Prod smoke (unauthenticated): assist 401, handover 401, client GET 401, `/login` 200, `/` → `/login` 307, eco-mech portal/estimate/questionnaire/estimate.pdf all 200. — 8a5ab8c

---

## Wave 6 — QA results

Independent end-to-end pass, 2026-08-07. Method: local `npm run dev` against
the **real** Cloudflare R2 store, driving the real HTTP routes; two throwaway
clients (`qa6-a` full arc, `qa6-b` bare) created through the real
`POST /api/clients` (so stage-1 drafting, PDF rendering and domain
provisioning all actually ran); production smoke checks unauthenticated after
the fix deploy; both test clients and their domains torn down afterwards.

**Authed testing was done locally through the real login flow**, not with a
crafted cookie: a QA operator was added to `.env.local`'s `CONSOLE_USERS` for
the session (removed afterwards, `.env.local` restored byte-for-byte), signed
in with email+password, and the emailed 6-digit code was recovered by brute
forcing the stored `sha256(email:code)` over the 10⁶ code space — which
exercises `issueOtp`/`verifyOtp`/the pending cookie/`registerSession` exactly
as a browser would. No session cookie was ever hand-signed, and nothing was
tested against the production console behind auth.

**eco-mech was never written to.** Its record was dumped before any work
started and again after teardown: identical, `sha256
296102230ab9f8bcca67965decdacc974b53ee9b08063c7a3e04aef8ff1d227c` both times.
Baseline confirmed as briefed — docNoBase `0043`, published `LUM-EST-0043`,
one submission (07 Aug 2026 10:33, Minuli Hewapathirana), and `LUM-Q-0043` /
`LUM-P-0043` / `LUM-MSA-0043` all still **draft**. On production its portal,
estimate, estimate PDF and questionnaire return 200 and the three drafts
still 404.

**Totals: 231 checks run, 231 passing after fixes. 24 defects found**, 22
fixed in `10a813d` + `d8f10d1`, 2 (plus 12 lesser observations) deliberately
left with reasons below.

### Matrix

Legend: ✅ passed as found · 🐞 failed as found, fixed, re-verified.

#### 1. Auth, OTP and sessions (30)

| # | Check | Result |
|---|---|---|
| 1 | `GET /api/activity` unauthenticated → 401 JSON | ✅ |
| 2 | `GET /` unauthenticated → 307 `/login` | ✅ |
| 3 | `GET /activity` unauthenticated → 307 `/login` | ✅ |
| 4 | `GET /clients/new` unauthenticated → 307 `/login` | ✅ |
| 5 | `GET /c/<slug>` (console preview) unauthenticated → 307 `/login` | ✅ |
| 6 | `GET /login` → 200 | ✅ |
| 7 | Wrong password → 401 "Wrong email or password." | ✅ |
| 8 | Unknown email → 401, byte-identical message (no enumeration) | ✅ |
| 9 | Authed `GET /api/activity` → 200 | ✅ |
| 10 | Authed page headers: no-store, DENY, nosniff, HSTS, referrer, permissions | ✅ |
| 11 | Same headers on the **unauthenticated redirect** | 🐞 B1 |
| 12 | Same headers on the **unauthenticated 401** | 🐞 B1 |
| 13 | Two-step login end to end (real code emailed, redeemed, cookie issued) | ✅ |
| 14 | 60-second resend throttle refuses a second code, with seconds remaining | ✅ |
| 15 | Throttled resend still issues the `lum_pending` cookie | 🐞 B2 |
| 16 | Wrong code ×4 → "Wrong code — check the email and try again." | ✅ |
| 17 | 5th wrong code → locked | ✅ |
| 18 | Correct code **after** lockout → still refused | ✅ |
| 19 | Single-use: the OTP state object is deleted on success | ✅ |
| 20 | Auth rate limit 10/10 min → 11th is 429 + `Retry-After: 510` | ✅ |
| 21 | Idle window slides: `idleExp` re-armed to +30 min on each request | ✅ |
| 22 | Absolute cap never moves: `absExp` constant at ~24 h across refreshes | ✅ |
| 23 | `sid` stable for the life of the login | ✅ |
| 24 | Tampered signature → 401 | ✅ |
| 25 | Expired timestamps → 401 | ✅ |
| 26 | `GET /api/sessions` lists newest-first with a `current` flag | ✅ |
| 27 | Revoke an unknown sid → 404 | ✅ |
| 28 | Unknown `action` → 400 | ✅ |
| 29 | Revoke own sid → still 200 inside the 60 s proxy cache, 401 after it | ✅ |
| 30 | `POST /api/logout` clears the cookie | ✅ |

#### 2. Client lifecycle (56)

| # | Check | Result |
|---|---|---|
| 31–32 | Reserved slugs `console`, `dev` → 400 | ✅ |
| 33 | Duplicate slug → **409** | ✅ |
| 34–37 | Invalid slugs (`Bad_Slug`, 1 char, `-abc`, 42 chars) → 400 | ✅ |
| 38 | Slug ending in a hyphen (illegal DNS label) → accepted | 🐞 B3 |
| 39–40 | Missing brief / missing company → 400 | ✅ |
| 41 | Malformed JSON body → 400 | ✅ |
| 42 | `GET /api/clients` returns the index | ✅ |
| 43 | Create → estimate drafted, rendered, PDF'd, published | ✅ |
| 44 | Reg-no auto-extraction, "Registration No: PV 128877" → `PV128877` | ✅ |
| 45 | Reg-no auto-extraction, lower-case "reg no pv220011" | 🐞 B4 |
| 46 | Domain provisioning: Cloudflare CNAME + Vercel attach, `dnsStatus: automated` | ✅ |
| 47 | Studio "new client" email with the estimate PDF attached | ✅ |
| 48 | Questionnaire page 200 on the client subdomain | ✅ |
| 49 | Submit without a name → 400 | ✅ |
| 50 | Submit with `describe`/`services` (schema-`required`, starred in the UI) blank | 🐞 B5 |
| 51 | Honeypot `company` filled → fake 200, nothing stored | ✅ |
| 52 | `sendCopy` with an unparsable address → 400 | ✅ |
| 53 | Malformed JSON → 400 | ✅ |
| 54 | Submit rate limit 5/10 min → 6th is 429 (counted before the store read) | ✅ |
| 55 | Real submission: answers JSON + branded answers PDF + studio email | ✅ |
| 56 | Copy-to-client email delivered (`copySent: true`) | ✅ |
| 57 | Client-typed name interpolated **unescaped** into both emails | 🐞 B6 |
| 58 | Unvalidated `contactEmail` used as Resend `replyTo` | 🐞 B7 |
| 59 | Presigned upload of a **6 MB** file (over Vercel's 4.5 MB body limit) → PUT 200 | ✅ |
| 60 | 16 MB → 400 "over 15 MB" | ✅ |
| 61 | `text/html` content type → 400 | ✅ |
| 62 | Traversal in the file name → 400 | ✅ |
| 63 | Signed length is binding: PUT 200 bytes against a 100-byte signature → R2 403 | ✅ |
| 64 | Signed type is binding: PUT `text/html` against a PDF signature → R2 403 | ✅ |
| 65 | Attachment recorded on the submission with name + size | ✅ |
| 66 | Stage-2 drafting produced quotation + proposal + contract as drafts | ✅ |
| 67 | Publish each of the three core drafts | ✅ |
| 68 | Delete a **published** core doc → 400 | ✅ |
| 69 | Unpublish → portal 404 → delete → assets and archived renders swept | ✅ |
| 70 | Delete twice → 404 | ✅ |
| 71 | Regenerate with no instructions → 400 | ✅ |
| 72 | Regenerate with instructions → `history` 0→1, superseded render still 200 | ✅ |
| 73–75 | Unknown action / unknown doc type / unknown client → 400 / 400 / 404 | ✅ |
| 76 | `retry-stage2` over **published** quotation/proposal/contract | 🐞 B8 |
| 77 | `retry-stage2` with a missing answers object → raw 500 | 🐞 B9 |
| 78 | `retry-stage2` does not archive the renders it replaces | 🐞 B10 |
| 79 | Billing `other` with no instructions → 400 | ✅ |
| 80 | Billing advance/final with **no quotation** to ground the arithmetic | 🐞 B11 |
| 81 | Generate advance invoice → `LUM-INV-0064-01` | ✅ |
| 82 | Generate advance receipt, final invoice, final receipt | ✅ |
| 83 | Revise a billing doc → `history` 0→1 | ✅ |
| 84 | `regenerate` refuses a handover pack → 400 pointing at its own card | ✅ |
| 85 | Delete a **published** billing doc → 400 | ✅ |
| 86 | Delete the newest billing doc, then generate → number reused | 🐞 B12 |
| 87 | Per-doc email (handover pack) with the PDF attached | ✅ |
| 88 | Send-all email: 10 documents resolved and attached/linked | ✅ |
| 89 | Send with an unknown doc key → 400 | ✅ |
| 90 | `emailLog` records both sends with recipients, subjects and doc keys | ✅ |
| 91 | `DELETE` with a wrong password → 403 | ✅ |
| 92 | `DELETE` archives 9 PDFs, deletes 31 objects, removes CNAME, detaches domain | ✅ |
| 93 | `DELETE` proceeds even when the archive email silently fails | 🐞 B13 |
| 94 | `DELETE` has no rate limit on the password it re-verifies | 🐞 B14 |

#### 3. Money (23)

| # | Check | Result |
|---|---|---|
| 95 | Advance invoice due date defaults to +7 days (issued 07 Aug → due 14 Aug) | ✅ |
| 96–99 | Payment amount negative / zero / string / null → 400 | ✅ |
| 100 | Payment against a non-existent invoice slug → 400 | ✅ |
| 101 | Valid partial payment recorded, stage auto-advances to `development` | ✅ |
| 102–103 | Remove payment at an out-of-range / negative index → 404 | ✅ |
| 104 | Unknown payments action → 400 | ✅ |
| 105 | Outstanding math: 94,000 invoiced − 47,000 paid → **LKR 54,000** then 47,000 | ✅ |
| 106 | Dashboard shows "LKR 47,000 outstanding across 1 client" | ✅ |
| 107 | Dashboard pipeline counts per stage | ✅ |
| 108 | Accept before the quotation is published → 404 | ✅ |
| 109 | Accept honeypot → fake 200 | ✅ |
| 110 | Accept with an empty name → 400 | ✅ |
| 111 | Accept → stored with name/at/ip, studio emailed, activity-logged | ✅ |
| 112 | Second accept → friendly `{already: true}`, original name/date kept | ✅ |
| 113 | Accept rate limit 5/10 min → 429 | ✅ |
| 114 | Acceptance stamp in the **HTML** ("Accepted by … on 07 Aug 2026") | ✅ |
| 115 | Acceptance stamp in the **PDF** (extracted with pdftotext) | ✅ |
| 116 | Publishing the final receipt → `delivered` + `deliveredAt` stamped | ✅ |
| 117 | Drift: a 67-day-old `deliveredAt` reads as `closed` | ✅ |
| 118 | Manual override back to `delivered` on a drifted record | 🐞 B15 |
| 119 | Setting stage `closed` fabricates a delivery date + warranty window | 🐞 B16 |
| 120 | Stage below delivered clears `deliveredAt` | ✅ |

#### 4. Wave 3 ops (12)

| # | Check | Result |
|---|---|---|
| 121–125 | Rate limits trip at the documented ceiling: submit 5, accept 5, auth 10, comment 10, assist 20 — each with a friendly `error` and `Retry-After` | ✅ |
| 126 | Rate check runs before the store read on every public route | ✅ |
| 127 | `GET /api/cron/backup` with no bearer → 401 | ✅ |
| 128 | …with a wrong bearer → 401 | ✅ |
| 129 | …bearer compared with `===`, not constant-time | 🐞 B17 |
| 130 | …with the real `CRON_SECRET` → 200, real backup email (2 clients, 17.7 KB zip) | ✅ |
| 131 | DNS health check in the same run: `dnsIssues: 0` across both live subdomains | ✅ |
| 132 | A backup whose email fails still reports success | 🐞 B18 |

#### 5. Wave 4 UX (17)

| # | Check | Result |
|---|---|---|
| 133 | Portal stepper renders six steps with correct `is-done/is-now/is-todo` for the stage | ✅ |
| 134 | "New" badges: **none** on a first visit (no cookie) | ✅ |
| 135 | "New" badges: all 9 published docs flagged with an old visit stamp | ✅ |
| 136 | "New" badges: none with a future stamp | ✅ |
| 137 | A forged `x-lum-last-visit` request header is ignored | ✅ |
| 138 | Visit cookie stamped by the proxy on the portal root | ✅ |
| 139 | Comment honeypot → fake 200 | ✅ |
| 140–143 | Comment validation: empty text, empty name, unpublished/unknown doc, >2000 chars → 400 | ✅ |
| 144 | Valid comment stored, studio emailed, activity-logged | ✅ |
| 145 | Comment email `replyTo` is the studio itself, not the client | 🐞 B19 |
| 146 | Notes: save + wrong type → 400 | ✅ |
| 147 | Tasks: add / toggle / bad index 404 / empty text 400 | ✅ |
| 148 | `/activity` feed renders the log (59 entries), newest first, attributed | ✅ |
| 149 | Email-history card data present on the record | ✅ |
| 150 | Console portal preview at `/c/<slug>`: every link and the question box | 🐞 B20 |
| 151 | Sinhala tables: 59/59 fields, 67/67 options, 9/9 sections; `UIStrings` type prevents drift | ✅ |

#### 6. Wave 5 (14)

| # | Check | Result |
|---|---|---|
| 152–154 | Assistant: empty prompt 400, >4k prompt 400, unknown client 404 | ✅ |
| 155 | Assistant answers a real preset, grounded in the record — it caught the seeded unparsable invoice total and reconciled it against the payment log | ✅ |
| 156 | Assistant unauthenticated → 401 | ✅ |
| 157 | Assist bucket 20/10 min → 429 (limit checked before the body is read, so a burst costs no model calls) | ✅ |
| 158 | Handover gating: refused before delivery with a 400 explaining both routes in | ✅ |
| 159 | Handover generated for a full arc: totals LKR 194,000 / 47,000 / 147,000 outstanding | ✅ |
| 160 | Handover publish → portal row, `/handover-1` 200, `/handover-1/pdf` 200 with the right filename | ✅ |
| 161 | Handover unpublish → portal 404; delete refused while published | ✅ |
| 162 | Handover regenerate refreshes in place, archives the superseded render | ✅ |
| 163 | **Wave 5 gap 1** — pack on a client with no published invoices | 🐞 B21 |
| 164 | **Wave 5 gap 2** — unparsable invoice total: line reads "see document", the total is excluded and the exclusion is named underneath | ✅ (already correct) |
| 165 | Untagged payments make the per-invoice column disagree with "Total received" | 🐞 B22 |
| 166 | The client-facing project summary falls back to the operator's private brief | 🐞 B23 |

#### 7. Cross-cutting (79)

| # | Check | Result |
|---|---|---|
| 167–230 | **64 page checks** — dashboard, `/clients/new`, client page, `/activity`, `/login`, portal, questionnaire, and all 9 document types — at **390 px and 1280 px** in **light and dark**: zero horizontal overflow (`scrollWidth == clientWidth` on every one) and **zero JS console errors / page errors** | ✅ 64/64 |
| 231 | Answers document with a 100-character pasted URL at 390 px: no overflow | ✅ |
| 232–241 | Re-render of all 5 document families at 390/1280 after the CSS fixes | ✅ |
| 242 | Proposal phase labels ("Phase 01…05") hidden at ≤640 px | 🐞 B24 |
| 243 | Handover credentials table header hidden at ≤640 px, leaving unlabelled blank lines | 🐞 B25 |
| 244 | Print/PDF: all 9 published document types render valid PDFs with correct first-page titles (163–288 KB) | ✅ |
| 245 | 404s for unknown doc keys, unpublished docs, and unknown clients on the client host | ✅ |
| 246 | Grep for `claude` / `anthropic` / `AI` / `LLM` / `GPT` / "language model" across client-facing UI, emails and document templates: no hits outside comments and SDK identifiers | ✅ |
| 247 | The drafting system prompt never forbade the model naming itself as the author of copy shipped verbatim on Luminary letterhead | 🐞 B26 |
| 248 | Asset route serves record.json, index.json, counter.json and the session registry | 🐞 B27 |
| 249 | Asset route: traversal rejected, non-prefixed keys 404, HTML/SVG forced to `attachment` under `default-src 'none'; sandbox` | ✅ |
| 250 | A published document whose stored render is missing serves an empty 200 | 🐞 B28 |
| 251 | PDF `Content-Disposition` interpolates the company name unescaped into a ByteString header | 🐞 B29 |
| 252 | Production smoke after deploy: `/` headers, `/login` 200, `/activity` 307, `/api/{activity,sessions,cron/backup}` 401, eco-mech portal/estimate/PDF/questionnaire 200, eco-mech drafts 404 | ✅ |

### Bugs found and fixed

All in `10a813d` unless noted. Each was reproduced before the fix and
re-verified after, locally and — where observable unauthenticated — on
production.

| ID | Bug | Fix |
|---|---|---|
| B1 | The unauthenticated 401 and the `/login` redirect bypassed `harden()`, so the console host's most-requested response carried no `nosniff`, no `X-Frame-Options`, no HSTS of ours and `cache-control: public, max-age=0` | `harden()` both branches in `proxy.ts`. Verified on production: `/` now returns `no-store` + `DENY` + `nosniff` + HSTS |
| B2 | The 60-second resend branch answered `step: "otp"` — sending the browser to the code screen — without issuing the `lum_pending` cookie. Any browser that didn't already hold one (second device, private window, the same window right after a sign-out) could type the correct code and only ever be told "Login expired", with no way forward for up to a minute | Issue the pending cookie on that branch too |
| B3 | Slug regex `^[a-z0-9][a-z0-9-]{1,40}$` accepted `acme-`, which is not a legal DNS label — the client would be created with a subdomain Cloudflare can never provision | `^[a-z0-9][a-z0-9-]{0,39}[a-z0-9]$` |
| B4 | Extracted reg numbers were stored verbatim from a case-insensitive match, so "reg no pv220011" printed lower-case on every document's letterhead. The `reg` matcher also had no leading `\b` | `.toUpperCase()`, and `\breg` |
| B5 | `required` on the schema was decorative: the star rendered, but only `contactName` was ever checked — client-side or server-side. `describe` and `services`, the two answers the entire drafting pipeline is built on, could be submitted blank | Enforce every `required` field on both sides; new `errRequired` string added to the EN and SI tables (the `UIStrings` type forces both) |
| B6 | `contactName` went unescaped into the studio email **and** the client copy — a submitted name containing markup renders as a live link in the inbox. Every other public route in the repo escapes, and `esc` was already imported in this one | `esc()` both interpolations |
| B7 | `contactEmail` was never validated but was handed to Resend as `replyTo`. Resend rejects the whole send on a malformed address and `emailStudio` only `console.error`s, so a client typing "n/a" would see the thank-you screen, have their answers stored and stage-2 fire — while the studio was never told the submission existed | Validate against the same `EMAIL_RE` the copy addresses use; fall back to no `replyTo` |
| B8 | `retry-stage2` had no preconditions and `runStage2` hard-codes `"draft"`, so a replayed or stale POST replaced a **published, possibly already-accepted** quotation with a fresh draft. The questionnaire route guards exactly this case; the API did not | 409 while any of the three is published |
| B9 | `retry-stage2` never checked `res.ok`; a missing answers object surfaced as a raw 500 | 404 with a real message |
| B10 | `runStage2` overwrote all three documents without archiving — the only overwrite path in the codebase that didn't | `archiveVersion` each before re-rendering |
| B11 | Billing `advance`/`final` proceeded with `quotation: null` in the context while the default instruction says "invoice the standard 50% advance against the quotation total" — the amount on a real invoice would be invented | 400 pointing at the quotation, or at an additional invoice with explicit instructions |
| B12 | Billing sequence was `max(existing) + 1`, so deleting the newest invoice handed its number straight back. Worst for the handover pack, whose first issue carries no suffix: delete it and the next one is `LUM-HOP-<base>` again | Per-kind highwater `billingSeq` on the record, max'd against the live maximum. Verified: delete `LUM-HOP-0065` → next is `LUM-HOP-0065-02` |
| B13 | Client deletion promises "deletion never loses a document", then ran the irreversible teardown regardless of whether the PDFs could be read or the archive email actually went out (`emailStudio` returned `void`) | `emailStudio` now returns delivery status; delete 502s without touching anything if any PDF is unreadable or the mail fails |
| B14 | The delete-confirmation password had no rate limit — an 800 ms sleep on the one irreversible endpoint (`d8f10d1`) | `rateLimit(req, "auth")` |
| B15 | The stage override only stamped `deliveredAt` when absent, so putting a long-delivered client back to `delivered` kept the old timestamp and `currentStage()` drifted straight to `closed` on the next read — the dropdown snapped back, defeating the one thing a manual override is for | Re-stamp `deliveredAt` for `delivered` and `warranty` |
| B16 | `closed` outranks `delivered`, so closing out an unwon lead stamped `deliveredAt = now` — a fabricated delivery date and a 30-day warranty commitment that the handover pack would print | `closed` stamps nothing |
| B17 | The cron bearer was compared with `===`; it is the route's only guard and the proxy waves `/api/cron/*` past the session gate | `timingSafeEqual` |
| B18 | The weekly backup returned `{ok: true}` and logged "ran weekly backup" even when the email never left, so a backup failing for months looked healthy in both the response and the activity feed (`d8f10d1`) | 502 on undelivered, and the activity entry says so |
| B19 | The portal-comment email says "reply to them directly" but set `replyTo` to the studio's own address — the same mailbox it was sent to | `replyTo: client.email` |
| B20 | The documented console preview at `/c/<slug>` was broken end to end: the portal's root-absolute hrefs resolved against the console root (404 / `/login`) and the question box posted to a relative `comment`, which from `/c/<slug>` resolves to `/c/comment` | Derive a `base` prefix from the Host header exactly as the proxy does, and pass it to `PortalComments`. Client-subdomain hrefs are unchanged |
| B21 | **Wave 5 gap.** A handover pack for a client with no published invoices printed "Total invoiced LKR 0 / Total received LKR 47,000 / Balance LKR 0" and declared **"Account settled in full · IP transferred"** — on a signed document, over three numbers that contradict each other. The "Documents issued" table also rendered its header over nothing | `settled` now requires `invoiced > 0`; the totals box is suppressed when nothing was invoiced; the documents header is guarded like the payment table already was |
| B22 | Per-invoice "Received" counts only payments tagged with that invoice's slug (the field is optional), while "Total received" counts all of them — two contradictory numbers on the same page | An "Other payments received" line for the unattributed remainder, so the column sums to the total |
| B23 | The pack's project summary fell back to `client.brief` — the field `/clients/new` explicitly asks the operator to fill with internal figures ("UX 5–10k, development 30–40k LKR") — in a document the client signs | Fallback removed; a neutral derived sentence instead |
| B24 | `.tbl-row>.mono:first-child{display:none}` at ≤640 px was written for the estimate's ordinal but also matched the proposal's phase labels, so "Phase 01…05" vanished and its scope of work was unlabelled on every phone | Dedicated `.rownum` class on the estimate ordinal only |
| B25 | `.tbl-head{display:none}` at ≤640 px also hid the handover credentials header, leaving two anonymous blank signature lines per row | `.tbl-head--keep` opt-out for that one table |
| B26 | The drafting system prompt covered services, pricing, policy and tone but never forbade the model referring to AI, automation or itself — and everything it emits (estimate copy, contract clauses, proposal text, the client's extra questionnaire questions) ships verbatim with no filter | An "Authorship" paragraph: write as "we", never name AI/models/automation, never self-refer |
| B27 | The asset route's only check was the store prefix, which also covers `console/index.json`, `console/counter.json`, every client's `record.json` (PII plus the operator's private notes) and `console/state/*` — including the session registry with its sids | Scoped to the four subtrees `putAsset` actually writes; verified all four state paths now 404 while docs, billing, answers, attachments and archived renders still stream |
| B28 | A published document whose stored render had been deleted served an empty 200 (a blank page, or a zero-byte PDF) instead of a 404 | `res.ok` checked in both the doc and PDF routes |
| B29 | The PDF `Content-Disposition` interpolated the company name raw into a header: a quote breaks the quoting and one non-Latin-1 character — a Sinhala or Tamil trading name, entirely plausible here — makes the `Response` constructor throw, turning a PDF into a 500 | ASCII-safe `filename` plus RFC 5987 `filename*=UTF-8''…` |

Also fixed in passing: `scripts/rerender.ts` now takes slugs, so a template
refresh can be run without rewriting a live client's published assets.

### Deliberately left

- **No concurrency control on any write.** `saveClient` rewrites the whole
  record *and* the whole index with no `If-Match`, and `nextDocNoBase` is a
  read-increment-write — so two simultaneous mutations lose one, and two
  simultaneous creations can share a `docNoBase`. This is real, but it is a
  design change (conditional writes at every mutation site), not a QA fix, and
  the console has one operator. Flagged as the top item for a future wave.
- **`summarizeMoney` is asymmetric**: `invoiced` counts only published,
  parsable invoices while `paid` counts every payment, and `Math.max(0, …)`
  hides overpayment. That is the arithmetic Wave 2 specified and it drives
  every balance already on screen; changing it silently would move numbers the
  owner has been reading. Worth a deliberate decision, not a QA edit.
- **Unpublishing the final receipt does not reverse `deliveredAt`**, so an
  accidental publish starts the warranty clock. There is now a clean remedy —
  set the stage below Delivered (which clears it) and back — so this stays a
  papercut rather than a trap.
- **History eviction past the cap of 10 orphans its R2 objects.** Bounded, and
  full client deletion sweeps the prefix.
- **Uploads that are never submitted are never swept.** The presigned PUT is
  unauthenticated by design (knowing a public slug is the only gate) at
  30 × 15 MB per IP per 10 minutes. Needs a GC job, which is a new cron.
- **Sinhala is not complete outside the tables**: the six upload-control
  errors and the generic fetch failure in `QuestionnaireForm` are hardcoded
  English, `t.errGeneric` is unreachable (every throw in that block is an
  `Error`), and every server-returned `error` string is English. The tables
  themselves are complete and drift-proof. Half-translating the failure path
  is worse than leaving it consistent; the server strings are English
  app-wide.
- **`<html lang="en">` on the Sinhala questionnaire** — only `<main>` gets
  `lang="si"`.
- **"We have vector files (AI / SVG / EPS / PDF)"** stays. That is Adobe
  Illustrator, not artificial intelligence; rewriting it would change a stored
  answer value for a false positive.
- **Stored documents keep the CSS they were rendered with**, so the ≤640 px
  fixes (B24/B25) and the overflow-wrap rules apply to new renders only.
  `npx tsx scripts/rerender.ts <slug>` refreshes them — deliberately **not**
  run against eco-mech, because it would rotate its published estimate's asset
  URLs and re-flag the document as "New" in the client's portal.
- Cosmetic, left as-is: the activity feed says "published other handover"
  (`${stage} ${kind}`) rather than using `billingLabel`; an unknown `tasks`
  action answers 404 "No such task." instead of 400; `/preview/[slug]/[type]`
  carries a dead `type === "pdf"` branch.

### Test-artifact notes (not bugs)

- `SessionGuard` logs one 404 for `/api/ping` on every client-subdomain load.
  That is how it detects it isn't on the console and self-disables — it throws
  nothing and was excluded from the console-error count deliberately.
- The `qa6-a`/`qa6-b` subdomains still resolve after teardown because
  `*.luminary-dev.xyz` has a wildcard; the per-client CNAMEs are gone (`dig`
  returns no CNAME, unlike eco-mech) and Vercel answers 404 for both.

### Only the logged-in owner can confirm these

1. **"Sign out everywhere" (`revokeAll`)** — not exercised, on purpose: the
   live registry contained the owner's own session
   (`dhanikaanupama2000@gmail.com`, 04:09 UTC) and revoking it would have
   signed a real person out. Single-sid revocation was verified end to end and
   `revokeAll` is the same call over every sid.
2. **The console UI affordances** driven only through their APIs here: the
   dashboard Sessions card, Notes autosave, the Tasks checklist, BillingCard's
   "Mark paid" dialog, AssistantCard's presets/⌘+Enter/Copy, HandoverCard, the
   DocHistory expanders and the DeleteClient dialog.
3. **Email delivery, as opposed to acceptance.** Sign-in codes, the weekly
   backup zip, the archive-before-deletion mail and the client-facing
   documents were all accepted by Resend and verified server-side; whether
   they render correctly in the studio inbox is an inbox check.
4. **The three eco-mech drafts** (`LUM-Q-0043`, `LUM-P-0043`, `LUM-MSA-0043`)
   remain unpublished and untouched. Publishing them is a commercial decision.
5. **Whether to run `npx tsx scripts/rerender.ts eco-mech`** to pick up the
   mobile template fixes on the published estimate — it rotates that
   document's asset URLs and will show as "New" in the client's portal.
6. **The assistant against eco-mech's real record.** It was only exercised on
   a throwaway client; its answers on real client data are worth one read.
