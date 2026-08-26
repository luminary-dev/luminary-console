# Runbook: GitHub rate limit exhaustion

**Symptom**: the rate limit badge on `/github` is red or near zero, actions
fail with a rate limit message, or an alert fired on remaining budget.

**Impact**: reads degrade to the stored projection, which the console says
plainly rather than showing a spinner. Mutations fail until the budget
returns.

## Know which limit you have hit

They are different and the correct response is different.

**Primary**: `x-ratelimit-remaining` is 0. Deterministic, and the response
carries `x-ratelimit-reset`, a UNIX second telling you exactly when it comes
back. 5,000 requests an hour for an App installation.

**Secondary**: a 403 or 429 whose message mentions a secondary rate limit or
abuse detection. This is a CONCURRENCY guard, not a volume one. It does not
decrement the primary counter, and retrying at the same rate re-trips it
immediately.

The client already handles both (`lib/github/ratelimit.ts`): it waits for the
reset on a primary limit, and backs off exponentially with jitter on a
secondary one. If you are reading this, the automatic handling was not enough.

## 1. Check the actual budget

```
GET /api/github/pulls/... (any read)   -> the badge on /github
```

or directly:

```
curl -H "Authorization: Bearer <token>" https://api.github.com/rate_limit
```

Look at `resources.core.remaining` and `resources.core.reset`, and at
`resources.graphql` separately: the PR inbox uses GraphQL, which has its own
budget measured in points, not requests.

## 2. Primary exhaustion: stop spending, then wait

Nothing recovers it early. Reduce spend until the reset:

- **Pause the sweep.** Comment out the `/api/github/process` cron entry in
  `vercel.json` and redeploy, or accept that each sweep will mostly no-op with
  deferred outcomes.
- **Do not run a backfill or a reconcile.** Both are full org reads and both
  are the most expensive things this console does.
- The console keeps working from the stored projection throughout.

## 3. Secondary limit: reduce concurrency

Look for what is running many requests at once:

- A backfill or reconcile running while a large delivery backlog drains.
- A batch action over many pull requests. Batches are sequential by design,
  so this is unusual.

Stop the concurrent thing. The breaker in `lib/github/client.ts` opens after
5 consecutive hard failures and fails fast for 30 seconds, which is what
stops a bad minute becoming a bad hour.

## 4. If exhaustion is recurring

Something is spending more than it should. In order of likelihood:

1. **Conditional requests are not working.** A 304 costs no budget, so if the
   ETag cache is being bypassed, every read costs full price. The cache is per
   instance, so a lot of cold starts means a lot of cache misses. Check
   whether `fromCache` is ever true in practice.
2. **The sweep is reconciling too eagerly.** Every delivery causes one entity
   read. A high-volume repo with many `check_run` events multiplies that.
   Consider coalescing multiple deliveries for the same entity before
   processing.
3. **Reconciliation is running too often.** It is hourly by design and it is a
   full org read. `RECONCILE_EVERY_MS` in `app/api/github/process/route.ts`.

## 5. Confirm

Budget recovers at the reset time. The badge returns to normal. A reconcile
afterwards catches anything missed while degraded.
