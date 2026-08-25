# Dependency manifest

Every dependency, why it is here, and what it was resolved to.

**Resolution date: 2026-08-26.** Versions were resolved against the npm
registry on that date with `npm view <pkg> version`, not recalled. The
lockfile (`package-lock.json`) is committed and is the source of truth for
transitive versions.

`npm audit`: **0 vulnerabilities** as of the resolution date. The one high
severity advisory found in the audit (`nanoid <3.3.18`, GHSA-2v37-7h3g-55p8,
reached through `web-push`) was patched.

## Pinning policy

New dependencies added during this work are pinned **exactly** (no `^`).
Pre-existing dependencies keep their caret ranges for now; the lockfile pins
the actual installed version either way, so a `npm ci` is reproducible. Moving
the remaining carets to exact pins is a mechanical follow-up.

## Runtime dependencies

| Package | Range | Installed | Why it is here | License |
| --- | --- | --- | --- | --- |
| `next` | 16.3.0 | 16.3.0 | The framework. App Router, Turbopack, route handlers, the proxy | MIT |
| `react` | 19.2.8 | 19.2.8 | Peer of Next | MIT |
| `react-dom` | 19.2.8 | 19.2.8 | Peer of Next | MIT |
| `@anthropic-ai/sdk` | ^0.115.0 | 0.115.0 | Claude Opus 5 with structured outputs, for document drafting and the studio assistant. Uses the `server-side-fallback-2026-07-01` beta | MIT |
| `@aws-sdk/client-s3` | ^3.1105.0 | 3.1105.0 | Cloudflare R2 over its S3-compatible API. Also the source of the conditional-write support (`If-Match`, `If-None-Match`) the compare-and-swap layer depends on | Apache-2.0 |
| `@aws-sdk/s3-request-presigner` | ^3.1105.0 | 3.1105.0 | Presigned GETs for email links and presigned PUTs for browser-direct uploads, which is what keeps the 15MB cap and content-type allowlist enforceable after the URL leaves the server | Apache-2.0 |
| `@sparticuz/chromium` | ^149.0.0 | 149.0.0 | Headless Chromium for serverless PDF rendering. **Must stay version-matched to `puppeteer-core`'s expected Chrome revision** | MIT |
| `puppeteer-core` | ^25.5.0 | 25.5.0 | Drives Chromium for document and design-preview PDFs | Apache-2.0 |
| `resend` | ^6.18.1 | 6.18.1 | Transactional email: sign-in codes, client documents, digests, backups | MIT |
| `web-push` | ^3.6.7 | 3.6.7 | VAPID Web Push to the installed console app | MPL-2.0 |
| `zod` | 4.4.3 | 4.4.3 | **Added.** Schema validation at every GitHub payload boundary, so a payload change surfaces as one legible error next to the delivery that caused it rather than as an `undefined` three layers down | MIT |
| `@octokit/webhooks-methods` | 6.0.0 | 6.0.0 | **Added.** Reference implementation of GitHub's webhook signing, kept as a cross-check against our own `lib/github/webhooks.ts` | MIT |

## Development dependencies

| Package | Range | Installed | Why it is here | License |
| --- | --- | --- | --- | --- |
| `typescript` | ^6.0.3 | 6.0.3 | Typechecking. TypeScript 7 is available and is a deliberate, separate upgrade | Apache-2.0 |
| `tsx` | ^4.19.0 | 4.23.8 | Runs the scripts and the live-fire QA suites | MIT |
| `vitest` | 4.1.11 | 4.1.11 | **Added.** Unit, component and integration tests | MIT |
| `@vitest/coverage-v8` | 4.1.11 | 4.1.11 | **Added.** Coverage, gated in CI | MIT |
| `@testing-library/react` | 16.3.2 | 16.3.2 | **Added.** Component tests that assert behaviour and accessibility rather than implementation | MIT |
| `@testing-library/user-event` | 14.6.6 | 14.6.6 | **Added.** Realistic keyboard and pointer interaction in tests | MIT |
| `jsdom` | 30.0.1 | 30.0.1 | **Added.** DOM for component tests | MIT |
| `eslint` | 9.39.5 | 9.39.5 | **Added.** Pinned to the 9 line deliberately: `eslint-plugin-jsx-a11y` 6.10.2 does not yet support ESLint 10, and accessibility linting is a merge gate we are not willing to drop for a major version bump | MIT |
| `@eslint/js` | 9.39.5 | 9.39.5 | **Added.** Base rules | MIT |
| `typescript-eslint` | 8.68.0 | 8.68.0 | **Added.** TypeScript rules, including the `no-explicit-any` gate | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | 7.1.1 | **Added.** Catches the stale-closure and missing-dependency class of bug | MIT |
| `eslint-plugin-jsx-a11y` | 6.10.2 | 6.10.2 | **Added.** WCAG 2.2 AA is the floor; this is the automated half of enforcing it | MIT |
| `eslint-plugin-no-unsanitized` | 4.1.5 | 4.1.5 | **Added.** Required by the security policy. Blocks unsafe DOM sinks | MPL-2.0 |
| `dotenv` | ^17.0.0 | 17.4.2 | Scripts load `.env.local` before importing the store | BSD-2-Clause |
| `@types/node` | ^26 | 26.1.2 | Types | MIT |
| `@types/react` | ^19 | 19.2.18 | Types | MIT |
| `@types/react-dom` | ^19 | 19.2.4 | Types | MIT |
| `@types/web-push` | ^3.6.4 | 3.6.4 | Types | MIT |

## Licenses

Every direct dependency is permissive: MIT, Apache-2.0, MPL-2.0 or
BSD-2-Clause. No copyleft in the direct set. MPL-2.0 (`web-push`,
`eslint-plugin-no-unsanitized`) is file-level copyleft and imposes nothing on
this codebase, since neither is modified. A generated SBOM should confirm the
transitive picture; that is not yet produced (see Gaps).

## Deliberately NOT dependencies

Recorded so nobody helpfully adds them:

- **A ZIP library.** `lib/zip.ts` is a hand-rolled deflate plus CRC-32 writer,
  about 90 lines, for "a few small JSON files in one archive".
- **A tar library.** `lib/deploy.ts` extracts GitHub tarballs in memory, about
  30 lines.
- **A JWT library.** `lib/github/auth.ts` signs the App's RS256 JWT with
  `node:crypto` directly.
- **A charting library.** Trends and distributions are inline SVG and CSS
  bars, each with an accessible tabular alternative.
- **A virtualization library.** `components/VirtualList.tsx` is our own, so it
  can keep real table semantics and `aria-rowindex` intact.
- **A GitHub SDK (Octokit REST).** `lib/github/client.ts` is our own, because
  the hard parts we actually need (differentiated primary versus secondary
  rate limit backoff, ETag caching, correct early-terminating Link pagination,
  request coalescing, a circuit breaker) are exactly what the client is for.
  Octokit's webhook *signing* implementation is a dependency, since that one
  is worth cross-checking against.

Each of these was a judgement that the code is small, stable and better
understood than the dependency would be. Each is tested.

## Known gaps

Not yet in place, from the mandate's supply-chain requirements:

- **Renovate** for automated dependency updates.
- **CycloneDX SBOM** per build.
- **Cosign** image signing and SLSA provenance (there is no container build).
- **Trivy** image scanning (same).

Gitleaks and `npm audit --audit-level=high` DO run in CI.

## Upgrades available at the resolution date

Deliberately not taken in this pass, so a dependency bump is not tangled up
with functional change:

| Package | Installed | Latest |
| --- | --- | --- |
| `next` | 16.3.0 | 16.3.3 |
| `@anthropic-ai/sdk` | 0.115.0 | 0.120.0 |
| `@aws-sdk/*` | 3.1105.0 | 3.1118.0 |
| `puppeteer-core` | 25.5.0 | 25.9.0 |
| `resend` | 6.18.1 | 6.22.1 |
| `typescript` | 6.0.3 | 7.0.2 (major) |

Take these as one deliberate batch: bump, run `npm test`, confirm a PDF
renders and one drafting call succeeds, then commit the lockfile. The
Chromium and puppeteer pair must move together.
