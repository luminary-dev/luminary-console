# Observability

What exists today, how to answer the common questions, and what is still
missing. This document is deliberately honest about the second part: the audit
recorded "no observability" as a finding (LC-054), and what follows is a
partial answer, not a complete one.

## Structured logging

`lib/logger.ts` emits one JSON line per event:

```json
{"ts":"2026-08-26T10:00:00.000Z","level":"error","msg":"billing action publish failed",
 "requestId":"a1b2c3d4e5f6","data":{"err":{"name":"Error","message":"..."}}}
```

- `logger.info / warn / error(msg, fields?)`, plus `logger.child(bound)` for
  binding a requestId once.
- `requestId` is promoted to the top level so a log drain can group on it.
- **Everything passes through `lib/redact.ts` first**, including the message
  string itself, because `logger.error(\`failed: ${presignedUrl}\`)` is the
  common shape of an accidental leak.

### Redaction

`lib/redact.ts` is both key-aware (a value under `authorization` is a secret
whatever it looks like) and pattern-aware (the same secret usually arrives
glued into the middle of a message). It covers bearer tokens, Authorization
and Cookie headers in raw and JSON forms, session tokens by name and by shape,
Anthropic/OpenAI/Resend/GitHub key prefixes, AWS and R2 key ids and secrets,
webhook signatures, presigned URL parameters, email addresses and phone
numbers. It walks nested objects, arrays, `Error` including `.cause`, `Headers`,
`Map`, `Set`, and handles cycles.

Two deliberate non-rules, because a redactor that eats useful text gets turned
off: **32-hex strings are not redacted** (ETags, MD5s and hyphen-stripped
UUIDs all look like that), and phone matching requires a leading `+` or a full
`0`-prefixed run, so ISO timestamps, version numbers, money and commit SHAs
survive. Tests assert that several lines of ordinary prose come back
byte-identical.

### Correlation

`lib/errors.ts` `toProblem()` is the single funnel every API route's catch
block passes through. It mints a `requestId`, returns it to the browser in the
problem body, and logs the real cause under that same id. So when an operator
reports "it said something went wrong, reference a1b2c3d4e5f6", that string
finds the cause.

## What the console tells you about itself

- **GitHub API budget**: the rate limit badge on `/github`, read from
  `/rate_limit`, which costs no budget itself. Red means degraded reads.
- **Sync freshness**: the Sync card on `/github` reports how old the
  projection is and how many entities are stored. "Fresh as of" is stated
  rather than implied.
- **Delivery inbox**: `GET /api/github/deliveries` with `state=pending` or
  `dead=1` answers "is ingestion healthy". The processing sweep's response
  reports processed, failed, skipped and deferred counts.
- **Drift**: reconciliation reports how many entities disagreed with GitHub.
  Non-zero drift means deliveries are being lost, which is a pipeline health
  signal, not just something to fix quietly.
- **Activity log**: every mutating action with its actor, on `/activity`.
- **Sessions card**: every signed-in device.

## Answering the common questions

**"Why did that action fail?"** Get the reference from the operator, grep the
logs for it. The safe message went to the browser, the real cause to the log,
under that id.

**"Is GitHub ingestion healthy?"** `/api/github/deliveries?state=pending`
should be near empty and the sync age under a minute. If not,
`docs/runbooks/webhook-backlog.md`.

**"Did that webhook arrive?"** Two places: GitHub's own Recent Deliveries tab
in the App settings shows what they sent and what we answered; our delivery
inbox shows what we stored and what happened to it. The delivery id links them.

**"Why is the console slow?"** Vercel's function logs show per-request timing.
The known slow paths are documented in `docs/audit/PERFORMANCE-FINDINGS.md`:
cold store reads, and PDF rendering (now sharing a warm browser).

**"Who did that?"** The activity log, or for GitHub mutations, both the
activity log and GitHub's own audit trail.

## What is missing

Recorded plainly rather than implied. LC-054 is only partly closed.

- **No distributed tracing.** OpenTelemetry from browser through API to store
  and to the GitHub API is specified in the mandate and is not built. "Why was
  this request slow" is answerable only from Vercel's coarse timings.
- **No error tracking service.** No Sentry, no source maps, no release
  tracking, no grouping of recurring errors. A one-off failure and a failure
  happening a hundred times an hour look the same in the log.
- **No metrics.** RED per endpoint, webhook lag and processing duration, dead
  letter depth, rate limit remaining over time, cache hit ratio and queue
  depth are all unmeasured. The console shows current values on screen but
  nothing records them, so there are no trends and no alerting thresholds.
- **No alerting.** Nothing pages or posts when the dead letter grows, the rate
  limit nears exhaustion, the installation token fails, or the error rate
  spikes. The runbooks for those conditions exist and are written; the signal
  that would send you to them does not.
- **No committed dashboards.**
- **Most `console.*` calls are not yet converted** to the logger. The highest
  value one (`toProblem`) is done, so most API route failures are structured
  and redacted. The remaining ranked list is in the security agent's report
  and starts with `lib/email.ts`, `lib/push.ts`, `lib/telegram.ts` and the
  GitHub webhook route, all of which log provider errors that can carry
  credentials.

## Next steps, in order of value

1. **Convert the remaining logging call sites**, starting with the provider
   wrappers that log raw error objects.
2. **Add error tracking** with source maps and release tagging. This is the
   single biggest gap: it turns "a log line somewhere" into "this broke 40
   times since the deploy at 14:02".
3. **Emit metrics** for webhook lag, dead letter depth and rate limit
   remaining, since those three have runbooks waiting for them.
4. **Alert to Slack** on those three. The mandate is explicit that for three
   users, Slack is sufficient and paging would be over-building.
5. **OpenTelemetry** last: it is the most work and answers the least urgent
   question for a product at this scale.
