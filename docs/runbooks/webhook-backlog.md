# Runbook: webhook backlog

**Symptom**: the console is showing stale pull request state, or the delivery
inbox shows a growing number of `pending` deliveries, or an alert fired on
webhook processing lag.

**Impact**: the projection lags reality. The console is not wrong so much as
late, and it says so via the "synced" age on the inbox. Nothing is lost:
deliveries are durable from the moment they are acknowledged.

## 1. Confirm it is a backlog and not a delivery failure

Open `/github` and look at the sync age, then check the inbox:

```
GET /api/github/deliveries?state=pending&max=50
```

- **Many pending, none failed** means processing is behind. Continue below.
- **Many failed** is a different problem: see `dead-letter-replay.md`.
- **Nothing at all, and the sync age is old** means deliveries are not
  arriving. Check GitHub's own Recent Deliveries tab in the App settings
  (`https://github.com/organizations/luminary-dev/settings/apps/<app>/advanced`).
  Red entries there mean our endpoint is rejecting them: see
  `github-app-token-failure.md` and check `GITHUB_WEBHOOK_SECRET` matches.

## 2. Drain the queue

The cron sweep runs every five minutes and processes 25 deliveries a pass. A
burst larger than that drains over several passes. To drain now:

```
POST /api/github/process
```

from the console (signed in), or with the cron bearer:

```
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://console.luminary-dev.xyz/api/github/process
```

Repeat until `processed` comes back 0. The response reports `processed`,
`failed`, `skipped` and `deferred` counts.

## 3. If `deferred` is non-zero

Deferred means GitHub was unavailable and the sweep stopped early on purpose,
rather than marching the whole queue into a failed state one timeout at a
time. Deliveries were left `pending` WITHOUT burning a retry attempt.

Check GitHub's status (`https://www.githubstatus.com`). If GitHub is degraded,
do nothing: the next sweep picks up where this one stopped. If GitHub is
healthy, the circuit breaker may still be open from an earlier burst; it
closes itself after 30 seconds, so run the sweep again.

## 4. If the backlog is growing faster than it drains

Sustained high volume, for example a large migration pushing hundreds of
commits. Options in order of preference:

1. **Wait.** Processing is idempotent and ordering does not matter, so a
   backlog is a latency problem, not a correctness one.
2. **Raise the batch size** temporarily in `processPending(limit)`. Do not go
   far above 25: handlers reconcile against the API and a big parallel burst
   trips GitHub's secondary rate limit, which makes everything slower.
3. **Skip ahead with a backfill.** If the backlog is mostly redundant (a
   hundred `check_run` events for the same PRs), a backfill reconstructs
   current state directly from the API in one pass:

   ```
   POST /api/github/deliveries  {"action":"backfill"}
   ```

   Then mark the stale pending deliveries processed, or let them drain, since
   reprocessing them is harmless.

## 5. Confirm recovery

- `GET /api/github/deliveries?state=pending` returns few or none.
- The sync age on `/github` is under a minute.
- Run a reconcile and confirm the drift count is zero:

  ```
  POST /api/github/deliveries  {"action":"reconcile"}
  ```

  A non-zero drift count means deliveries were genuinely lost, not merely
  late. That is worth understanding rather than just fixing; the drift report
  names the affected pull requests.

## Prevention

The five-minute sweep exists because `after()` on the webhook route is best
effort: a cold start that dies or a deploy mid-flight leaves work pending.
If backlogs become common, the answer is a real queue with workers, not a
larger batch size.
