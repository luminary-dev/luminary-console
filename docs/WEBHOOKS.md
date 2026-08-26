# Webhooks: every event, its handler, its idempotency strategy, its failure mode

The ingestion pipeline is deliberately boring. It has one interesting idea and
everything else follows from it:

> **Handlers do not apply the payload. They re-read the entity from the API.**

That single decision is what makes at-least-once delivery, out-of-order
arrival, and lost deliveries all safe, and it is why there is no per-action
logic for `opened` versus `closed` versus `reopened`.

## The path a delivery takes

```
GitHub
  │  POST /api/github/webhook
  ▼
1. read the RAW body            app/api/github/webhook/route.ts
2. verify HMAC over those bytes lib/github/webhooks.ts
3. parse (only now)
4. store under its delivery id  lib/github/inbox.ts
5. respond 200                  (target: well under 2 seconds)
  │
  ├─ after(): process immediately, best effort
  └─ cron sweep: process anything still pending   /api/github/process
       │
       ▼
6. validate against the event schema   lib/github/schema.ts
7. run the handler                     lib/github/handlers.ts
       │  handler re-reads the entity from the API
       ▼
8. write the projection                lib/github/projection.ts
```

Steps 1 to 5 are the only things on the request path. Everything else happens
after the response, because GitHub disables a webhook that is slow or that
keeps erroring.

## Verification

Three defences, in `lib/github/webhooks.ts`:

1. **HMAC-SHA256 over the raw body**, compared with `timingSafeEqual`. The
   signature covers the exact bytes GitHub sent. Any middleware that parses,
   re-serialises, pretty-prints or re-encodes the body first invalidates it.
   The route calls `await req.text()` as its first statement and does not
   parse until after verification, and `tests/github-webhooks.test.ts` has a
   block of tests that fail if that order ever regresses.
2. **A freshness window** (5 minutes) using the payload's own timestamp, so a
   captured body cannot be replayed indefinitely. A payload with no timestamp
   is accepted rather than rejected: not every event carries one and failing
   closed would drop legitimate deliveries.
3. **Delivery-id dedup**: GitHub retries with the same `X-GitHub-Delivery`, so
   a redelivery finds the existing record and is acknowledged without being
   queued twice.

If `GITHUB_WEBHOOK_SECRET` is unset the endpoint returns 503 and processes
nothing. An unverifiable delivery is indistinguishable from a forged one and
this endpoint is public.

## Idempotency

Dedup is a best-effort optimisation, not the correctness guarantee. Two
instances can pass the existence check at the same time, so correctness comes
from the handlers instead:

- **Reconcile, do not apply.** A handler works out which entity the event
  concerns, reads that entity's current state from the API, and stores that.
  Running the same delivery twice produces the same result.
- **Monotonic projection writes.** `putPullRequest` refuses to overwrite a
  newer stored projection with an older one, comparing GitHub's own
  `updated_at`. A redelivered `closed` that arrives after a `reopened` cannot
  move the state backwards.
- **One object per entity, never a shared array.** A push fans out to
  `check_run`, `check_suite`, `workflow_run`, `workflow_job` and `status`
  within milliseconds. A shared array would make those writers race, which is
  exactly the read-modify-write defect recorded as LC-002. Per-entity keys
  have no such race.

## Failure modes

| Situation | What happens |
| --- | --- |
| Bad or missing signature | 401, nothing stored, terse response so a prober learns nothing |
| Body over 25MB | 413 before any parsing |
| No webhook secret configured | 503, nothing stored |
| Storage write fails | 503, so GitHub retries. This is the one case where a non-200 is correct: we have not durably taken responsibility |
| Payload fails its schema | Stored, marked `failed` with the validation issues, visible in the dead letter UI |
| Event type we do not model | Stored, marked `skipped`, acknowledged. GitHub disables a webhook that keeps erroring, so an unmodelled event must not be a fault |
| Handler throws | Marked `failed` with the error, retried by the sweep up to 5 attempts, then it waits for a human |
| GitHub is down mid-processing | Marked `pending` again WITHOUT burning an attempt, and the sweep stops early rather than marching the queue into a deferred state |
| `after()` scheduling fails | Ignored. The delivery is stored and pending; the sweep gets it |
| Delivery lost entirely | Reconciliation notices and reports drift |

## Recovery

- **Replay one delivery**: dead letter UI, or `POST /api/github/deliveries`
  with `{"action":"replay","deliveryId":"..."}`. Resets the attempt count so a
  human retry is not immediately re-buried by the cap.
- **Replay a time range**: `{"action":"replayRange","from":"...","to":"..."}`.
- **Backfill**: `{"action":"backfill"}` reconstructs the projection from the
  API alone, with webhooks disabled entirely. This is the recovery path for a
  missed webhook window and also how the console is populated on day one.
- **Reconcile**: `{"action":"reconcile"}` compares the projection against
  GitHub and REPORTS drift. Drift is not just something to fix quietly: a
  non-zero count means deliveries are being lost, which is a signal about the
  health of the pipeline, so it is surfaced rather than silently corrected.

## Event reference

Every event below is subscribed in the App (see `docs/GITHUB-APP.md`).
"Reconciles" means the handler re-reads the entity and stores the truth.

### Pull requests

| Event | Actions handled | Handler behaviour |
| --- | --- | --- |
| `pull_request` | opened, edited, closed, reopened, ready_for_review, converted_to_draft, synchronize, assigned, unassigned, review_requested, review_request_removed, labeled, unlabeled, and a base branch change (`changes.base.ref`) | Reconciles the PR. No per-action logic by design |
| `pull_request_review` | submitted, edited, dismissed | Reconciles the PR, because a dismissed review changes merge readiness |
| `pull_request_review_comment` | created, edited, deleted | Reconciles the PR |
| `pull_request_review_thread` | resolved, unresolved | Reconciles the PR, because resolving a thread can unblock a merge |

### Checks and CI

| Event | Handler behaviour |
| --- | --- |
| `check_run` | Reconciles every PR the check names. A check on a branch with no PR is recorded and skipped |
| `check_suite` | Same, via the suite's PR list |
| `status` | The legacy commit status API carries no PR reference at all, so it is logged; the connection is made by head SHA on the next reconcile |
| `workflow_run` | Stores the run (with its duration computed once) and reconciles any PR at that SHA |
| `workflow_job` | Logged only. Job events are high volume and the useful part, the failing step's log, is fetched on demand by the CI panel |

### Repository lifecycle

| Event | Handler behaviour |
| --- | --- |
| `push` | Records the push, notes a force push, refreshes the repo's `pushedAt`. Force pushes invalidate cached head SHAs; the PR's own `synchronize` event follows and the reconcile fixes it |
| `create` / `delete` | Branch and tag creation and deletion, logged |
| `repository` | renamed, transferred, privatized, publicized, archived, unarchived, deleted. A rename deletes the OLD projection (from `changes.repository.name.from`) before storing the new one, or the repo list shows both. A deletion removes the projection |
| `branch_protection_rule` | Logged; protection state is read on demand for merge readiness |

### Issues

| Event | Handler behaviour |
| --- | --- |
| `issues` | Logged with the action and number |
| `issue_comment` | If `issue.pull_request` is present this is a PR conversation comment, so it reconciles the PR. Otherwise it is logged. That field is the only discriminator |

### Deployments and releases

| Event | Handler behaviour |
| --- | --- |
| `deployment` | Stores the deployment as `pending` (a deployment with no status yet is pending by definition) |
| `deployment_status` | Updates the deployment's state and environment URL |
| `release` | Stores the release |

### Security alerts

The payload is the fact here, so these apply directly rather than reconciling.

| Event | Handler behaviour |
| --- | --- |
| `dependabot_alert` | Stores the alert with its advisory severity |
| `code_scanning_alert` | Stores the alert with its rule severity |
| `secret_scanning_alert` | Stores the alert, severity forced to critical. These carry no severity field, and defaulting to unknown would sort a live leaked credential below a moderate dependency warning |

### Merge queue and our own access

| Event | Handler behaviour |
| --- | --- |
| `merge_group` | Logged. A merge queue can reorder our PR, so the projection follows the PR events rather than the queue |
| `installation` | Logged, including suspension. This matters more than it looks: if the installation is suspended, deliveries simply stop, and without this a broken integration reads as a quiet week |
| `installation_repositories` | Adds projections for added repos and removes them for removed ones, immediately |
| `member` / `membership` / `organization` | Logged |

## Edge cases from section 3.7, and where each is handled

| Case | Where |
| --- | --- |
| Delivered twice | Delivery-id dedup, plus idempotent handlers |
| Delivered out of order | Reconcile-not-apply, plus the monotonic `updated_at` guard in `putPullRequest` |
| Signature invalid | `verifyDelivery`, 401 |
| Payload truncated | JSON parse failure after verification, 400 |
| Repo renamed, transferred, archived, privatised, deleted | `repository` handler |
| Force push invalidates a cached head SHA | `push` handler notes it; `fetchComparison` treats the resulting 404/422 as expected |
| PR opened, closed, reopened, drafted, readied, retargeted, merged | One reconcile per event, no ordering assumption |
| PR from a fork | `fromFork`, including the deleted-fork case where `head.repo` is null |
| PR with 500 files or a 50MB diff | Files and diffs are separate calls with their own caps; a diff GitHub refuses to render (406) returns null rather than throwing |
| Author's account deleted | Every actor is optional; `GHOST_ACTOR` covers the tombstone |
| Review submitted then dismissed | Dismissed reviews are kept and flagged, and stop counting toward approval |
| Required check that never reports | Shows as a pending blocker, named |
| Check reporting `neutral` or `skipped` | Explicitly NOT treated as a failure |
| Merge queue reorders our PR | `merge_group` logged; PR state follows its own events |
| Commit with no author email | Schema allows a null or empty email |
| Tag that is not semver | Releases store `tag_name` verbatim; nothing parses it as semver |
| Primary rate limit exhausted | Wait until `x-ratelimit-reset` |
| Secondary rate limit | Different backoff: exponential with jitter, and reduced concurrency (the sweep is sequential for this reason) |
| `X-RateLimit-Reset` in the past | Clamped to a minimum wait, so it cannot become a hot loop |
| ETag 304 mishandled as empty | The client returns the cached body on a 304, with a test asserting it |
| `Link` header stops early | Pagination follows `rel="next"` only, never a synthesised page number |
| GitHub 502 on a large query | Retried with backoff |

## Local development

GitHub cannot reach `localhost`. Two supported approaches:

1. **Tunnel**: expose the dev server (`cloudflared tunnel --url http://localhost:3000`
   or similar) and point a second, development GitHub App's webhook URL at
   `<tunnel>/api/github/webhook`. Use a SEPARATE App and secret for
   development; do not point the production App at a laptop.
2. **Replay from fixtures**: capture a real delivery body, then POST it with a
   correct signature computed from your local `GITHUB_WEBHOOK_SECRET`. This is
   what the integration tests do, and it is the faster loop for handler work.
   `tests/github-pipeline.test.ts` shows the exact shape.

The **Recent Deliveries** tab in the App settings is the first place to look
when something is wrong: it shows the request, the response, and lets you
redeliver with one click.
