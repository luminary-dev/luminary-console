# Tech debt register — Luminary Console (2026-08-26)

Debt is anything that will cost more the longer it is left, but is not itself a
bug producing wrong output today. Bugs are in `FINDINGS.md`; this is the "we
will pay for this later" list, ordered roughly by interest rate.

## Structural

1. **Flat-file store as the system of record** (LC-001, LC-002, LC-062). The
   single largest debt. No transactions, no constraints, no conditional writes,
   a denormalised index that can diverge, array-index-keyed mutations. Every new
   feature inherits the concurrency and integrity limits. The section-8 move to
   Postgres + Drizzle is the payoff.
2. **No test or CI quality layer** (LC-052, LC-053). Build+typecheck is the only
   gate; the only tests spend real money. Every change is a manual-QA change.
   This compounds with team size and feature count.
3. **No observability** (LC-054). No structured logs, correlation, tracing,
   metrics, or error tracking. Debugging production means reading raw logs.
4. **No error-boundary / four-states discipline** (LC-020). Async surfaces lack
   loading/empty/error/offline states; a store blip is a white screen.
5. **Single-package app doing five jobs** (console, portal, documents, ops
   runner, crons). The section-8 workspace split (`web`, `worker`, `github`,
   `ui`, `schema`, …) isolates the pieces so they can be tested and scaled
   independently.

## Boundaries and types

6. **No validation at boundaries** (LC-004). AI output and stored records are
   cast, not parsed. Zod schemas at every boundary is the fix and a prerequisite
   for consuming GitHub payloads safely.
7. **TypeScript strictness below target** (LC-056). `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `verbatimModuleSyntax` are off; `any`
   suppressions in `lib/pdf.ts`; `as Parameters<…>[0]` casts around the SDK.
8. **Three money representations on one record** (`Payment.amount` number,
   doc-data `total` formatted string, `ChangeOrder.amount` formatted string).
   Consolidate to integer minor units with formatting at the edge.

## Conventions

9. **Authored emojis** in notices/digests/PRs (LC-050) and **em/en dashes** in
   UI copy (LC-051) violate the house rules the generated documents already
   follow. Lint them out.
10. **No ESLint at all.** The mandate names specific plugins
    (`no-unsanitized`, security rules); none run. Adds to LC-053.
11. **Inline styles everywhere** (`style={{…}}` throughout the components) rather
    than the token/utility system the rebuild will introduce. Not wrong, but it
    is why the UI is hard to keep consistent and why density/theme changes touch
    many files. The Phase 2 `packages/ui` + shadcn move addresses this.

## Dead / stale code

12. **`_gen.mjs`, `_poll.mjs`** — committed one-off scratch scripts, one of them
    stale/broken against the current schema (LC-055). Delete.
13. **Dead branch** in `/preview/[slug]/[type]` (`type === "pdf"` never matched;
    noted in Wave 6).
14. **`billingStageLabel("advance")`** and the `"advance"` stage survive only for
    legacy records; harmless but a reminder the billing model changed under the
    data.
15. **Dead env var** `BLOB_READ_WRITE_TOKEN` (post-migration).

## Operational

16. **Orphaned R2 objects** from history eviction and un-submitted uploads
    (LC-058) — needs a GC cron.
17. **No restore drill** (LC-066); backup is untested as a recovery path.
18. **Ops-via-Actions** is a clever receipt mechanism but couples business
    mutations to GitHub Actions availability and adds 30-60s latency; it deserves
    an ADR recording why it exists and when it is on.
19. **Partial Sinhala** (LC-059) — complete or consistently defer.

## Debt that is actually a good decision (keep, do not "fix")

- **Immutable, never-overwritten document assets.** History and read-receipts
  work because renders are byte-stable. Keep this in the rebuild.
- **Deterministic pricing reconciliation** (`lib/pipeline.reconcileQuotation`).
  The model quotes fixed numbers and the pipeline re-derives the total; money
  cannot drift. This is the integrity high point.
- **Hand-rolled ZIP and tar** instead of dependencies — matches the mandate's
  "replaceable with 20 lines of our own code". Add tests, keep the code.
- **Best-effort notifications that never break the triggering action.** Correct
  isolation; preserve it.
