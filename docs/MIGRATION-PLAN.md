# Migration plan

Two migrations matter for this codebase. The first is the one already
performed during the audit remediation, recorded so the reasoning survives.
The second is the one deferred, with enough detail that whoever picks it up is
not starting from a blank page.

## 1. Strangling the flat store's defects (done)

The audit found two defects in the R2 store (LC-001, LC-002) that a full
database migration would have fixed, but which could not wait for one.

The approach was expand and contract, not rewrite:

- `lib/store.ts` kept **every existing export and signature**, so the ~40 call
  sites did not change. `saveClient(record)` behaves byte-for-byte as before.
- New capability was added alongside: `updateJson`, `updateState`,
  `getClientWithEtag`, `saveClient(record, { expectedEtag })`, `listState`,
  `mapLimit`, `getClients`.
- Reads were split into tiers rather than changed globally: `readState` kept
  its lenient "unreadable means null" behaviour, which several state files
  depend on, while the index gained a strict read that throws.

Nothing was migrated in place, no data was rewritten, and rollback at any
point was reverting the module.

**The one behaviour change**: `getIndex()` can now throw where it previously
returned `[]`. That is the fix for LC-001, and it is why the error boundaries
(LC-020) had to land in the same release: a corrupt index must render an
error, not a white screen. The crons now fail their run rather than emailing a
one-record backup, which is the intended trade.

## 2. Flat files to PostgreSQL (deferred)

### Why it is deferred rather than done

Provisioning a database is the operators' decision, not something to do to a
live system unasked. The audit's findings that a database would have fixed
(LC-001, LC-002) are fixed on the current store using conditional writes, so
the pressure is off.

### What still argues for it

- **No transactions across entities.** Creating a client writes a record, an
  index entry and a counter. A failure between them leaves a partial state
  that nothing detects.
- **No query layer.** Every list is a full scan of every record. That is
  bounded and concurrency-limited now, but it does not become cheaper as the
  org grows.
- **Array-index-keyed mutations.** Payments, tasks and change orders are
  removed by array position, so two tabs plus one removal can delete the wrong
  element. Entities need stable ids, which is a schema change either way.
- **The audit log is capped at 500 entries and is not tamper-evident.**
- **No compound queries.** "Which clients have an overdue invoice AND an open
  task" means reading everything.

### Expand and contract, in order

**Phase A: provision and shadow.**
Provision Postgres (Neon through the Vercel Marketplace is the obvious
choice). Define the schema in Drizzle with checked-in SQL migrations. Write to
BOTH stores on every mutation, read from R2. Compare the two nightly and
report drift. Nothing depends on the database yet, so it can be dropped at any
point.

**Phase B: read migration, one aggregate at a time.**
Behind a flag, switch reads to Postgres per aggregate, starting with the
GitHub projection because it is fully rebuildable from the API and therefore
the safest thing in the system to get wrong. Then the client index, then
client records. Keep dual writes throughout.

**Phase C: contract.**
Stop writing to R2 for the migrated aggregates. R2 keeps the immutable assets
(documents, PDFs, uploads) which have no reason to move into a database at
all.

### Schema notes

- UUIDv7 primary keys, with the GitHub node id as a separate unique column.
- `created_at` and `updated_at` everywhere.
- `timestamptz` in UTC, formatted at the edge, matching what the code already
  does.
- `jsonb` with GIN for the AI-generated document data and raw webhook
  payloads, which are genuinely schemaless.
- Partial indexes for the open-state and soft-delete filters, which is what
  most list queries actually filter on.
- Every forward migration paired with a tested rollback.
- A seed script producing realistic data so the console is developable without
  touching GitHub or a live client.

### The tables the audit specified

`webhook_deliveries` and `webhook_processing_failures` (both currently one R2
object per delivery), `repositories`, `pull_requests`, `pull_request_reviews`,
`review_threads`, `checks`, `workflow_runs`, `deployments`, `releases`,
`issues`, `github_users`, `sync_state`, `rate_limit_samples`, `notifications`,
`notification_rules`, `saved_views`, `audit_events`, `sessions`,
`allowlist_entries`, `api_keys`, `incidents`, `notes`, `feature_flags`.

Most of these already exist as typed shapes in `lib/github/entities.ts` and
`lib/types.ts`, so the schema is largely a transcription. The ones with no
current equivalent are `rate_limit_samples` (the console shows the current
budget but records no history), `notification_rules` (defaults are in code),
`saved_views` (same), `api_keys`, `incidents` and `feature_flags`.

## 3. Also deferred, and why

**Redis.** Wanted for the shared rate limiter, session lookups, queues and
pub/sub for real-time fan-out. The rate limiter's auth bucket is shared
through R2 compare-and-swap instead, which is slower but correct, and SSE
polls the delivery inbox rather than subscribing to a channel. Redis becomes
worth provisioning at the same time as Postgres.

**A real worker.** Vercel has no long-lived process, so background work is
`after()` plus a five-minute cron sweep. That is genuinely sufficient for this
volume. A queue with workers becomes worth it when a backlog stops draining
between sweeps.

**The workspace split.** Reasoning in `ARCHITECTURE.md`: the seam exists
(`lib/github/**` imports nothing from the document domain), only the packaging
does not.

**GitHub OAuth as the entry path.** The access model deviation is recorded in
`docs/ACCESS-CONTROL.md` with the pieces that would close it. `GITHUB_OPERATORS`
already maps console identities to GitHub logins, which is the same
information in a weaker form.
