# AUDIT.md — Luminary Console full-repository audit

Audit date: **2026-09-07** · Branch: `audit/2026-09` · Tree: `main` @ audit start (clean).
Standard: best practice as of **September 2026**, security mapped to **OWASP Top 10:2025**,
accessibility to **WCAG 2.2 AA**.

Method: read-only Phase-1 recon, then five parallel domain audits (security/auth,
backend/data, frontend/UX/a11y, CI-CD/deps/observability, correctness bug-hunt). Every
finding cites `file:line`. This repo carries a **prior audit register** (`docs/audit/FINDINGS.md`,
LC-001..LC-091, 2026-08-26); items already **Fixed** there are not re-reported — findings below
are **new** or **residuals** of Partially-/Not-fixed items (the `PriorRef` line records which).

---

## 1. Executive summary

The console is an unusually well-hardened, well-documented Next.js 16 application that has
already survived one thorough audit. The core security primitives are sound: webhook HMAC
verified over the raw body before parse, RS256 GitHub-App auth, a thorough redacting logger,
CSP-nonce + Origin CSRF at the edge, scrypt/HMAC credential storage, a private R2 bucket with a
traversal-guarded asset stream, and CAS on the shared index/state files. `npm audit` is clean
(0 vulnerabilities) and no secret is committed.

This pass found **no Critical issues** but **10 High** ones. The through-line of the most serious
findings is *"the console can be confidently wrong about the thing it exists to answer,"* and
*"a control that exists is not wired to where it's needed":*

- **API-01 (High):** the scheduled `/api/github/process` cron is **blocked by the proxy session
  gate** — it isn't on the exemption list, so a cookieless cron request is 401'd before the
  route's own bearer check runs. The webhook pipeline's durability backstop and drift-reconcile
  **never run on schedule** (verified in code; the route's own comment mis-states the flow).
- **BUG-01 (High):** the PR projection is written by two transports (GraphQL / REST) with
  **disjoint field sets**; after any reconcile/backfill a branch-protection-blocked or
  behind-base PR can report **"Ready to merge."**
- **API-02 (High):** every client-record mutation is **last-write-wins** (the CAS path has zero
  callers) — concurrent writes silently drop data, **including recorded payments**.
- **SEC-01 (High):** the client portal is guarded only by a **guessable, name-derived slug** —
  no capability token — so PII/pricing is enumerable and a binding **acceptance / e-signature can
  be forged** under an attacker-typed name.
- **UI-01/02/04/18 (High):** systemic accessibility/UX gaps in the *console* shell (no
  `aria-live` on async errors, no `<h1>`/nav-inside-`<main>`, inconsistent section nav, unlabeled
  controls) — notably the adjacent GitHub section already does these correctly.
- **UI-03 (High):** the dashboard and `/clients` read **every full client record on every load**.
- **OPS-01 (High):** GitHub Actions pinned by **mutable tag, not SHA**, acute because `ops-run.yml`
  injects the entire production secret set into the job.

Most findings are Medium/Low residuals from the prior audit's own roadmap (Zod-everywhere,
pagination, RBAC, shared-store rate limiting, observability/alerting, SHA-pinning) plus a handful
of genuinely new correctness bugs in the GitHub layer (circuit-breaker never re-arms, reconcile
masks an outage as clean, notification grouping loses counts under concurrency).

**Two runtime confirmations recommended** before acting: API-01 (invoke as Vercel Cron does —
bearer, no cookie — and observe the 401, or watch `pending` deliveries accumulate) and BUG-01
(confirm against the live org's branch-protection config). Static evidence for both is strong.

---

## 1a. Remediation status (branch `audit/2026-09`)

Fixed and verified (lint + typecheck + 762 unit/component tests + `next build`
green after each commit; new regression tests added for BUG-01, BUG-02, API-02).
Commit messages carry the finding IDs — `git log --grep <ID>` finds each.

**Fixed (51):**
- Backend/data: **+ API-03** (surface unreadable projection/inbox entities).
- Frontend/UX/a11y: **+ UI-05** (page `<html lang>` + localised generic error), **+ UI-06** (mark-seen moved off the render path via `after()`), **+ UI-09** (route-level loading skeletons), **+ UI-19** (SessionsCard server-rendered).

**Originally fixed (46):**
- **Highs:** API-01, API-02, BUG-01, OPS-01 *(mechanism — see below)*, UI-01, UI-18.
- **Security:** SEC-02, SEC-03, SEC-04, SEC-05 *(public-render rate limit; egress isolation deferred)*, SEC-06, SEC-07, SEC-08 *(delete step-up; full RBAC deferred)*.
- **Correctness:** BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09.
- **Backend/data:** API-04, API-09 (+ the CAS foundation under API-02 covers payments/billing/tasks/notes/change-orders/stage and the portal binding writes).
- **CI/DevOps/observability:** OPS-02, OPS-05, OPS-07 *(log redaction; error-tracking/metrics/alerting deferred)*, OPS-08, OPS-10, OPS-11, OPS-12, OPS-13.
- **Frontend/UX/a11y:** UI-07, UI-08, UI-10, UI-11, UI-14, UI-15, UI-16, UI-17, UI-20, UI-21, UI-22 — plus dead-code removal (`_gen.mjs`/`_poll.mjs`).

**Deferred — needs your decision, infra access, data migration, or an in-browser pass (18):**
| ID | Sev | Why deferred |
| --- | --- | --- |
| **SEC-01** | High | Changes live client-facing behaviour (portal capability token / emailed magic-link) and needs a migration for existing published links → **product sign-off**. Surrounding controls hardened in the meantime (SEC-02/04/06 + CSRF). |
| **UI-02 + UI-04** | High | Console-shell restructure — `<header>`/`<h1>`/landmark split and rendering `ConsoleTopbar` on every page (deleting the hand-rolled bars). Touches 7 pages' layout; best done as one change **with an in-browser verification pass** (offered). |
| **UI-03 / API-11** | High/Low | Dashboard/`/clients` read-every-record — the fix is a denormalised aggregate/rollup maintained on write; a **data-model change** worth doing deliberately (and verifying the numbers). |
| SEC-09 | Info | Double-submit CSRF token — deliberate defence-in-depth trade; Origin + `SameSite=Lax` already sound. |
| SEC-10 | Info | `style-src 'unsafe-inline'` — needs migrating ~36 components' inline styles; documented trade. |
| SEC-05 (egress) | Low | Chromium network isolation for semi-trusted design HTML — deployment-level; blocking egress can break designs that load remote assets. (DoS half fixed.) |
| OPS-01 (SHA) | High | SHA-pinning needs live GitHub to resolve each `@vN` tag → commit SHA (offline here). Dependabot `github-actions` added to maintain pins once applied. |
| API-05 | Med | Zod at every request + document boundary — larger; keep schemas in step with `types.ts`. |
| API-06 | Med | Client-creation idempotency key + background queue — the queue is a Phase-4 change. |
| API-10 | Low | Proxy gate stale-while-revalidate / low-latency shared store. |
| API-12 | Low | Reconcile over the full stored-open set (paged) + a GC cron for orphaned render/upload objects. |
| API-13 | Info | Integer-minor-unit money — needs a stored-amount migration; latent at whole-rupee scale. |
| OPS-03 | Med | 3 crons vs the Hobby 2-cron cap — **verify the Vercel plan** (assumption); consolidate or upgrade. |
| OPS-04 | Med | Make `security`/`workflows` required checks — a **GitHub branch-ruleset** change (assumption). |
| OPS-06 / OPS-09 | Med/Low | Raise the coverage floor, include `components/**`, add a Playwright a11y/perf CI job — runner-budget/infra. |
| OPS-07 (tracking) | Med | Error tracking + metrics + alerting — **infra** (Sentry/metrics backend). Log redaction is done. |
| OPS-14 | Info | Bind ops workflows to a protected GitHub Environment with required reviewers — **GitHub config**. |
| UI-12 | Low | Image dimensions / `next/image` — needs the real cover/thumbnail aspect ratios. |
| UI-13 | Low | Relay-latency copy in busy labels — subjective; only inaccurate when Ops-via-Actions is on. |

*(OPS-15 is informational — controls verified correct, no action.)*

## 2. Findings by severity

| Severity | Count | IDs |
| --- | --- | --- |
| **Critical** | 0 | — |
| **High** | 10 | API-01, API-02, BUG-01, SEC-01, UI-01, UI-02, UI-03, UI-04, UI-18, OPS-01 |
| **Medium** | 25 | SEC-02/03/04, API-03/04/05/06, UI-05/06/07/08/09/10/19/20, OPS-02/03/04/05/06/07/08, BUG-02/03/04 |
| **Low** | 25 | SEC-05/06/07/08, API-07/08/09/10/11/12, UI-11/12/13/14/21/22, OPS-09/10/11/12/13, BUG-05/06/07/08 |
| **Info** | 9 | SEC-09/10, API-13, UI-15/16/17, OPS-14/15, BUG-09 |
| **Total** | **69** | |

By domain: Security 10 · Backend/Data 13 · Frontend/UX/A11y 22 · CI-CD/DevOps 15 · Bug-hunt 9.

---

## 3. Prioritized fix order

Critical → High → Medium → Low, with quick wins interleaved. `(S/M/L)` = rough effort.

**Tier 0 — confirm + fix now (High, small, high-impact):**
1. **API-01** exempt `/api/github/process` from the proxy gate (or move under `/api/cron/`) — `(S)`. *Confirm at runtime first.*
2. **OPS-01** pin Actions to SHAs + add Dependabot `github-actions` — `(S)`.
3. **SEC-01** gate the *binding* portal actions (accept/sign) behind an emailed one-time token; add an unguessable capability token to portal links — `(M)`.
4. **BUG-01** make the two PR transports produce the same field contract, or treat absent `mergeableState`/`behindBy` as "readiness unknown" (fail safe) — `(M)`. *Confirm against live protection rules.*

**Tier 1 — High (correctness / data safety):**
5. **API-02** route money/array client-record mutations through CAS (409-on-conflict), use stable ids not array indices — `(M)`.
6. **UI-03** precompute dashboard aggregates on write; paginate `/clients` — `(M)`.
7. **UI-01 / UI-18 / UI-02 / UI-04** the console-shell a11y/UX cluster: shared `<FormError>`/`<StatusLine>` primitive with `role`/`aria-live`; real labels; `<header>` outside `<main>` + one `<h1>`; render `ConsoleTopbar` on every page — `(M)`.

**Tier 2 — Medium quick wins (small, safe):**
8. **BUG-02** circuit breaker `===` → `>=` re-arm — `(S)`. **BUG-08** floor `Retry-After` at `MIN_WAIT_MS` — `(S)`. **BUG-05** rate-limit snapshot per-resource — `(S)`.
9. **OPS-02** checksum-verify shellcheck; **OPS-05** add `permissions: contents: read`; **OPS-13** `timeout-minutes`; **OPS-10** `.nvmrc` + `engines`; **OPS-11** `.env.example`; **housekeeping** delete `_gen.mjs`/`_poll.mjs` — `(S)`.
10. **BUG-03 / BUG-04** reconcile-masks-outage and notification-grouping CAS — `(M)`.

**Tier 3 — Medium (structural):** API-03 (strict reads in projection), API-04 (`mapLimit` the GitHub fan-out), API-05 (Zod at boundaries), API-06 (idempotency key), SEC-02/03/04 (shared-store rate limit, gate-open alerting, constant-time compares), OPS-03/04/06/07/08 (crons cap, required checks, coverage floor + a11y in CI, observability/alerting, SBOM/Dependabot), UI-05..UI-20 remainder.

**Tier 4 — Low / Info:** the remaining polish, defence-in-depth and roadmap items (SEC-05..10, API-07..13, UI-11..22, OPS-09/12/14/15, BUG-06/07/09).

---

## 4. Architecture & Inventory (Phase 1)

**Stack:** Next.js 16.3.0 (App Router; middleware is `proxy.ts`, renamed in Next 16), React
19.2.8, TypeScript ^6 (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` +
`verbatimModuleSyntax`), Zod 4, npm (lockfile committed). PDF via `puppeteer-core` +
`@sparticuz/chromium`. CI on Node 24. `npm audit`: **0 vulnerabilities**; minor updates available,
majors deliberately held.

**Sizing:** ~30.0K LOC production (`lib` 13.1K, `app` 8.8K, `components` 8.1K) + 14.0K test LOC.
**39 API route handlers**, **54 components**, **44 test files**.

**Architecture:** one Vercel deployment, three audiences by host. Two halves sharing plumbing:
the **client-document platform** (AI-drafted docs per client subdomain, immutable HTML+PDF) and
the **engineering console** (`/github/*`, a local projection of the `luminary-dev` org fed by a
webhook pipeline in the self-contained `lib/github/**`). **Storage is Cloudflare R2** (one JSON
object per entity, CAS on shared objects), not Postgres. Background work is `after()` + Vercel
cron; no worker/queue. Request lifecycle: `proxy.ts` (host routing, session gate, CSP nonce,
CSRF) → server components read `lib/store.ts`/`lib/github/projection.ts` → route handlers
validate/act/audit, returning RFC 9457 problems via `lib/errors.ts`.

**Trust boundaries.** Public/unauthenticated by design: `/api/github/webhook` (HMAC), `/api/cron/*`
(bearer), `/login`, `/api/auth`, PWA assets, and **all `/c/[slug]/**` client-portal routes on
client subdomains**. Session-gated: console pages, `/api/clients/**`, `/api/github/**` (except
webhook), `/api/publish/**`, `/api/ops/relay`, asset streaming. Highest-risk surfaces:
unauthenticated portal input handlers, the `/api/ops/relay`→Actions dispatch path, and
Chromium PDF rendering of semi-trusted HTML.

**Config/secrets:** env-var driven (README table). **No `.env.example`, no `.nvmrc`/`engines`.**
`.env.local` present but correctly **gitignored and never committed** (verified across full
history); no secrets in git history.

**Dead code / orphans:** `_gen.mjs`, `_poll.mjs` (root scratch scripts hardcoded to the
`eco-mech` slug, referenced nowhere) → remove. `IMPROVEMENTS.md` (57KB) and the `docs/audit/**`
tree are prior-audit artifacts. No meaningful TODO/FIXME backlog in code.

---

## 5. Findings

Template per finding: Severity · Category · Location · What · Why it matters · Evidence · Fix ·
Status · PriorRef. Status `Found` = reported, not yet fixed (report-first per Section 6).

### A. Security & Auth (OWASP Top 10:2025)

#### [SEC-01] Client portal has no unguessable capability token — enumerable slug grants disclosure and lets anyone forge a binding acceptance/signature
- Severity: **High** · Category: OWASP A06 Insecure Design (also A01)
- Location: read: `app/c/[slug]/[doc]/route.ts:16-38`; write: `app/c/[slug]/accept/route.ts:25-108`, `.../sign-contract/route.ts:26-89`, `.../select-design`, `.../design-feedback`, `.../comment`, `.../submit`, `.../upload`; slug: `app/api/clients/route.ts:31-52`.
- What: The whole unauthenticated portal is addressed by `<slug>.luminary-dev.xyz` where `slug` is a kebab-cased company name. No per-client secret, signed link, or client login. Knowing/guessing a slug lets anyone (a) GET every published doc (PII + pricing) and (b) POST `/accept` and `/sign-contract` recording an acceptance / e-signature under an **attacker-supplied name**.
- Why it matters: Confidentiality (competitor/partner terms & PII leak) and integrity/impersonation (forge acceptance of a quotation or e-signature of a Services Agreement — the code even cites Sri Lanka's Electronic Transactions Act). The stored `ip` is spoofable (SEC-06), so it isn't reliable evidence.
- Evidence: `accept/route.ts` takes `body.name` verbatim; only gates are rate limit + honeypot + `quotation.status === "published"` + not-already-accepted (verified in code). `sign-contract` is identical.
- Fix: Put an unguessable per-client token in the portal link (random 128-bit, stored on the record, required as path/query/cookie), or require an emailed magic-link before binding actions. Minimum: gate `accept`/`sign-contract` behind a one-time email token. Trade-off: one extra step in the client flow.
- Status: Found · PriorRef: new

#### [SEC-02] Portal rate limiting is per-instance in-memory and fails open
- Severity: Medium · Category: OWASP A06
- Location: `lib/ratelimit.ts:33-59`, `:90-109`, `:139-172` (fail-open at :148, :170-171); call sites in the `/c/[slug]/*` routes.
- What: Every portal bucket except `auth` is `SHARED:false`, so counters live in a per-function `Map` — effective ceiling `limit × instances`, reset on cold start. `accept`/`sign-contract` share a 5/10min bucket *per instance*. The shared `auth` limiter also degrades to in-memory on store error or `ip==="unknown"`.
- Why it matters: This is the only throughput brake on the forgeable binding endpoints (SEC-01) and the upload signer; weak against scripted forgery/spam. Fail-open removes even the auth ceiling on a storage blip.
- Evidence: `SHARED = {submit:false, upload:false, accept:false, auth:true, comment:false, assist:false}`; `rateLimitShared` returns `null` (allow) on catch.
- Fix: Back the portal buckets with the shared store, keyed per-slug + per-IP; stricter global ceiling on binding actions.
- Status: Found · PriorRef: LC-013 (residual — only `auth` became shared)

#### [SEC-03] Session-allowlist gate fails open on a session-store error
- Severity: Medium · Category: OWASP A01 (also A10)
- Location: `proxy.ts:44-72` (catch → `gate.sids=null` :55; `sidAllowed` returns true when null, :65/:71).
- What: When `liveSids()` throws, the proxy accepts any signature-valid unexpired token — including revoked sids (LC-010) and de-provisioned operators (GAP-3.5a) — for the outage duration (≤24h abs cap).
- Why it matters: A stolen/"signed-out"/removed operator's cookie survives a session-store outage. Deliberate, documented availability-vs-confidentiality trade, but should be observable.
- Evidence: `if (gate.sids === null) return true;` (`proxy.ts:65`).
- Fix: Keep fail-open if availability demands, but (a) emit a high-severity metric/log whenever the gate serves open (A09), and (b) consider a short grace window (tokens issued within N min) instead of accepting all. A low-latency shared session store shrinks the window.
- Status: Found · PriorRef: LC-010 (residual — by design)

#### [SEC-04] Session/pending/OTP HMACs compared with non-constant-time `!==`
- Severity: Medium · Category: OWASP A04 (also A07)
- Location: `lib/auth.ts:58`, `app/api/auth/route.ts:36`, `lib/otp.ts:117`.
- What: The session-cookie signature, login "pending" cookie signature, and stored OTP HMAC are verified with `!==`/`===`, which short-circuits. The codebase knows better — `lib/github/webhooks.ts:43-48` uses `timingSafeEqual`, `lib/users.ts:66-73` has constant-time `sameBytes`.
- Why it matters: Timing side channel on the primary auth boundary. Network exploitability is hard (jitter, high-entropy secrets), so hygiene not turnkey — but a low-cost fix on the most sensitive compare, inconsistent with the rest of the code.
- Fix: `crypto.timingSafeEqual` (Node) / the `sameBytes` pattern (edge). No behavioural change.
- Status: Found · PriorRef: new (LC-011 covered storage, not compare timing)

#### [SEC-05] Headless Chromium renders operator-uploaded design HTML with no egress restriction, triggerable via a public route
- Severity: Low · Category: OWASP A02/A06 (SSRF surface)
- Location: `app/c/[slug]/design/[id]/pdf/route.ts:34-64` (public fallback render at :63), `lib/pdf.ts:173-193` (`launchBrowser` — no network sandboxing), `:345-441`.
- What: Design previews are arbitrary operator-uploaded HTML rendered in headless Chromium with scripts enabled and no egress controls; the public `/c/<slug>/design/<id>/pdf` route renders on demand when no cached PDF exists.
- Why it matters: (1) SSRF — design HTML/JS/`<img>` can make Chromium fetch internal/link-local resources (bounded to a malicious operator → Low). (2) DoS/cost — the unauthenticated GET can repeatedly spawn a `maxDuration=300` render with no rate limit.
- Fix: Render design HTML in a Chromium locked to loopback/no egress (`--host-resolver-rules`/deny-all proxy/block RFC1918+link-local); rate-limit the public fallback, or only ever serve pre-rendered PDFs to unauthenticated callers.
- Status: Found · PriorRef: LC-016 (adjacent)

#### [SEC-06] Client IP for rate limiting and signature records taken from the spoofable first hop of `x-forwarded-for`
- Severity: Low · Category: OWASP A06
- Location: `lib/ratelimit.ts:61-65` (used :91, :144); `app/c/[slug]/accept/route.ts:72`, `sign-contract/route.ts:57`.
- What: Client IP = first comma element of `x-forwarded-for`. If the platform *appends* to a client-supplied XFF, the first hop is attacker-controlled — enabling fresh rate-limit windows, bucket poisoning, and an arbitrary "signature IP" in the record.
- Why it matters: Undermines every IP-keyed limit (incl. `auth`) and the only forensic control behind SEC-01.
- Fix: Use the platform's non-spoofable client IP (Vercel `x-real-ip` / framework `ip`). **Assumption:** could not verify statically whether this edge replaces vs appends XFF; if it strictly replaces, drops to Info.
- Status: Found · PriorRef: new

#### [SEC-07] Provider errors/responses still logged with raw `console.*`, bypassing the redactor
- Severity: Low · Category: OWASP A09
- Location: `lib/email.ts:31,53`, `lib/telegram.ts:61,66`, `lib/push.ts:95,105`, `lib/sessions.ts:36,59`, portal routes `submit/:240`, `accept/:88`, `sign-contract/:70`, `upload/:69`, `app/api/logout/route.ts:27`.
- What: A thorough redactor (`lib/redact.ts`) and single sink (`lib/logger.ts`) exist, but many failure paths call `console.error/warn` directly with provider error objects / response bodies, so contents never pass the redactor.
- Why it matters: Provider errors and `cause` chains carry tokens, presigned-URL material, emails/phones — exactly what the redactor strips — landing raw in the log drain.
- Fix: Route through `logger.error(msg, { err })`; add a `no-console` lint rule outside `lib/logger.ts`.
- Status: Found · PriorRef: LC-017 (residual; ~40+ raw sinks remain)

#### [SEC-08] No role separation — any operator can act on any client and revoke any operator's sessions
- Severity: Low · Category: OWASP A01
- Location: `app/api/sessions/route.ts:20-56`; every `app/api/clients/**`; `app/api/clients/[slug]/route.ts:105-110` (`anyUserPassword`).
- What: Authorization is binary. Any operator can read/mutate/delete any client, view all operators' session metadata, and `revokeAll`. Deletion re-verifies *any* user's password, not the actor's.
- Why it matters: Largely by design for a 3-person studio, but one compromised account has full lateral reach (mass deletion, sign-everyone-out) with no containment, and the audit trail can be muddied.
- Fix: Roles + scope destructive/cross-operator actions; require the *acting* operator's own credential for deletion/step-up.
- Status: Found · PriorRef: LC-061 (residual — Not fixed)

#### [SEC-09] Cookie-authed mutations rely on an Origin check only (no CSRF token), every client subdomain trusted same-site
- Severity: Info · Category: OWASP A01
- Location: `lib/csrf.ts:55-116` (:71 trusts `*.root`; :114-115 allows no-Origin-no-Referer), enforced `proxy.ts:260-274`.
- What: CSRF defence is `SameSite=Lax` + Origin/Referer allowlist trusting console host, apex, and **every** `*.luminary-dev.xyz` subdomain; no double-submit token; requests with neither Origin nor Referer allowed.
- Why it matters: Adequate today (Lax + sandboxed design iframes send `Origin: null` → refused). Residual risk is broad sibling-subdomain trust if a subdomain ever served attacker-influenced content.
- Fix: Add a double-submit token for defence-in-depth; keep subdomain content strictly app-controlled/sandboxed.
- Status: Found · PriorRef: LC-014 (residual — token deliberately deferred)

#### [SEC-10] Console CSP retains `style-src 'unsafe-inline'`
- Severity: Info · Category: OWASP A05 (defence-in-depth)
- Location: `lib/csp.ts:74` (rationale :60-64).
- What: Otherwise-strict console CSP (nonce + `strict-dynamic`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`) keeps `'unsafe-inline'` for styles because ~36 components use inline `style={{}}`.
- Why it matters: Script injection well contained; inline-style injection is a weak vector (CSS exfil / UI-redress) only if markup injection is found.
- Fix: Migrate inline styles to classes / nonce'd `<style>` and drop `'unsafe-inline'`, or accept the documented trade.
- Status: Found · PriorRef: LC-012 (residual)

### B. Backend, API & Data layer

#### [API-01] Scheduled GitHub processing sweep is unreachable — cron path not exempt from the proxy session gate
- Severity: **High** · Category: Backend / Data-integrity
- Location: `proxy.ts:186-213` + `:229-244` vs `vercel.json` crons (`/api/github/process`, `0 5 * * *`) and `app/api/github/process/route.ts:43-61`.
- What: `proxy.ts` (Next 16 middleware) matches `/api/github/process` and exempts only `/api/cron/*` and the exact `/api/github/webhook`. A Vercel Cron call carries a bearer and **no session cookie**, so `verifySessionToken(secret, undefined)` → null → proxy returns **401 at `proxy.ts:237-238`** before the route's `cronAuthorized()` ever runs.
- Why it matters: The sweep is the durability backstop for the whole webhook pipeline (`after()` is best-effort) and drives drift `reconcile()`. If 401'd, any delivery whose inline `after()` failed stays `pending` forever and drift is never detected — the console silently diverges from GitHub (the LC-070/LC-086 "console that lies" class). LC-083 fixed the schedule, not reachability. The tell: `backup`/`digest` are under `/api/cron/` (exempt); `github/process` is under `/api/github/` (not).
- Evidence: **Verified.** The route's own header comment (lines 4-9) asserts "a cron call must carry the bearer AND this route verifies it" — unaware the proxy runs first. "Process now" from the signed-in UI works (it carries the cookie), which is why this fails *silently on schedule*.
- Fix: Add `pathname === "/api/github/process"` to the proxy public-path list (route's constant-time bearer becomes the sole cron guard — already the design), or move the route under `/api/cron/github-process`. **Confirm at runtime** (bearer, no cookie → 401; or watch `pending` accumulate).
- Status: Found · PriorRef: new (adjacent LC-083)

#### [API-02] Client-record mutations are last-write-wins; concurrent writes silently lose data, including money
- Severity: **High** · Category: Data-integrity
- Location: `lib/store.ts:552-591` (`saveClient` only CAS when `expectedEtag` passed); mutating routes `app/api/clients/[slug]/{payments,billing,tasks,notes,...}` + public `/c/[slug]/{accept,sign-contract,comment,...}`.
- What: Every route does `getClient → mutate → saveClient()` with no `expectedEtag`. **`getClientWithEtag`/`expectedEtag` have zero callers outside `store.ts`** (verified by grep) — the write is an unconditional PutObject.
- Why it matters: LC-002 residual, worse because it lands on **money**: `payments` does `client.payments=[...,payment]; saveClient(client)`; two near-simultaneous payments → one silently vanishes and outstanding is wrong. Public portal actions can clobber a concurrent operator edit. `remove`/`toggle` use array **index** as identity, so a concurrent add/remove deletes the wrong element.
- Evidence: **Verified.** 36 `saveClient(` sites, none with etag; `store.ts` comment concedes "the existing call sites keep last-write-wins on the record itself."
- Fix: Internal read-modify-write-with-retry CAS mode in `saveClient` (like `updateState`), routes pass the etag and 409 on exhaustion so the UI re-fetches; prefer append-only payment log keyed by id; use stable ids for remove/toggle.
- Status: Found · PriorRef: LC-002 (residual)

#### [API-03] Corrupt GitHub entity objects silently disappear from org-wide lists (lenient reads)
- Severity: Medium · Category: Data-integrity
- Location: `lib/github/projection.ts:227-253`, every `list*`; `lib/github/inbox.ts:144-154`; `readJson` at `store.ts:194-202`.
- What: The projection reads via lenient `readJson` (unparseable → `null`), then `listAllUnder`/`listDeliveries` `filter(r=>r!==null)` — a truncated entity is silently dropped, not surfaced.
- Why it matters: LC-001's "failed read ≠ empty" re-introduced in the GitHub layer. A corrupt `AlertEntity` vanishes from the security view; a corrupt `PullRequestEntity` vanishes from the inbox feeding `mergeReadiness` — the console reports "nothing failing" while an unreadable object says otherwise. No re-derivation on read, so loss is invisible until reconcile rewrites the key.
- Fix: Strict read for the "list the world" hot paths — count parse failures and surface ("N entities unreadable", like the existing `listing_truncated` banner) or throw.
- Status: Found · PriorRef: LC-001-class (new instance)

#### [API-04] Unbounded `Promise.all` fan-out across the GitHub projection/inbox reads
- Severity: Medium · Category: Performance
- Location: `lib/github/projection.ts` (7 sites incl. :240-242 up to `MAX_OBJECTS_SCANNED=5000`), `inbox.ts:145-146,158-159` (up to 1000), `handlers.ts:175,192,546`.
- What: The client store learned bounded fan-out (`mapLimit`, `READ_CONCURRENCY=8`) for LC-030/033, but the GitHub layer reads with raw `Promise.all` over the full key set — up to 5000 concurrent R2 reads per `/github` render.
- Why it matters: The exact connection-storm/memory-spike `mapLimit` exists to prevent, on the main-screen hot path and the cron sweep.
- Fix: Route GitHub bulk reads through `mapLimit(keys, READ_CONCURRENCY, ...)` like `getClients`.
- Status: Found · PriorRef: LC-030/033-class (new instance)

#### [API-05] No schema validation (Zod) at the client/console/portal boundaries; document contracts cast unvalidated
- Severity: Medium · Category: API / Data-integrity
- Location: Zod imported only in `lib/github/schema.ts`; manual validation in the client/portal routes; unvalidated casts at `lib/generate.ts:40`, `lib/publish/draft.ts:22`, `lib/pipeline.ts`, `lib/handover.ts:65-66`, `lib/templates/docs.ts`.
- What: Zod landed at the webhook boundary only. Every other handler validates by hand; every stored/AI document is `JSON.parse`d and cast (`as QuotationData`, etc.) with no runtime validation.
- Why it matters: LC-004 residual. Manual validation is careful (no mass-assignment found — verified), so acute risk is Medium, but a malformed stored/AI doc surfaces as `undefined` deep in a renderer, and there's no shared source of truth for request/response shapes.
- Fix: Zod schemas for each mutating body and each document contract, parsed at boundary and on read-back; `.passthrough()` for stored docs so old records parse.
- Status: Found · PriorRef: LC-004 (residual)

#### [API-06] Client creation synchronous with no idempotency; ops-relay amplifies duplicate/irreversible work
- Severity: Medium · Category: Backend / API
- Location: `app/api/clients/route.ts:7-8,24-101` (`runStage1` inline, `maxDuration=300`), `lib/ops-fetch.ts:18-28`, `app/api/ops/relay/route.ts:28-88`.
- What: `POST /api/clients` drives Claude drafting + Chromium PDF + DNS + email inline, guarded only by a racy slug-uniqueness read, no idempotency key. The relay mints a fresh `requestId` per call and 504s at 270s while the Actions run keeps executing — a retry re-drafts, re-spends budget, re-opens a PR.
- Why it matters: LC-024 residual; the relay makes the duplicate-on-timeout path easy to hit against a 270s poll vs 300s ceiling (the LC-089 "reported failure after irreversible success" class).
- Fix: Accept/derive an idempotency key, persist it, short-circuit duplicates; move drafting/rendering to a queue returning a fast `pending` record.
- Status: Found · PriorRef: LC-024 (Not fixed)

#### [API-07] PR projection write is a non-atomic read-modify-write (check-then-write on `updated_at`)
- Severity: Low · Category: Data-integrity
- Location: `lib/github/projection.ts:59-71` (`putPullRequest`), called from handlers + `processor.ts:270,312`.
- What: `putPullRequest` reads, compares `updated_at`, then unconditionally `writeState`s — no CAS. Two deliveries for the *same* PR both read the old copy, both pass the guard, later write wins regardless of order.
- Why it matters: Bounded — handlers write freshly-fetched entities and reconcile re-reads, so the window self-heals. Hence Low.
- Fix: Use `updateState` with the freshness comparison inside the mutate function (one CAS).
- Status: Found · PriorRef: LC-002-class (new)

#### [API-08] Shared-JSON read-modify-write without CAS in the doc-view receipts map and session registry
- Severity: Low · Category: Data-integrity
- Location: `lib/receipts.ts:23-33` (global `doc_views.json`), `lib/sessions.ts:47-61,93-105`.
- What: `markDocView` rewrites one global map for all clients with no CAS; the session registry read-modify-writes shared arrays. `registerSession` racing `revokeSessions` can resurrect a revoked session or drop a revocation.
- Why it matters: Lost doc-view stamp is cosmetic; a lost revocation weakens the LC-010 sign-out guarantee.
- Fix: Move both onto `updateState` (CAS); prefer per-client keys for doc-views.
- Status: Found · PriorRef: LC-002-class (residual)

#### [API-09] ops-relay leaks raw dispatch error text, bypassing the RFC 9457 taxonomy/redaction
- Severity: Low · Category: API
- Location: `app/api/ops/relay/route.ts:59-66` (`error: \`Ops dispatch failed: ${e.message}\``), also :32,:35,:80-87.
- What: The relay returns interpolated raw error strings and ad-hoc `{error}` bodies, not `problemResponse`/`toProblem`; no `requestId`, no redaction.
- Why it matters: The exact pattern LC-005 removed elsewhere, re-appearing; a GitHub-API error detail reaches browser + logs unredacted. Low (operator-only).
- Fix: `problemResponse(e, "ops relay")`; problem-details bodies for the 4xx cases.
- Status: Found · PriorRef: LC-005-class (residual)

#### [API-10] Proxy session-allowlist refresh runs inline on the request path (60s cache)
- Severity: Low · Category: Caching / Performance
- Location: `proxy.ts:44-72` → lazy `import("@/lib/sessions")` → `liveSids()` → R2.
- What: On cache expiry, `sidAllowed` `await`s a full R2 round trip + SDK cold load inline before the page renders (~850ms measured in LC-031). Miss-coalescing helps a burst, not the miss latency.
- Why it matters: Once/min/instance a real user pays the store round trip in the proxy.
- Fix: Stale-while-revalidate (serve cached, refresh in background) or a low-latency shared store.
- Status: Found · PriorRef: LC-031 (Not fixed)

#### [API-11] Dashboard / export / backup / digest read every client record on every call (no pagination)
- Severity: Low · Category: Performance
- Location: `app/page.tsx:39`, `app/api/clients/export/route.ts:24`, `app/api/cron/backup/route.ts:111`, `app/api/cron/digest/route.ts`.
- What: Fan-out is bounded (concurrency 8) and tables virtualize, but the *set* read is still all clients — O(N) object reads per dashboard load; no pagination/aggregate.
- Why it matters: LC-030 residual; fine now, outside section-10 budgets as N grows. (See UI-03, same root.)
- Fix: Precompute dashboard aggregates into index entries; paginate/stream the index.
- Status: Found · PriorRef: LC-030 (residual)

#### [API-12] `reconcile()` only checks the 50 most-recent PRs; orphaned R2 objects never collected
- Severity: Low · Category: Data-integrity / Performance
- Location: `lib/github/processor.ts:250-252` (`reconcile(50)`), `app/api/github/process/route.ts:84`; `lib/pipeline.ts:65`; `app/c/[slug]/upload/route.ts`.
- What: (a) Drift reconcile enumerates only the 50 most-recently-updated stored PRs — older ones never compared, phantom "still open" PRs never removed. (b) LC-058 residual: evicted doc-history renders and never-submitted presigned uploads linger; no GC cron.
- Why it matters: Latent now; (a) undermines the drift signal as the org grows (and compounds API-01), (b) is slow storage growth.
- Fix: Reconcile in bounded pages over the full stored-open set; add a GC cron with a TTL sweep.
- Status: Found · PriorRef: LC-058 (Not fixed) + new (reconcile bound)

#### [API-13] Money is JS floating-point rupees end to end, not integer minor units
- Severity: Info · Category: Data-integrity
- Location: `lib/money.ts:11-18,29-33,102-121`, `app/api/clients/[slug]/payments/route.ts:56`, `lib/pricing.ts:55,64,92-93`.
- What: All money is `number` (rupees, sometimes fractional) summed/compared as IEEE-754; "settled" hinges on float subtraction of summed floats.
- Why it matters: Fine at whole-rupee scale (the common case; `parseAmount` rejects prose), but decimal amounts can drift sub-rupee and a "settled" decision can hinge on `1e-9`.
- Fix: Represent money as integer cents (or a decimal type) at the boundary, format at the edge, compare on integers/epsilon. (Assumption: whole-rupee totals dominate → risk latent.)
- Status: Found · PriorRef: LC-003-adjacent (representation vs semantics)

### C. Frontend, UX & Accessibility (WCAG 2.2 AA)

#### [UI-01] Async error/status messages not announced to assistive tech (systemic)
- Severity: **High** · Category: WCAG 2.2 (4.1.3 Status Messages; 3.3.1)
- Location: 21 of 23 `form-error` blocks + success/busy toggles: `app/login/page.tsx:98,123`, `app/clients/new/page.tsx:121`, and ~20 card/portal components (BillingCard, TasksCard, NotesCard, DeleteClient, SiteCard, AssistantCard, DocActions, HandoverCard, ChangeOrders, PublishStudio, PortalDesigns/Comments/Uploads, RetryStage2, StageSelect, DesignsCard, CopyLink, EmailDocButton, SendToClient, SessionsCard).
- What: Async failure/success messages are inserted as plain `<div/span/p>` with no `role="alert"`/`aria-live`; some "done" states are just a changed button label. Only `QuestionnaireForm` got the fix.
- Why it matters: A screen-reader user gets no notification a save/submit failed — worst on `login` (unavoidable) and the client-facing portal. Direct 4.1.3 failure, systemic.
- Evidence: `grep 'className="form-error"'` → 23 hits; `role="alert"`/`aria-live` on ~2.
- Fix: `role="alert"` on inserted errors; persistent `aria-live="polite"` region for non-error status; associate the label-by-placeholder textareas. A shared `<FormError>`/`<StatusLine>` primitive closes all at once.
- Status: Found · PriorRef: LC-043 (residual — broader than the two sites recorded)

#### [UI-02] Console operator pages have no `<h1>` and render nav inside `<main>`
- Severity: **High** · Category: WCAG 2.2 (1.3.1, 2.4.6, 2.4.1)
- Location: `components/ConsoleTopbar.tsx:84-88`; hand-rolled bars inside `<main>` at `app/clients/[slug]/page.tsx:71-89`, `app/activity/page.tsx:36-54`, `app/clients/new/page.tsx:51-69`, `app/settings/page.tsx:22-36`, `app/login/page.tsx:61-68`; cards jump to `<h3>`.
- What: Every operator page's top element is `<main>` containing the topbar + nav; no `<header>` landmark, no `<h1>`, headings start at `<h3>`.
- Why it matters: "Skip to main" lands on a region that is the whole page; heading nav broken. The **GitHub section and portal next door do it correctly** (`<h1 class="gh-h1">`, `id={MAIN_ID}` on `<main>`), so the correct pattern already exists in-repo.
- Evidence: `grep '<h1' app` → only under `app/github/**` + `global-error`.
- Fix: `<header>` outside `<main>`; page content is `<main id={MAIN_ID}>`; one `<h1>` per page; promote card `<h3>`→`<h2>`.
- Status: Found · PriorRef: ACCESSIBILITY-FINDINGS (deferred; now inconsistent with the shipped GitHub shell)

#### [UI-03] Dashboard and /clients read every full client record on every load
- Severity: **High** · Category: Performance-FE / Scalability
- Location: `lib/console-overview.ts:40-42`, called by `app/page.tsx:34` + `app/clients/page.tsx:17`; both `force-dynamic`.
- What: `loadClientOverview()` reads the full record for every client (concurrency-8, still one R2 read each) to compute outstanding/overdue/stage; both pages re-read the whole set on every navigation with no cache/pagination.
- Why it matters: LC-030 fan-out residual; O(N) reads per navigation at the 100/1000-client target; no aggregate/query layer.
- Evidence: `console-overview.ts:37-39` concedes "genuinely needs every record read"; both pages `force-dynamic`.
- Fix: Precompute aggregates into the index/rollup on write (hub reads O(1)); paginate the client list.
- Status: Found · PriorRef: LC-030 (residual)

#### [UI-04] Section navigation is inconsistent — four pages cannot reach other sections on the web
- Severity: **High** · Category: UX
- Location: `ConsoleTopbar` used only by `app/page.tsx:43`, `app/clients/page.tsx:21`, `app/publish/page.tsx:18`; hand-rolled bars with no section nav on client detail, activity, new-client, settings.
- What: Only three pages render the `Clients / Engineering / Activity / Publish` nav; the other four have only brand + "← Dashboard". On the (non-installed) web these pages can't reach another section without bouncing through the dashboard. The installed app hides it via `AppTabBar` (standalone-only).
- Why it matters: The rebuild introduced a consistent menu but applied it to three pages, recreating the "nav rearranges between pages" problem `ConsoleTopbar` was written to end.
- Fix: Render `ConsoleTopbar` on every console page (correct `current`); delete the hand-rolled bars.
- Status: Found · PriorRef: UX-01 (partial rebuild created the inconsistency)

#### [UI-05] `<html lang>` never switches to Sinhala; questionnaire failure strings hardcoded English
- Severity: Medium · Category: i18n / WCAG 2.2 (3.1.1)
- Location: `app/layout.tsx:42` (`<html lang="en">`), `components/QuestionnaireSheet.tsx:61` (`lang` on `<main>` only), English literals in `QuestionnaireForm.tsx:151,165,172,176-177,425` (`t.errGeneric` unreachable at :436).
- What: Switching the questionnaire to Sinhala changes only `<main lang="si">`; the document root stays `en`; all upload/submit failure strings are literal English.
- Why it matters: Wrong page language for a fully-Sinhala page; a Sinhala client reads English errors.
- Fix: Drive `<html lang>` from the chosen language; route failure strings through `strings(lang)`; make `errGeneric` reachable.
- Status: Found · PriorRef: LC-059 (Not fixed)

#### [UI-06] Read-state mutated during GET render (opening a page clears unread for the whole team)
- Severity: Medium · Category: UX / Next.js render side-effect
- Location: `app/activity/page.tsx:29` (`markNotificationsSeen()` in render), `app/clients/[slug]/page.tsx:63` (`markClientSeen`).
- What: Rendering Activity writes a global "seen" mark for every operator; rendering a client page clears that client's mark — a write as a side-effect of a GET render.
- Why it matters: (a) read state is global, so one person opening Activity zeroes the team's badge; (b) writing during render is fragile in the App Router — a future prefetch/replay would re-fire it (safe today only incidentally via `force-dynamic`).
- Fix: Move "mark seen" to an explicit action (POST/Server Action); make read-state per-operator.
- Status: Found · PriorRef: UX-30/UX-31

#### [UI-07] Global skip link points to `#main-content`, absent on login, portal and questionnaire
- Severity: Medium · Category: WCAG 2.2 (2.4.1 Bypass Blocks)
- Location: `components/SkipLink.tsx:16` (global via `app/layout.tsx:50`); target missing on `app/login`, `app/c/[slug]/page.tsx`, questionnaire (`QuestionnaireSheet`).
- What: The skip link is the first tab stop everywhere, but `#main-content` exists only on console + GitHub pages. On login/portal/questionnaire it moves nothing — a dead anchor on client-facing pages.
- Fix: Add `id={MAIN_ID} tabIndex={-1}` to `<main>` on those pages, or render `SkipLink` only where a target exists.
- Status: Found · PriorRef: LC-042 (fixed for console only)

#### [UI-08] Login page hydration mismatch on the timed-out banner
- Severity: Medium · Category: Frontend (hydration)
- Location: `app/login/page.tsx:17` (`timedOut` from `window.location.search`), rendered :70.
- What: `timedOut` reads `window` during render of a client component; server pre-render omits the "signed out" notice, client with `?timedout=1` renders it → tree divergence.
- Why it matters: `/login?timedout=1` is the exact idle-timeout redirect (`SessionGuard.tsx:39`) → hydration mismatch (LC-087/088 class), console error + possible flash.
- Fix: `useSearchParams()`, or initialize in `useState`/`useEffect` after mount.
- Status: Found · PriorRef: new

#### [UI-09] No route-level loading states on console pages; slow navigations show a frozen page
- Severity: Medium · Category: Performance-FE / UX
- Location: no `loading.tsx` anywhere; console pages render fully server-side + `force-dynamic`.
- What: No loading boundary at any segment. GitHub pages stream via `<Suspense>`; console pages await all store reads before returning UI, so App Router keeps the old route on screen with no indicator until render finishes (which for hub/clients means reading every record — UI-03).
- Fix: Add `loading.tsx` skeletons per segment, or wrap slow data in `<Suspense>` like GitHub.
- Status: Found · PriorRef: UX-63 (expands)

#### [UI-10] Native console-only checkboxes fail the 24×24 target-size minimum
- Severity: Medium · Category: WCAG 2.2 (2.5.8)
- Location: `components/TasksCard.tsx:109-115`, `DocActions.tsx:181-186`, `PublishStudio.tsx:200-204,214`.
- What: Bare `<input type="checkbox">` (~13-15px) with no coarse-pointer sizing; LC-091 sized the questionnaire/accept ones but left these.
- Why it matters: Operator controls used on phones; the task checkbox is the primary Tasks interaction. Under the 24×24 AA floor.
- Fix: Apply the `.q-check` sizing / a shared checkbox component.
- Status: Found · PriorRef: LC-091 (residual, self-noted)

#### [UI-11] SessionGuard pings an authed endpoint on client-facing pages, 401-ing on every load
- Severity: Low · Category: UX / Frontend
- Location: `components/SessionGuard.tsx:15,20-23,29` (only `/login` in `NO_SESSION_PATHS`).
- What: SessionGuard skips the ping on `/login` but still fires `/api/ping` on `/c/[slug]` + questionnaire, which 401s — console errors on client-facing pages every load (acknowledged in the code comment).
- Fix: Add portal/questionnaire paths (or any non-console host) to the skip set, or gate the ping on host.
- Status: Found · PriorRef: UX-21 (residual)

#### [UI-12] Raw `<img>` without dimensions in the publish studio (CLS, no next/image)
- Severity: Low · Category: Performance-FE
- Location: `components/PublishStudio.tsx:85,87,89,90`.
- What: Cover/illustration/thumbnail previews render as raw `<img>` with only CSS width + `height:auto` — no intrinsic dimensions, so no reserved height until decode (~200KB base64 covers). No `next/image` anywhere.
- Fix: Explicit width/height or an aspect-ratio box; `next/image` for R2-hosted thumbnails.
- Status: Found · PriorRef: new

#### [UI-13] Mutations relay through a CI runner (~30–60s); busy labels understate the wait, no cancel
- Severity: Low · Category: UX
- Location: `lib/ops-fetch.ts:11-13`; labels `BillingCard.tsx:263,426` ("~20s"), `clients/new/page.tsx:125`.
- What: Every `/api/clients` + `/api/publish` mutation runs on a runner via `/api/ops/relay` (+30-60s spin-up); busy labels quote only op time, so the real wait is ~50-80s; no progress, no cancel; navigating away loses the result.
- Fix: Reflect relay latency in labels, or move to background jobs with a visible queue.
- Status: Found · PriorRef: UX-14, LC-024

#### [UI-14] GitHub urgent status callouts stream in without a live region
- Severity: Low · Category: WCAG 2.2 (4.1.3)
- Location: `components/github/AlertList.tsx:91-105`, `app/github/deployments/page.tsx:170-198,274-289`, `components/github/GithubNav.tsx:99-124`, `app/github/page.tsx:71-81`.
- What: "N leaked secrets", failed-deployment and store-failure callouts stream in after paint inside `<Suspense>` but are plain `<div/p>` with no `role="alert"`. (Loading skeletons *are* announced, so the pattern exists.)
- Fix: `role="alert"` / `aria-live="assertive"` on urgent callouts.
- Status: Found · PriorRef: new

#### [UI-15] ThemeToggle exposes no current-state to assistive tech
- Severity: Info · Category: WCAG 2.2
- Location: `components/ThemeToggle.tsx:61` (good name, no `aria-pressed`).
- Fix: Add `aria-pressed` reflecting the active theme (read after mount to avoid mismatch).
- Status: Found · PriorRef: new

#### [UI-16] reduced-motion covers only skip link and modal; hover transforms unguarded
- Severity: Info · Category: WCAG 2.2 (2.3.3 is AAA — polish)
- Location: `app/globals.css` — reduced-motion blocks only at :82, :484; unguarded transforms at :718, :720, :314, :189.
- Fix: A catch-all reduced-motion block neutralizing non-essential transitions.
- Status: Found · PriorRef: ACCESSIBILITY-FINDINGS reduced-motion note

#### [UI-17] Client-facing decorative check glyphs + verbatim client-side console logging
- Severity: Info · Category: Convention / Observability
- Location: `components/QuestionnaireForm.tsx:443` (`✓` not `aria-hidden`), `components/PushToggle.tsx:112` (`console.error` raw).
- Fix: `aria-hidden="true"` on decorative glyphs; drop/redact the client-side error log.
- Status: Found · PriorRef: LC-050, LC-017

#### [UI-18] Multiple form controls have no programmatic label
- Severity: **High** · Category: WCAG 2.2 (4.1.2, 3.3.2)
- Location: `AssistantCard.tsx:224` (email-body textarea — *no* name at all), `:145,:216` (placeholder-only); `ChangeOrders.tsx:88,92` (unassociated `<span class="q-label">` in a `<div>`); `DocActions.tsx:166`; `PortalDesigns.tsx:147` (client-facing); `SiteCard.tsx:87,88,98`.
- What: No `<label htmlFor>`, no wrapping `<label>`, no `aria-label`. The ChangeOrders pattern is the exact `div>span+input` shape IX-003 fixed on login/new-client, reproduced in components behind toggles/overlays the axe run never opened.
- Why it matters: A screen reader can't name these; the AssistantCard body announces "edit text, blank". IX-003 reported 0 label violations, so this is a real regression/gap; one is client-facing.
- Fix: Wrap each control in a `<label>` or add `htmlFor`/`id`; convert ChangeOrders wrapper to `<label>`. Add axe to CI so overlay/card controls are traversed.
- Status: Found · PriorRef: IX-003 (fixed only on measured pages), LC-043

#### [UI-19] SessionsCard fetches data client-side, so Settings shows a "Loading…" flash
- Severity: Medium · Category: Frontend (client/server boundary)
- Location: `components/SessionsCard.tsx:46-54` (fetch in `useEffect`, "Loading…" :119); `app/settings/page.tsx:38`.
- What: The devices list is fetched in a client effect even though Settings is already an async server component — an authed round-trip after hydration + a loading flash.
- Fix: Read sessions server-side, pass as initial prop; keep the client component for revoke/refresh only.
- Status: Found · PriorRef: new

#### [UI-20] Index used as React key on a list deleted by index
- Severity: Medium · Category: Frontend (React key misuse)
- Location: `components/ChangeOrders.tsx:54` (`key={i}`), removed by index at :63-70.
- What: Index keys + delete-by-index + optimistic update: removing a middle row shifts indices, so React reuses DOM/state across logical rows (wrong transient state, focus jumps).
- Fix: Key by a stable field (`at`/id); prefer id-based removal.
- Status: Found · PriorRef: new

#### [UI-21] Change-order line items deleted with no confirmation
- Severity: Low · Category: UX (destructive action)
- Location: `components/ChangeOrders.tsx:63-70` (immediate remove).
- What: Every other destructive action uses `useConfirm()`; change-order "Remove" deletes a billable line item immediately, no dialog/undo.
- Fix: Gate behind `useConfirm({ danger: true })`.
- Status: Found · PriorRef: new

#### [UI-22] Hardcoded hex colors remain in a few inline styles
- Severity: Low · Category: Frontend / dark-mode
- Location: `DesignsCard.tsx:124,153`, `PortalDesigns.tsx:118`, `SiteCard.tsx:68`.
- What: A `#d33` danger fallback and a `#0d0d0f` near-black on accent pills survive IX-010; `#0d0d0f` doesn't adapt to theme and wasn't contrast-verified.
- Fix: `var(--danger)` without literal fallback; a token for the pill on-color.
- Status: Found · PriorRef: IX-010

### D. CI/CD, DevOps, Dependencies, Observability, Testing, Config, Docs

#### [OPS-01] GitHub Actions pinned by mutable tag, not commit SHA
- Severity: **High** · Category: Supply-chain A03 / CI-CD
- Location: `.github/workflows/ci.yml:24,26,40,52,54,89,141`; `ops-run.yml:101,103`; `ops-add-project.yml:33,36`; `ops-new-client.yml`; `ops-publish-article.yml:56,58`; `release-tag.yml:20`.
- What: Every `uses:` references a floating major tag (`@v7`/`@v5`), not a 40-char SHA.
- Why it matters: A tag is mutable; a repointed/hijacked tag runs with whatever the job holds. Acute because `ops-run.yml:69-98` injects **every production secret** (ANTHROPIC/R2/RESEND/SESSION_SECRET/CLOUDFLARE/GH_APP_PRIVATE_KEY/VERCEL/OPENAI/LANDING_REPO_TOKEN/TELEGRAM) — a compromised `checkout`/`setup-node` could exfiltrate all of them.
- Fix: Pin each action to a full SHA with the tag in a trailing comment; add Dependabot `github-actions` to keep pins current.
- Status: Found · PriorRef: new

#### [OPS-02] `shellcheck` binary downloaded and executed with no checksum verification
- Severity: Medium · Category: Supply-chain A03 / CI-CD
- Location: `.github/workflows/ci.yml:103-112`.
- What: The `workflows` job curls + `sudo install`s shellcheck with no `sha256sum -c`, unlike the sibling actionlint (:122) and gitleaks (:167) steps which verify.
- Why it matters: A tampered asset / MITM runs an attacker binary in CI — the exact thing the gitleaks comment warns against. (Mitigated: the job carries no secrets.)
- Fix: Verify shellcheck's published checksum before install.
- Status: Found · PriorRef: new (LC-084 covered gitleaks/actionlint)

#### [OPS-03] `vercel.json` declares 3 crons; likely exceeds the Hobby-plan cap
- Severity: Medium · Category: Config
- Location: `vercel.json:2-15`.
- What: Three cron entries (backup/digest/github-process). Schedules are fine (LC-083 frequency fixed), but the **count** is 3 and Hobby documents a 2-cron limit.
- Why it matters: If still on Hobby, a deploy shipping 3 crons is rejected at deployment-creation — the LC-083 class (passes local gates, fails only at deploy, no build logs).
- Fix: Confirm the plan/cap; if Hobby, consolidate to ≤2 (fold reconcile cadence into an existing cron) or upgrade to Pro; add a deploy-time smoke check. **Assumption:** plan/cap not visible in-repo.
- Status: Found · PriorRef: LC-083 (new angle)

#### [OPS-04] Merge gate likely relies on a single required check ("Build"); security + workflow-lint jobs advisory
- Severity: Medium · Category: CI-CD
- Location: `ci.yml:8-9` (comment), jobs `quality`(:19), `security`(:129), `workflows`(:84).
- What: Only **Build** is named as the required check. `build needs: quality` (so lint/typecheck/test gate transitively), but `security` (npm audit + gitleaks) and `workflows` (actionlint/shellcheck) have no `needs` and aren't required. GitHub treats a *skipped* required check as passing.
- Why it matters: A committed secret / advisory / workflow-lint failure wouldn't block merge; a skipped `build` (if `quality` fails) could read as passing depending on ruleset.
- Fix: Make `quality`/`security`/`workflows` required, or add an "all-green" aggregator that `needs` every job and fails on skips. **Assumption:** ruleset not visible in-repo.
- Status: Found · PriorRef: LC-053 (new angle)

#### [OPS-05] No least-privilege `permissions:` block in ci.yml or the ops workflows
- Severity: Medium · Category: CI-CD
- Location: `ci.yml` (none), `ops-*.yml` (none); only `release-tag.yml:11-12` scopes `contents: write`.
- What: With no `permissions:` key, `GITHUB_TOKEN` inherits the (often read-write) repo/org default.
- Why it matters: Least-privilege wants the minimum per workflow/job; a broad default widens the blast radius of any injection/compromised action (compounds OPS-01).
- Fix: Top-level `permissions: contents: read` on ci.yml + every ops workflow; elevate per-job only where needed; keep `release-tag.yml`'s write.
- Status: Found · PriorRef: new

#### [OPS-06] Coverage floor ~46% and excludes components/pages; no e2e/a11y layer in CI
- Severity: Medium · Category: Testing
- Location: `vitest.config.mts:24,45-48` (thresholds ~46/50/40/46; `include` = `lib/**`,`app/api/**`,`proxy.ts`); Playwright suites only via `package.json` `ix:*`, not CI.
- What: Critical modules are covered, but the enforced floor is a ratchet just below reality (~47%), far below the mandate's 80%/95%-on-auth targets; `components/**` and pages are outside coverage; Playwright a11y/perf/viewport never run in CI.
- Why it matters: The gate certifies far less than required; the highest-risk UI + all browser a11y/perf checks are advisory and can rot (LC-069/091 class).
- Fix: Raise thresholds incrementally (start 95% on webhooks/auth/otp); add `components/**` to coverage; add a Playwright a11y/perf CI job.
- Status: Found · PriorRef: LC-052, LC-053

#### [OPS-07] Observability gaps: no error-tracking/metrics/tracing/alerting; ~47 raw `console.*` leak provider errors
- Severity: Medium · Category: Observability A09
- Location: logger + redactor good; residual raw logging in `push.ts`, `email.ts`, `telegram.ts`, and the **public** `webhook/route.ts:42,83,95`; `docs/OBSERVABILITY.md:87-105`.
- What: The structured redacting logger and `requestId` funnel are solid, but ~47 raw `console.*` remain (provider wrappers + the public webhook route log error objects verbatim, bypassing redaction). No Sentry, metrics (webhook lag, dead-letter depth, rate-limit remaining), tracing, or alerting.
- Why it matters: A09 — a one-off and a 100×/hr spike look identical; no signal triggers the existing runbooks. The doc is honest about the gaps (no drift).
- Fix: Route provider/webhook errors through `logger.error(msg,{err})`; add error tracking + source maps, then metrics + alerts on dead-letter depth / rate-limit exhaustion / token failure.
- Status: Found · PriorRef: LC-017, LC-054

#### [OPS-08] Supply-chain tooling absent (no Dependabot/Renovate, SBOM, provenance, Trivy, Cosign); mixed caret pinning
- Severity: Medium · Category: Supply-chain A03
- Location: `.github/` (no dependabot/renovate); `package.json:30-66` (mixed `^` vs exact); `docs/DEPENDENCY-MANIFEST.md:14-19`.
- What: No automated updater, SBOM (CycloneDX), provenance/SLSA, Cosign, or dep-image scan. Pinning mixed: framework deps exact, several others keep `^`.
- Why it matters: Held minor/patch bumps + new advisories drift unmanaged; a commercial product can't attest its BOM. The manifest itself flags the caret→exact move as outstanding.
- Fix: Dependabot (`npm` + `github-actions`), generate a CycloneDX SBOM in CI, add a Trivy fs scan, move carets to exact. (No Dockerfile expected on Vercel — correct.)
- Status: Found · PriorRef: LC-057

#### [OPS-09] Playwright a11y/perf/viewport suites exist but never run in CI
- Severity: Low · Category: Testing / CI-CD
- Location: `playwright.config.ts`; `package.json:22-28`; `ci.yml` (no invocation).
- What: A capable harness (real browser, axe, TLS proxy for Secure-cookie fidelity) is present but manual-only.
- Fix: Add a CI job (nightly or on PR label) running `ix:a11y` + a smoke `ix:perf`. (Fold into OPS-06.)
- Status: Found · PriorRef: LC-053 (residual)

#### [OPS-10] No `engines` field and no `.nvmrc`; Node 24 pinned only in CI
- Severity: Low · Category: Config / DX
- Location: `package.json` (no `engines`); root (no `.nvmrc`); Node set only in `ci.yml`.
- What: The runtime version isn't declared where it governs local dev or the Vercel build.
- Why it matters: A contributor on Node 20/22 (or a drifting Vercel default) builds/tests on a different runtime than CI; ESM/`verbatimModuleSyntax`/native-crypto/`after()` make skew non-trivial.
- Fix: `"engines": { "node": ">=24" }` + `.nvmrc` (`24`); confirm the Vercel Node version.
- Status: Found · PriorRef: new

#### [OPS-11] No `.env.example` for the large environment surface
- Severity: Low · Category: Docs / DX
- Location: root (no `.env.example`); gitignored `.env.local`; env vars across `lib/**`, `app/api/**`.
- What: No committed non-secret template of required/optional env; onboarding relies on copying an uncommitted `.env.local`.
- Why it matters: No authoritative list for a new environment/contributor; combined with no fail-fast validation (OPS-11a below), a missing var surfaces at runtime, not boot.
- Fix: Commit `.env.example` with every key + comments (exclude the dead `BLOB_READ_WRITE_TOKEN`). Optionally a boot-time `lib/env.ts` fail-fast validator.
- Status: Found · PriorRef: new

#### [OPS-12] `/api/ping` sits behind the session gate; no unauthenticated liveness/readiness probe
- Severity: Low · Category: Observability A09
- Location: `app/api/ping/route.ts:1-6`; `proxy.ts:186-213` (not exempt).
- What: `/api/ping` is an authed no-op (slides session expiry). No route reports health without a session.
- Why it matters: External uptime/synthetic monitoring can't probe the app; no black-box readiness signal (R2 reachable, etc.).
- Fix: Add a minimal public `/api/health` (`{ok}` + shallow dep checks, `no-store`, no secrets); wire an uptime monitor + alert.
- Status: Found · PriorRef: new

#### [OPS-13] CI jobs have no `timeout-minutes` (default 6-hour cap)
- Severity: Low · Category: CI-CD
- Location: `ci.yml` jobs (none); ops workflows set `timeout-minutes: 20`.
- What: The four CI jobs inherit the 360-minute default.
- Why it matters: A hung install/build/test or wedged binary download can burn up to 6h of runner minutes.
- Fix: `timeout-minutes: ~15` per CI job.
- Status: Found · PriorRef: new

#### [OPS-14] ops-*.yml trust model — arbitrary console routes run on the runner with full prod credentials, no environment protection
- Severity: Info · Category: CI-CD (design note)
- Location: `ops-run.yml:14-62,99-149`, `scripts/ops.ts`+`invoke.ts`; `ops-doc-action.yml:52`/`ops-new-client.yml:57` (`secrets: inherit`).
- What: `ops-run.yml` resolves an operator-supplied `path` against `app/**` and calls the handler in-process with the full secret set — including `DELETE` — gated only by repo write + `OPS_VIA_ACTIONS`. By design (Actions-as-control-plane). Injection is contained (env + `jq --arg`, not shell interpolation — LC-089 lesson applied).
- Why it matters: Anyone with repo write can run any mutating op with prod creds, no second approval; `secrets: inherit` forwards everything; no protected Environment with required reviewers.
- Fix: Bind these to a protected GitHub Environment with required reviewers for destructive methods; split read vs write; document in an ADR.
- Status: Found (design note) · PriorRef: TECH-DEBT #18

#### [OPS-15] Verified-correct controls (no action needed)
- Severity: Info · Category: CI-CD / A09 / Config
- What: `pull_request` (not `pull_request_target`); commit message reaches the notify step via `env`, not `${{ }}` interpolation; actionlint + shellcheck + gitleaks(`git`,`--redact`,checksum) + `npm audit --audit-level=high` all run with `fetch-depth: 0`; webhook HMAC verified over raw body before parse (regression-guarded); cron auth constant-time and fail-closed; redactor thorough and single-sink; docs honest about gaps; no Dockerfile expected on Vercel.
- Status: Found (informational) · PriorRef: LC-017, LC-084, LC-086

### E. Correctness bug hunt (Phase 3)

#### [BUG-01] Merge readiness silently over-optimistic — two transports write disjoint field sets, so a protection-/behind-blocked PR reports "Ready to merge"
- Severity: **High** · Category: Correctness / State-machine
- Location: `lib/github/api.ts` `fromGraphQLPullRequest` (never sets `mergeableState`/`behindBy`); `lib/github/entities.ts:325-347` `mergeReadiness` (`blocked_by_protection` needs `mergeableState==="blocked"`; `behind_base` needs `behindBy>0`); `entities.ts:300-312` `toPullRequestEntity` (REST path sets those but not `unresolvedThreads`); `processor.ts:202-209,262-312` (backfill/reconcile store the GraphQL entity via `putPullRequest`).
- What: `mergeReadiness` derives its verdict from fields populated by only one write path. GraphQL path sets `unresolvedThreads`/`mergeable` but not `mergeableState`/`behindBy`; REST path sets `mergeableState`/`behindBy` but not `unresolvedThreads`. Both write the same key, so the verdict flips by which path last touched it. Because `mergeReadiness` treats absent `mergeableState`/`behindBy` as *not blocked* (`?? 0`, `=== "blocked"`), a GraphQL-sourced entity can never report `blocked_by_protection` or `behind_base`.
- Why it matters: `backfill()` and every `reconcile()` write GraphQL entities over the projection (equal timestamps overwrite). After that, a PR blocked only by branch protection or being behind base — with no explicitly-requested reviewer and no visible failing check — reports **"Ready to merge"** in the "Approved and ready" view. The LC-071/086 class (console confidently wrong in the dangerous direction), new root cause: the maintenance operations themselves degrade the verdict.
- Evidence: **Verified.** `grep` confirms `mergeableState:` is assigned only in `toPullRequestEntity` (REST); `mergeReadiness` (`entities.ts:345-347`) reads absent fields as green.
- Fix: Make the transports produce the same field contract (derive `mergeableState`/`behindBy` from GraphQL `mergeStateStatus`/`baseRef.compare`; populate `unresolvedThreads` on the REST path), **or** have `mergeReadiness` treat absent `mergeableState`/`behindBy` as "readiness unknown → not ready" (fail safe). **Confirm against the live org's protection rules.**
- Status: Found · PriorRef: LC-071/086 class, new root cause

#### [BUG-02] Circuit breaker never re-arms after its first cooldown, so it stops protecting during a sustained outage
- Severity: Medium · Category: Error-handling / Resilience
- Location: `lib/github/client.ts:53-67` (`breakerOpen`, `recordFailure`).
- What: `breakerOpenedAt` is set only when `consecutiveFailures === BREAKER_THRESHOLD` (exactly 5). After the 30s cooldown, `breakerOpen()` returns false; the failed "half-open" request increments to 6+ **without** updating `breakerOpenedAt`, so `Date.now() - breakerOpenedAt >= 30_000` is permanently true — the breaker is disabled for the rest of the outage.
- Why it matters: Every request then flows through and can spend up to `MAX_WAIT_MS` (60s) in backoff before failing — the exact hang the breaker exists to prevent. The comment ("one trial request after cooldown") describes behaviour the code doesn't implement.
- Evidence: **Verified** (`recordFailure` line 66 guards on `=== BREAKER_THRESHOLD`).
- Fix: `===` → `>=` (re-arm on any failure at/over threshold), or an explicit half-open flag admitting one probe and re-opening on its failure.
- Status: Found · PriorRef: new

#### [BUG-03] reconcile() masks a GitHub outage as a clean run
- Severity: Medium · Category: Error-handling / Observability
- Location: `lib/github/processor.ts:279-323` (catch :279-282; `checked+=1` :288 before the `liveOpen` guard :291; `setSyncState` :317-321).
- What: When `fetchOpenPullRequests()` throws, `liveOpen=null`; the only per-PR check is gated on `if (liveOpen && ...)`, so nothing is verified — yet `checked` is incremented for every open PR and `setSyncState({lastReconciledAt, lastDrift:0})` runs unconditionally. Returns `{checked:N, drifted:[], removed:0}`.
- Why it matters: A total verification failure looks like a healthy reconcile (non-zero `checked`, zero drift) **and** advances the timer so the next real reconcile is deferred up to 24h. The drift signal the function exists to carry is silently dropped (LC-072/073 anti-pattern). Compounds API-01.
- Fix: When `liveOpen===null`, do the promised per-PR `fetchPullRequest` check, or bail without stamping `lastReconciledAt`/`lastDrift` (record `lastError`); don't count an uncompared PR as `checked`.
- Status: Found · PriorRef: LC-072/073 adjacent, new

#### [BUG-04] In-app notification grouping uses non-atomic RMW on a shared per-group file, losing counts and dropping notifications
- Severity: Medium · Category: Race-condition
- Location: `lib/github/notifications.ts:232-271` (`deliverInApp`), `:296-301` (`markRead`).
- What: `deliverInApp` does `readState → mutate → writeState` on a file keyed by `recipient+groupKey`, no CAS, while `updateState` exists for exactly this.
- Why it matters: Under the burst the feature targets (two deliveries collapsing to one group, each in its own concurrent `after()`), both read `count:1` and write `count:2` (one increment lost); if none existed, both take "create fresh" and one is overwritten (count stays 1). `markRead` can clobber a concurrent `deliverInApp`. Contradicts the module's "updated in place" guarantee.
- Fix: Route `deliverInApp` and `markRead` through `updateState(path, mutate)` (CAS); the collapse logic is already pure.
- Status: Found · PriorRef: DATA-INTEGRITY (this path new), LC-002 family

#### [BUG-05] recordRateLimit's "only advance the snapshot" guard is a no-op; a cross-bucket reading overwrites core
- Severity: Low · Category: Correctness / Observability
- Location: `lib/github/ratelimit.ts:39-52`.
- What: `observedAt = Date.now()` then guard `snapshot.observedAt >= latest.observedAt` — always true for a later-processed response, so it never prevents anything. A `graphql`/`search` response after a `core` one replaces `latest`, and `currentRateLimit()` returns the wrong bucket's budget.
- Fix: Only replace `latest` when `snapshot.resource === latest.resource`, or keep a per-resource map and expose `currentRateLimit("core")`.
- Status: Found · PriorRef: new

#### [BUG-06] "Failing check" defined three ways; action_required and cancelled handled inconsistently
- Severity: Low · Category: Correctness
- Location: `entities.ts:207` (FAILING incl. `action_required`), `views.ts:146`, `notify-events.ts:92` (both exclude it), `insights.ts:168` (failure/timed_out only); none count `cancelled`.
- What: `mergeReadiness` counts `action_required` as failing but the grouped-failure panel, the CI-failure notification, and flake stats don't; `cancelled` is ignored everywhere.
- Why it matters: A PR marked "Check failing" in the verdict is absent from the grouped-failure panel and triggers no notification — surfaces disagree about the same fact.
- Fix: One exported `FAILING_CONCLUSIONS` + `isFailing` used everywhere; decide `cancelled` explicitly.
- Status: Found · PriorRef: new

#### [BUG-07] processPending halts the whole queue on any error message starting with "Deferred:"
- Severity: Low · Category: Error-handling
- Location: `lib/github/processor.ts:125-136` (break :133), summaries :109-113.
- What: The "stop when GitHub is down" logic string-matches `summary.startsWith("Deferred:")`, but a non-transient handler error whose message begins `Deferred:` also produces that summary, halting all remaining pending deliveries.
- Fix: Return a structured `transient: boolean` on `ProcessOutcome` and branch on it, not the summary string.
- Status: Found · PriorRef: new

#### [BUG-08] backoffMs honours Retry-After with only an upper clamp, so `Retry-After: 0` yields a 0ms retry (hot loop)
- Severity: Low · Category: Correctness / Error-handling
- Location: `lib/github/ratelimit.ts:80-85`.
- What: `Math.min(retryAfter*1000, MAX_WAIT_MS)` — no lower clamp. `Retry-After: 0` (which secondary-limit responses can carry) → 0ms retry that immediately re-trips the limit.
- Fix: `Math.min(Math.max(retryAfter*1000, MIN_WAIT_MS), MAX_WAIT_MS)`, matching the primary-limit branch.
- Status: Found · PriorRef: new

#### [BUG-09] Notification comment body truncated with `.slice(0,200)` on UTF-16 units (can split a surrogate)
- Severity: Info · Category: Correctness (i18n)
- Location: `lib/github/notify-events.ts:173`.
- What: `comment.body.slice(0,200)` can cut mid-surrogate, producing a lone surrogate serialized into the Telegram/push payload.
- Fix: Code-point/grapheme-aware clip (`Array.from(str).slice(0,200).join("")` or `Intl.Segmenter`).
- Status: Found · PriorRef: GAP-3.2a (residual)

---

## 6. Phase 4 — Improvements & new-feature roadmap

**Quick wins (high impact / low effort — do now):** BUG-02/05/08 one-line correctness fixes;
OPS-02/05/10/11/13 CI hygiene; delete `_gen.mjs`/`_poll.mjs`; add axe to CI (OPS-09) to stop UI-01/18
class regressions; a shared `<FormError>`/`<StatusLine>` primitive (closes most of UI-01 at once).

**Improvements to existing features:** precomputed dashboard aggregates (UI-03/API-11);
CAS-on-write for the client record (API-02); Zod at every boundary (API-05); idempotency keys +
a real background queue for creation/relay (API-06, removes the UI-13 latency story); observability
+ alerting on dead-letter depth / rate-limit exhaustion / token failure (OPS-07); stale-while-revalidate
session gate + low-latency shared store (API-10, SEC-03).

**New features a 2026 internal console should have (tailored to this app):** an **audit/activity
trail keyed per-operator** (UI-06 makes the current model team-global); **RBAC + step-up on
destructive actions** (SEC-08); **client-portal capability tokens / magic-link acceptance**
(SEC-01) with proper e-signature evidence; **SBOM + Dependabot + provenance** (OPS-08); a public
**/health readiness probe + uptime alerting** (OPS-12); and a **GC/retention cron** for orphaned
render/upload objects (API-12).

---

## 7. Deliverables checklist

- [x] Architecture & Inventory writeup (Phase 1) — §4
- [x] `AUDIT.md` with all findings, severity counts, fix order
- [x] Fixes committed on `audit/2026-09` with verification per commit — 51 findings fixed across 29 commits, every one gate-verified (lint/typecheck/tests/build); see §1a
- [x] Dependency audit output — `npm audit` clean; freshness noted (OPS-08)
- [x] Prioritized improvements + new-feature roadmap — §6
- [x] Final summary: fixed vs deferred — §1a (18 deferred, each with a reason)
- [x] Nothing sensitive printed or committed; no committed secrets found (nothing to rotate)

**Two items to confirm before fixing:** API-01 (runtime cron behaviour) and BUG-01 (live org
branch-protection config). Static evidence for both is strong.
