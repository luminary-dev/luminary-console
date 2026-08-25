# Data integrity — trace of every datum from source to pixel (2026-08-26)

The store has no database semantics: no transactions, no constraints, no
conditional writes. Every mutation is read-modify-write of a whole JSON file.
That single fact generates most of this document.

## Ownership and flow

| Data | Source of truth | Written by | Read by | Invalidation |
| --- | --- | --- | --- | --- |
| Client record | `console/clients/<slug>/record.json` | every mutation route, portal actions, pipeline | console pages, portal, documents, crons, assistant | 5s per-instance cache; cross-instance staleness up to 5s |
| Client index | `console/index.json` (denormalised copy of record headers) | `saveClient`, `deleteClient` | dashboard, search, CSV, backup, digest | same cache; **can diverge from records** (LC-001) |
| Doc number counter | `console/counter.json` | `nextDocNoBase`, `seedDocCounter` | client creation | never cached (correct); not atomic (LC-002) |
| Billing sequence | `record.billingSeq` per kind | `saveBillingDoc` | billing generation | per-record highwater; correct against delete-reuse (Wave 6 B12) |
| Rendered documents | immutable R2 assets, random-suffixed keys | `saveDoc` / `saveBillingDoc` | portal, preview, email, history | never invalidated (by design — history stays byte-identical) |
| Activity log | `console/state/activity.json`, cap 500 | `logActivity` (best-effort) | dashboard feed, /activity, client card | read-modify-write, concurrent entries can be lost; entries beyond 500 are gone forever |
| Sessions / revocation | `sessions.json` / `revoked.json` | login, revoke | dashboard card, proxy (60s cache) | revocation propagates ≤60s; registry is not consulted for validity (LC-010) |
| Notifications seen/read | `notifications.json` (global, team-wide) | mark-read routes | dashboard feed | shared across all three operators by design |
| Doc read-receipts | `doc_views.json`, 15-min throttle | portal doc views | console status column | best-effort |
| Push subscriptions | `push-subscriptions.json` | subscribe/unsubscribe, auto-prune on 404/410 | every notice | read-modify-write races possible |
| OTP state | `auth/otp-<hash>.json` | issue/verify | verify | single-use delete on success; attempts not atomic (LC-015) |
| Ops relay results | `ops-results/<uuid>.json` | Actions runner | relay long-poll | deleted after read; orphaned on relay timeout |

## Where two sources can disagree

1. **Index vs records** (LC-001): the index is a denormalised copy rebuilt on
   every save. A failed index read plus one save truncates it; a concurrent save
   pair loses one entry. Records remain correct; every list view lies.
2. **`paid` vs per-invoice attribution** (LC-003): `summarizeMoney.paid` counts
   all payments; per-invoice state counts only tagged ones. The handover pack
   reconciles this with an "Other payments received" line; the dashboard and
   BillingCard totals do not.
3. **`stage` vs facts** (`lib/stage.ts`): `currentStage` derives from the stored
   stage plus time drift, and `inferStage` covers legacy records. Coherent, but
   unpublishing the final receipt leaves `deliveredAt` behind (LC-025).
4. **`answersUrl` etc. vs `submissions[]`**: the latest-pointer fields are kept
   for compatibility and re-seeded into history on first new submission; the
   migration path in `app/c/[slug]/submit/route.ts:109-138` is correct.
5. **Session cookie vs registry** (LC-010): the cookie can be valid while the
   registry has no such session.

## Keys, dates, numbers

- **List keys**: mostly stable (`b.slug`, `d.id`, `s.sid`, `${e.at}-${i}`).
  Index-keyed mutations (payments remove, tasks toggle/remove, change-orders
  remove) send an array index to the server; two tabs plus one removal make the
  index point at the wrong element (facet of LC-002). Entities need IDs.
- **Dates**: stored as ISO UTC, formatted at the edge in `Asia/Colombo`
  consistently (`lib/time.ts`, `lib/handover.ts`, `todayLabel`). Task due dates
  are date-only strings compared lexically against a UTC-derived `today()` —
  off-by-one around midnight Colombo vs UTC (minor). `relTime` clamps future
  timestamps to "just now" (good) but never ticks (LC-023).
- **Money**: LKR as integers/floats in `Payment.amount` (rounded to cents on
  input), pre-formatted strings inside doc data with `parseAmount` refusing
  ranges/prose (good). Change-order amounts are stored as formatted *strings*
  (`ChangeOrder.amount`) and summed by regex-stripping — works, but it is a third
  representation of money on one record. The deterministic reconciliation of
  quotations against `lib/pricing.ts` is the strongest integrity mechanism in
  the codebase; keep it.
- **Optimistic updates**: TasksCard is the one true optimistic surface and does
  it right (server list authoritative, rollback with reason). Everything else
  refetches via `router.refresh()`.

## Backup and recovery

- Weekly cron emails a zip of the index + all records (JSON only). Delivery
  failure now fails the run (Wave 6 B18). **Restore has never been drilled**
  and there is no restore script or documented RPO/RTO (LC-066): as of today,
  restoring means hand-uploading JSON to R2. Assets are excluded by design
  (re-renderable via `scripts/rerender.ts`), but signed acceptance/signature
  stamps re-render only because they live in the record — verify that in the
  drill.
- Client deletion is archive-first (all PDFs emailed, abort if any fails) —
  the best-designed destructive path in the app.
