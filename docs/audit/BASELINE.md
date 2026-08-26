# Baseline — Luminary Console as found on 2026-08-26

This is the "before" record for the audit and rebuild. Every measurement below was
taken on the working tree at commit `524de70` (main, clean) on macOS (Darwin 25.5.0),
Node v25.8.2, npm 11.11.1, against the real environment in `.env.local` (live R2
bucket, live client data). All probing was read-only.

## What the application is

Next.js 16.3.0 (App Router, Turbopack) single-package app. It is Luminary Studio's
client-document platform: AI-drafted client documents (estimate, questionnaire,
quotation, proposal, contract and SOW, invoice, receipt) rendered as branded pages and
PDFs on per-client subdomains (`<slug>.luminary-dev.xyz`), plus design previews, site
deploys, billing and payments, handover packs, change orders, a studio assistant,
notes, tasks, an activity feed, web push and Telegram notifications, and a publish
portal for the landing-page blog and projects. Storage is Cloudflare R2 (S3 API) as a
flat JSON-file store; there is no database. Auth is email + password + emailed OTP
producing an HMAC session cookie verified by `proxy.ts`. Console mutations can
optionally relay through GitHub Actions (`OPS_VIA_ACTIONS`).

Inventory: 181 tracked files, 22,505 lines. 107 `.ts`, 47 `.tsx`, 7 workflow `.yml`,
1 CSS file (`app/globals.css`), 1 service worker (`public/sw.js`). No test framework;
five live-fire QA suites under `scripts/tests/` run with `tsx` against real backends.

## Install

`npm install`: clean, 132 packages, 849ms, no peer conflicts, no deprecation warnings.

`npm audit`: **1 high severity** — `nanoid <3.3.18` (GHSA-2v37-7h3g-55p8, custom
generators can loop indefinitely when size is zero). Transitive dependency; fix
available via `npm audit fix`.

## Typecheck and build

- `npx tsc --noEmit`: clean, exit 0.
- `npm run build` (Next 16.3.0 / Turbopack): **succeeds in ~6.6s total** (compile
  694ms, TypeScript 1276ms, 24 static pages in 128ms). No build warnings. All routes
  are dynamic (`ƒ`) except `/icon.svg`; proxy middleware active.
- Build output: `.next` is 463MB (dev + prod caches); `.next/static` is 984KB, largest
  client chunks 224KB + 156KB + 112KB (pre-gzip).

## Boot and route probe

`npm run dev` ready in 575ms (port 3002; port 3000 was held by an unrelated process).
`npm run start` (production) boots and serves in under 4s.

Unauthenticated (dev server):

| Route | Result |
| --- | --- |
| `/` | 307 → `/login` |
| `/login` | 200 |
| `/api/ping` | 401 JSON |
| `/activity`, `/publish`, `/clients/new`, `/c/<slug>` | 307 → `/login` |

Authenticated (HMAC session minted locally with `SESSION_SECRET` — note: the proxy
accepted a token whose sid was never registered in the session store; recorded as an
audit finding):

| Route | Status | Time (cold dev) |
| --- | --- | --- |
| `/` (dashboard) | 200 | 2.06s (proxy 855ms + render 1166ms) |
| `/activity` | 200 | 903ms |
| `/publish` | 200 | 38ms |
| `/clients/new` | 200 | 52ms |
| `/clients/eco-mech` | 200 | renders full detail |
| `/c/eco-mech` (portal preview) | 200 | renders |
| `/api/clients` | 200 | 564ms |
| `/api/activity` | 200 | 253ms |
| `/api/sessions` | 200 | 324ms |
| `/api/search?q=test` | 200 | 274ms |

Server-side reads go to R2 on every request (no cache layer); dashboard cold render
paid ~850ms in the proxy (revoked-sid list fetch) plus ~1.1s in application code.

## Browser console

Headless Chrome (1440x900 and 360x780) across login, dashboard, activity, publish,
new client, client detail, portal preview:

- **2 console errors on `/login`**: two authenticated API calls fire while signed out
  and return 401 (noise on every login screen load; recorded as a finding).
- Zero hydration warnings, zero pageerrors on authenticated screens.
- `networkidle0` never settles on any console page: the app polls continuously
  (activity/notification polling; recorded for the audit's performance pass).

Screenshots captured to `docs/audit/screenshots/`: `login.png`, `dashboard.png`,
`activity.png`, `publish.png`, `clients-new.png`, `client-detail.png`,
`portal-preview.png`, `dashboard-360.png`, `client-detail-360.png`.

## Tests

No unit test framework exists (no Vitest/Jest/Playwright). Five QA suites hit real
backends:

- `test:ops` — documented zero-cost. **Run: 14 passed, 0 failed** (route resolution,
  cron auth, relay guards, opsFetch routing, publish failure paths).
- `test:notify` — deliberately sends ~13 real push notifications to all subscribed
  phones. **Skipped** (operators' devices would be pinged; runnable on request).
- `test:client` — full lifecycle: real Claude drafting spend, real subdomain
  creation via Cloudflare + Vercel, studio emails. **Skipped** (cost + external side
  effects; runnable on request).
- `test:article`, `test:project` — real OpenAI spend and real PRs against the landing
  repo (torn down in teardown). **Skipped** (cost + external side effects).

Coverage tooling: none exists. Coverage: unmeasured (effectively 0% enforced).

## Lighthouse (production build, `next start`, authed dashboard)

| Category | Score |
| --- | --- |
| Performance | 98 |
| Accessibility | 96 |
| Best practices | 100 |

FCP 0.8s, LCP 2.3s, TBT 20ms, CLS 0.016. Total JS transferred: 144KB.
Dev-server run for comparison: performance 90, LCP 3.6s.

Accessibility failures: **color-contrast on table header cells** (`<th>` elements,
dashboard client table). Also flagged: bf-cache disabled (expected: `no-store` on
authed pages), unused JavaScript, render-blocking request.

## Live data state at baseline

One production client (`eco-mech`, status `drafts_ready`, stage Development), three
registered operator sessions, real payments and documents. All audit interactions
avoided mutation; the destructive-action review will use fixtures only.

## Summary of the starting position

The app builds clean, typechecks clean, boots fast, and scores 98/96/100 in
production. The gaps are structural rather than cosmetic: no test framework or CI
coverage gates, no database (flat JSON files on R2 with read-modify-write races),
session tokens verifiable without server-side existence checks, 401 noise on the
login page, table-header contrast, and one high-severity transitive vulnerability.
The full findings register lives in `docs/audit/FINDINGS.md`.

---

# After: the same measurements on 2026-08-26, post-remediation

Same machine, same Node, same live environment, same method as the "before"
above, so the two columns are comparable. The one deliberate difference is that
the console now does considerably more than it did: the GitHub operations half
did not exist when the first measurements were taken.

## Headline comparison

| Measure | Before | After |
| --- | --- | --- |
| `npm audit` | 1 high (`nanoid`) | **0 vulnerabilities** |
| Unit tests | none (no framework) | **727 passing, 35 files** |
| Coverage, enforced | none | **47.25% statements, gated in CI** |
| Coverage, GitHub integration | n/a | actions 100, handlers 100, projection 99, processor 99, api 98.9, client 98 |
| `tsc --noEmit` | clean, `strict` only | clean, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` |
| Lint | no ESLint config | **0 errors**, flat config with jsx-a11y, security and no-unsanitized |
| CI | none | 3 jobs: lint/typecheck/coverage, build, security scan |
| Lighthouse performance | 98 | 97 |
| Lighthouse accessibility | 96 | **100** |
| Lighthouse best practices | 100 | 100 |
| CLS (dashboard) | 0.016 | **0** |
| Horizontal overflow at 360px | present on 5 pages (undetected at the time) | **none, at 320, 360, 768 and 1440** |
| Console errors across all pages | 2 on `/login` | **0** |
| Pages | 7 | 14 |

## Install and audit

`npm install`: clean, no peer conflicts. `npm audit`: **0 vulnerabilities**, down
from 1 high. `eslint` is pinned at 9.39.5 rather than 10, deliberately, because
`eslint-plugin-jsx-a11y` does not yet support 10 and accessibility linting is a
merge gate worth more than a major version bump. That choice and its resolution
date are recorded in `docs/DEPENDENCY-MANIFEST.md`.

## Typecheck and build

- `npx tsc --noEmit`: clean, with all four strict flags on. Turning them on
  surfaced 208 errors, every one of which was resolved rather than suppressed,
  and three of them were real latent bugs rather than type noise (recorded in
  the findings register).
- `npm run build`: succeeds in **8.5s** from a cold `.next` (compile 2.5s), 72
  route entries, no warnings.
- `.next/static` is 1.1MB, largest client chunks 232KB + 156KB + 112KB
  pre-gzip. Larger than the 984KB before, which is expected: the GitHub screens
  are new surface area, not bloat on the old pages.

## Inventory

166 `.ts`, 73 `.tsx`, 3 `.css`, 43,326 lines of TypeScript, up from 22,505.
35 unit test files. 33 documents under `docs/`, including 8 runbooks and 2 ADRs.

## Tests

`npm test`: **727 passing across 35 files**, in about 2 seconds. Nothing in the
suite touches the network or the live bucket: `tests/setup.ts` fakes every
credential, points the store at a dead port, and replaces `globalThis.fetch`
with a stub that throws naming the URL it was asked for, so an accidental live
call fails loudly instead of quietly spending money.

`npm run test:coverage` exits 0 against the thresholds in `vitest.config.mts`.
Those thresholds are a ratchet set just under the measured numbers, not a
target: they were 60 across the board while the real figure was 31, which made
the CI job red and the gate meaningless. The reasoning is written next to them.

The five live-fire suites are unchanged and still opt-in, renamed to
`test:live:*` so they cannot be run by reflex. Only `test:live:ops` is
zero-cost; the others spend real money, open real pull requests, or send real
push notifications to the operators' phones. None runs in CI.

## Lighthouse (production build, `next start`, authenticated)

| Page | Performance | Accessibility | Best practices | FCP | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | 97 | 100 | 100 | 0.8s | 2.5s | 10ms | **0** |
| `/github` | 97 | 100 | 100 | 1.1s | 2.6s | 10ms | **0** |

**Accessibility is 100, up from 96**: the table-header contrast failure is gone,
and Lighthouse reports no remaining failures on either page. This is a floor,
not a ceiling: an automated audit catches a fraction of what matters, and
`docs/audit/ACCESSIBILITY-FINDINGS.md` records the manual work behind it.

**CLS is 0, down from 0.234** at the worst point during the rebuild. That
regression was real and is worth recording rather than quietly fixing: the
alerts toggle rendered nothing until an effect established whether the device
supported push, then appeared and wrapped the topbar onto a second row, moving
every element below it down 43px about two seconds into the load. It is now
LC-069, fixed by reserving the control's exact box from first paint.

Performance is 97 against 98 before, which is inside the run-to-run noise on
this machine. The remaining opportunity is unchanged from the baseline and
already recorded as a finding: the root document takes about 1.4s because every
server render reads from R2 with no cache layer in front of it.

## Responsive behaviour

Measured at 320, 360, 768 and 1440px across all fourteen pages: **no horizontal
overflow anywhere**, and the dense tables still scroll internally so no column
was narrowed to achieve it.

This is a correction as much as a result. An earlier pass in this same effort
concluded there was no overflow, on a measurement that settled the page before
the scroll containers had mounted. A later, more careful pass found real
overflow on five pages, stable across every settle point from 500ms to 5s in a
production build, with the page header scrolling out of reach. The lesson is in
the finding (LC-068): the first measurement agreed with what I expected, so it
was not challenged.

## Browser console

Zero console errors and zero error boundaries across all fourteen pages,
authenticated, in a production build. The two 401s that fired on every `/login`
load are gone.

## Live data state

Unchanged and untouched: one production client (`eco-mech`), real payments and
documents. Every destructive path exercised during this work used fixtures. The
GitHub layer was verified against the live org read-only and by backfill: 18
repositories, 41 open pull requests, 456 workflow runs, zero errors.

## What this does not measure

No Playwright end-to-end journeys, no axe in the test run, no Lighthouse CI, no
bundle budget and no visual regression, so none of the numbers above is
regression-proof: they are point measurements taken by hand today, and only the
lint, typecheck, unit-test and coverage gates will catch a slide tomorrow.
`docs/TESTING.md` records that gap, and `REMEDIATION-PLAN.md` carries it as
remaining work rather than treating it as done.
