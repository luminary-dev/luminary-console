# Deployment

## How it deploys

Vercel builds and deploys from `main`. Every push to `main` deploys to
production; every pull request gets a preview URL. There is no staging
environment, deliberately: see the decision below.

`main` is pull-request only, with the CI job named **`Build`** as a required
status check in the branch ruleset. That name is load-bearing. Renaming the
job without updating the ruleset in the same commit silently removes the gate.

## What CI runs

`.github/workflows/ci.yml`, on every pull request and every push to `main`:

| Job | Steps |
| --- | --- |
| `1 · Lint, typecheck & test` | `npm run lint`, `npm run typecheck`, `npm run test:coverage`, coverage uploaded as an artifact |
| `Build` | `npm run build`, which also typechecks. Failures on `main` ping Telegram |
| `2 · Security scan` | `npm audit --audit-level=high`, Gitleaks |

The live-fire suites (`test:live:*`) must never run in CI. They spend real
money, open real pull requests and send real push notifications. They are
named to make that hard to do by accident.

## Environment variables

Set on all three Vercel targets (production, preview, development) and in
`.env.local` for local work.

### Required for the console to function

| Variable | Purpose |
| --- | --- |
| `CONSOLE_USERS` | Operator allowlist and credentials |
| `SESSION_SECRET` | Session cookie HMAC, and the key for the OTP HMAC |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Storage |
| `RESEND_API_KEY`, `SENDER`, `STUDIO_EMAIL` | Email, including sign-in codes |
| `ANTHROPIC_API_KEY` | Document drafting and the studio assistant |
| `CRON_SECRET` | The bearer Vercel Cron presents |

### GitHub

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | The App. Preferred path |
| `GITHUB_APP_INSTALLATION_ID` | Optional, saves a lookup per cold start |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature verification. Without it the endpoint refuses every delivery |
| `GITHUB_ORG` | Defaults to `luminary-dev` |
| `GITHUB_OPERATORS` | `email:login` pairs, powering the personal views and notification targeting |
| `GITHUB_QUIET_HOURS`, `GITHUB_QUIET_TZ` | Optional per-operator quiet hours |
| `GH_TOKEN` | Fallback when the App is not configured. REST only, no webhooks |

### Optional

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `VERCEL_TOKEN`,
`VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` (subdomain and site automation),
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (notifications), `OPENAI_API_KEY`,
`OPENAI_IMAGE_MODEL` (publish portal artwork), `LANDING_REPO`,
`LANDING_REPO_TOKEN` (publish portal), `OPS_VIA_ACTIONS`, `CONSOLE_REPO`,
`CONSOLE_REPO_TOKEN` (ops relay), `ROOT_DOMAIN`, `CONSOLE_HOST`.

Every optional integration degrades to a documented no-op when its variables
are absent, rather than failing.

`BLOB_READ_WRITE_TOKEN` is dead since the R2 migration and can be removed.

## Scheduled jobs

`vercel.json`:

| Path | Schedule | What it does |
| --- | --- | --- |
| `/api/cron/backup` | Mondays 03:00 UTC | Zips the index and every client record, emails it, then checks DNS health. Fails the run if the email does not go out |
| `/api/cron/digest` | Daily 04:00 UTC | Stalled-deal digest to the studio |
| `/api/github/process` | Every 5 minutes | Processes pending webhook deliveries, and reconciles when the last reconcile is over an hour old |

## Deploying a change

1. Branch, commit with a Conventional Commits message referencing any finding
   id it closes.
2. Open a pull request. CI runs; the preview URL appears on the PR.
3. Check the preview. It shares production storage, so **be careful with
   mutations**: a preview deploy is not a sandbox, it is production data behind
   a different URL. Read-only checking is safe; do not create or delete clients
   from a preview.
4. Merge. `main` deploys automatically.
5. Watch the deployment. If it fails on `main`, Telegram gets a message.

## Rollback

Vercel keeps every deployment. Promote a previous one from the dashboard, or:

```
vercel rollback <deployment-url>
```

**Before rolling back, check whether the release included a store change.**
The console writes JSON that older code may not understand. The changes so far
have all been additive (new optional fields, new key prefixes), so a rollback
is safe, but that is a property to keep rather than assume: any migration
that rewrites existing objects needs expand-and-contract, and
`docs/MIGRATION-PLAN.md` describes what that means here.

Two release-specific notes:

- The session change (LC-010) means **everyone signs in again** after it
  deploys, because no session id is in the registry until the next login.
  Rolling back does not undo that.
- Enabling the GitHub webhook secret before updating it in the App settings
  causes rejected deliveries during the gap. GitHub retries them, and a
  reconcile catches anything permanently lost.

## Why there is no staging

The mandate allows skipping it with a written mitigation, and this is that
mitigation.

For three people, a staging environment would be a fourth place to keep
credentials in sync and a fourth thing to notice is broken. What replaces it:

- **Per-PR previews** on the real code with the real data shape.
- **A CI gate** that runs lint, typecheck, tests with coverage, a build and a
  security scan before anything reaches `main`.
- **Additive migrations**, so a rollback does not strand data.
- **A rollback that takes one command** and no rebuild.

What this genuinely gives up: there is nowhere to rehearse a destructive
migration, and previews share production storage so a mutation from a preview
is a real mutation. If a migration ever needs rehearsing, provision a scratch
R2 bucket and point a preview at it for the duration, rather than standing up
a permanent staging environment.

## Not yet in place

From the mandate's section 13, recorded rather than implied:

- **No containers.** Vercel builds directly; there is no Dockerfile, so the
  non-root, read-only-root-filesystem and dropped-capabilities requirements do
  not apply and are not met.
- **No infrastructure as code.** Cloudflare DNS, the R2 bucket, the Vercel
  project and the GitHub App are all configured by hand. OpenTofu with remote
  state, `tflint` and `checkov` is unbuilt.
- **No `docker compose up`** for local dependencies, and no `justfile`. Local
  development is `npm install && vercel env pull && npm run dev`, which works
  because every dependency is a hosted service.
- **No ephemeral per-PR database** with seeded data, because there is no
  database.
- **No SBOM, image signing or provenance**, since there is no image.
- **No Lighthouse CI, bundle budget, visual regression or Playwright** in the
  pipeline. See `docs/TESTING.md`.
