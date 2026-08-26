# Runbook: dead letter replay

**Symptom**: deliveries are in the `failed` state, or an alert fired on dead
letter growth.

**Impact**: whatever those deliveries carried was never applied. The
projection is missing or stale for the affected entities. Reconciliation will
eventually correct pull request state, but the delivery itself stays failed
until someone acts.

## 1. Look at what failed and why

```
GET /api/github/deliveries?dead=1
```

Each record carries `event`, `repo`, `attempts`, `error` and, when the payload
failed validation, `issues` naming the exact fields.

Deliveries stop being retried automatically after 5 attempts. That is
deliberate: a delivery that failed five times usually needs a code change
first, and retrying it forever hides that.

## 2. Classify the failure

**Schema validation failure** (`issues` is populated). GitHub changed a
payload shape, or we modelled it wrongly. This is a code fix in
`lib/github/schema.ts`. Do NOT replay first: it will fail again identically.
Fix the schema, deploy, then replay.

**Handler error** (`error` names an exception). Read the message. Common ones:

- `404` on the entity: the pull request or repository was deleted between the
  event firing and processing. The handler already removes the projection in
  that case, so this is usually benign. Replay to confirm it settles.
- Rate limit or `GitHubUnavailableError`: transient. Replay.
- Anything else: a bug. Fix, deploy, replay.

**Everything failed at once, at the same time.** That is an outage, not a set
of individual problems. Check whether the App's credentials are still valid
(`github-app-token-failure.md`) before replaying anything.

## 3. Replay

One delivery:

```
POST /api/github/deliveries
{"action":"replay","deliveryId":"<id>"}
```

This resets the attempt count, so a human retry is not immediately re-buried
by the cap.

Everything failed in a window:

```
POST /api/github/deliveries
{"action":"replayRange","from":"2026-08-26T00:00:00Z","to":"2026-08-26T12:00:00Z"}
```

The response lists every outcome individually. Read it: a range replay where
three of eight still failed is a different situation from one that fully
succeeded, and a single "done" would hide that.

## 4. When the payload is beyond saving

A truncated or corrupt payload cannot be replayed into correctness. Recover
the state instead of the delivery:

```
POST /api/github/deliveries  {"action":"backfill"}
```

Backfill reconstructs the projection from the API alone and does not need the
delivery at all. This is also the answer if deliveries were lost entirely
rather than failed.

## 5. Confirm

- `GET /api/github/deliveries?dead=1` is empty.
- A reconcile reports zero drift.

## Note on retention

Processed and skipped deliveries are kept for 30 days as a debugging aid, so
"show me the webhook history for this pull request" stays answerable. Failed
ones are kept until dealt with.
