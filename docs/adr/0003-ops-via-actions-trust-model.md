# 3. Ops-via-Actions runs console mutations with production credentials

Date: 2026-09-09

## Status

Accepted, with a follow-up (a protected GitHub Environment) recommended below.

## Context

When `OPS_VIA_ACTIONS=1`, the console UI relays every business mutation
(`POST/PATCH/PUT/DELETE` under `/api/clients` and `/api/publish`) to
`/api/ops/relay`, which dispatches the **Ops · Console API** workflow
(`.github/workflows/ops-run.yml`). `scripts/ops.ts` then checks out this repo
on the runner and invokes the resolved route handler in-process, with the full
production secret set injected into the job (`ANTHROPIC_API_KEY`, `R2_*`,
`RESEND_API_KEY`, `SESSION_SECRET`, `CLOUDFLARE_API_TOKEN`,
`GITHUB_APP_PRIVATE_KEY`, `VERCEL_TOKEN`, `OPENAI_API_KEY`,
`LANDING_REPO_TOKEN`, `TELEGRAM_*`). The Actions run log is the receipt.

This is deliberate: it makes every operation auditable on GitHub, byte-for-byte
what the console UI would have done, attributed to the dispatching operator.

It also means: **anyone with write access to this repository can run any
mutating console operation — including `DELETE` on any client — with production
credentials, from the Actions tab, with no second approval.** The
`ops-doc-action` / `ops-new-client` reusable-workflow calls forward every
secret via `secrets: inherit`. The audit recorded this as OPS-14.

Injection is contained and stays that way: operator inputs travel through
`env:` and `jq --arg`, never string-interpolated into a shell command (the
LC-089 lesson), and the CI `workflows` job runs actionlint + shellcheck to keep
it so. The residual risk is authorization, not injection: write access is the
only gate on a destructive, credential-holding operation.

## Decision

Keep the Actions-as-control-plane model — the auditability is worth it for a
three-operator studio — but treat "repo write" as too coarse a gate for the
destructive, credential-holding half of it, and reduce the blast radius:

1. **Least-privilege token** (done, OPS-05): every workflow now sets
   `permissions: contents: read`; the ops work uses its own PATs, not the
   default `GITHUB_TOKEN`.
2. **Bind the ops workflows to a protected GitHub Environment** with **required
   reviewers** for the destructive methods (`DELETE`/`PATCH`), so a second
   operator approves a teardown before it runs. This is a GitHub repository
   setting (Settings → Environments), not something this repo can encode, so it
   is the outstanding action from this ADR.
3. **Keep `OPS_VIA_ACTIONS` off** wherever the direct path is acceptable, so the
   powerful dispatch surface is only live where it is actually used.

## Consequences

Until (2) is configured, the trust boundary for destructive console operations
is repository write access. That is documented here so it is a known, chosen
posture rather than an accident, and so the Environment follow-up has an owner.
