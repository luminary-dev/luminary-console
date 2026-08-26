# Testing

## Layers

| Layer | Tool | Where | What it covers |
| --- | --- | --- | --- |
| Unit | Vitest | `tests/*.test.ts` | Pure logic: money arithmetic, stage transitions, merge readiness, insights, webhook verification, rate limit classification, redaction |
| Component | Vitest + Testing Library | `tests/*.test.tsx` | Rendered behaviour and accessibility: keyboard navigation, focus management, live regions, draft persistence |
| Integration | Vitest with the store mocked at its boundary | `tests/github-pipeline.test.ts`, `tests/store*.test.ts` | Route handler to projection, including duplicate, out-of-order, malformed and replayed deliveries |
| Contract | Recorded fixtures | `tests/github-*.test.ts` | Every GitHub event schema, including malformed payloads |
| Live-fire | `tsx` scripts | `scripts/tests/suite-*.ts` | The real backends. Opt-in only, see below |

Run everything with `npm test`. Coverage with `npm run test:coverage`.

## The one rule that matters

**Unit and component tests must never touch the network, and must never touch
the live Cloudflare R2 bucket.** This repository runs against production
storage with a real client's data in it.

`tests/setup.ts` enforces this:

- Every storage credential is set to an obviously fake value and `R2_ENDPOINT`
  points at a dead port, so an accidentally-constructed client reaches nothing.
- Every credential that would spend money or notify a human (Anthropic,
  OpenAI, Resend, Telegram, VAPID, Cloudflare, Vercel, GitHub) is deleted from
  the environment, so the guarded no-op path in each module is what runs.
- `globalThis.fetch` is replaced with a stub that throws a message naming the
  URL it was asked for. A test that needs a fetch boundary stubs it itself.

If you see that throw, the fix is to stub the boundary in your test, never to
weaken the setup.

## Live-fire suites are opt-in

Five suites under `scripts/tests/` drive the real product against real
backends. They were renamed to `test:live:*` so they cannot be run by reflex:

| Script | What it actually does |
| --- | --- |
| `npm run test:live:ops` | Documented zero-cost. Route resolution, cron auth, relay guards, publish failure paths |
| `npm run test:live:notify` | Sends about 13 REAL push notifications to every subscribed phone |
| `npm run test:live:client` | Real Claude spend, real subdomain creation, real studio emails |
| `npm run test:live:article` | Real OpenAI spend, opens a real PR against the landing repo |
| `npm run test:live:project` | Same, for project publishing |

Only `test:live:ops` is safe to run casually. The others cost money, notify
people, or create real infrastructure. They tear down what they create, but
the side effects during the run are real.

**They must never run in CI.**

## What is covered, and where the bar is higher

The mandate sets 80 percent overall and 95 percent on auth, webhook
verification and GitHub event handling.

The configured global floor in `vitest.config.mts` is **46 percent statements
and lines, 50 percent functions, 40 percent branches**, set just under the
measured figures so the gate fails on a regression and passes while coverage
holds or climbs. That is below the mandate's target and is a staging point, not
the destination.

It was 60 percent across the board, and that was a mistake worth naming: the
suite was at 31 percent, so `npm run test:coverage` exited 1 and the CI job that
runs it was red from the day it was added. A threshold you are already failing
is not a gate, it is a broken build that people learn to route around, and the
paragraph that used to sit here claimed the floor was "set where the suite
actually is today" when it was not. The numbers now match the measurement, and
the way to move them is to write tests and raise them, in that order.

Coverage is held down by `app/api/**` route handlers, which are inside the
`include` glob and largely untested, and by document rendering in
`lib/templates` and `lib/pdf`. The GitHub integration this floor most needs to
protect sits far above it: actions 100, handlers 100, projection 99, processor
99, api 98.9, client 98.

The security-critical modules are the ones to keep near-complete:

- `lib/github/webhooks.ts` — signature verification, including a block of
  tests that fail if the raw body is ever parsed before the HMAC is computed.
- `lib/auth.ts`, `lib/users.ts`, `lib/otp.ts`, `lib/sessions.ts` — session
  validity, credential formats, the attempt lockout under concurrency.
- `lib/github/handlers.ts` and `processor.ts` — idempotency, out-of-order
  arrival, dead letter and replay.
- `lib/money.ts` — every number the operator reads about money.

## Regression tests name their finding

Every audit finding that described a defect has a test named after it, so the
connection between "we found this" and "it cannot come back" is greppable:

```
it("LC-001: refuses to write an index it could not read", ...)
it("LC-010: a token whose sid is not registered is rejected", ...)
it("LC-021: restores a saved draft after a refresh", ...)
```

`grep -r "LC-0" tests/` lists them.

## Conventions

- **Test names are sentences about behaviour**, not about implementation.
  "does not claim conflicts while GitHub is still computing mergeability" beats
  "mergeReadiness returns correct value".
- **Comment the non-obvious ones.** A test that encodes a subtle rule should
  say why the rule exists, because the test is where the next person looks.
- **Fixtures are realistic.** Sinhala company names, emoji in titles, deleted
  fork repos, null actors: the edge cases in `docs/audit/EDGE-CASES.md` are
  real inputs for this product, not hypotheticals.
- **Assert the absence of bad things too.** For example, the insights test
  asserts that no author login appears anywhere in the payload, which is what
  keeps ADR 0002 true over time.

## CI

`.github/workflows/ci.yml` runs, on every pull request and every push to main:

1. **Lint** (`npm run lint`) with the security and accessibility rule sets.
2. **Typecheck** (`npm run typecheck`).
3. **Unit and component tests with coverage** (`npm run test:coverage`), with
   the coverage report uploaded as an artifact.
4. **Build** (`npm run build`), which is the required status check named
   `Build` in the branch ruleset. Do not rename that job without updating the
   ruleset in the same commit.
5. **Security scan**: `npm audit --audit-level=high` and Gitleaks.

## Not yet built

Recorded so the gap is visible rather than assumed covered:

- **Playwright end-to-end** for the journeys in the mandate's section 12.1.
  The component tests cover the keyboard and focus behaviour that would
  otherwise be the main reason for browser tests, but a real login-to-merge
  journey is not exercised.
- **axe in the test run.** Accessibility is currently enforced by
  `eslint-plugin-jsx-a11y` plus hand-written assertions on roles, labels and
  focus. An automated axe pass would catch what those miss.
- **Testcontainers** for a real Postgres and Redis, which are not part of the
  architecture yet.
- **Lighthouse CI and a per-route bundle budget.**
- **Visual regression snapshots.**
