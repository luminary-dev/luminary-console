# luminary-console

Luminary Studio's client-document platform, end to end:

1. **New client** (auth-protected console) — enter company details + a short
   brief. Claude Opus drafts the **estimate** and tailors the discovery
   **questionnaire**; both render as branded web pages + PDFs; the client gets
   their own subdomain (`<slug>.luminary-dev.xyz` — Cloudflare CNAME + Vercel
   domain attach, fully automated); the studio gets an email with everything.
2. **Client answers** the questionnaire → answers PDF is emailed to the studio
   (and optionally to the client), then Claude drafts the **quotation**,
   **proposal** and **contract & SOW** from the answers — as console drafts.
3. **Review & publish** — each draft can be revised with plain-English
   instructions ("drop the total to 40,000"), then published to the client's
   subdomain. **Invoice** and **receipt** generate on demand from the
   quotation.

## Architecture

- `proxy.ts` — host routing (`<slug>.luminary-dev.xyz` → `/c/<slug>/…`) and the
  console auth gate (HMAC session cookie).
- `lib/generate.ts` — Claude Opus 5 with structured outputs; every document has
  a JSON contract in `lib/templates/docs.ts` that doubles as its schema.
  Server-side refusal fallbacks are enabled.
- `lib/templates/` — the Luminary business-doc design system; renders each
  contract to branded HTML (web + print) — PDFs via headless Chromium.
- `lib/store.ts` — Cloudflare R2 persistence over the S3 API: state on fixed
  keys (one GET / one PUT, no listing), assets on unique keys behind the
  authed `/api/asset/…` stream. `lib/r2.ts` builds the client.
- `lib/domains.ts` — Cloudflare DNS + Vercel domain automation.
- `app/c/[slug]/…` — the public client sites; `app/…` — the console.

## Environment

| Var | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` / `SESSION_SECRET` | console auth |
| `ANTHROPIC_API_KEY` | document drafting |
| `RESEND_API_KEY` / `SENDER` / `STUDIO_EMAIL` | email |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | storage (Cloudflare R2, private bucket) |
| `CLOUDFLARE_API_TOKEN` (+ optional `CLOUDFLARE_ZONE_ID`) | DNS automation |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` | domain attach |
| `ROOT_DOMAIN` / `CONSOLE_HOST` | defaults: `luminary-dev.xyz` / `console.…` |

Missing DNS tokens degrade gracefully: everything still generates, and the
client record shows the manual CNAME to add.

## Develop

```bash
npm install && vercel env pull && npm run dev
```

## GitHub Actions — CI & ops

**Naming convention** (every workflow follows it):
- file `<area>-<action>.yml`; workflow `name:` is `Area · Action` in Title
  Case (`CI`, `Release · Tag`, `Ops · Console API`);
- `run-name:` appends the runtime context (`Ops · New Client · <company>`,
  `Ops · Console API · POST /api/… · by <admin>`);
- job ids are kebab stage verbs; display names are `N · Verb phrase` for
  sequential stages (`1 · Prepare payload`, `2 · Create client`) or a plain
  verb phrase for single-job workflows. Exception: job names pinned as
  required status checks by branch rulesets (`Build` here, `Lint & Build` on
  the landing repo) never change without updating the ruleset in the same
  commit;
- every step carries an explicit Title-Case verb-phrase `name:` — no
  defaulted step names.

CI (`Build`) runs on every PR and push to `main` (build + typecheck; failures
on `main` ping Telegram), and `release-tag.yml` tags a release whenever the
package version changes. `main` is PR-only with `Build` required.

Every console operation is also runnable from the Actions tab, with the run
log as the receipt. `scripts/ops.ts` resolves a path against `app/api/**` and
invokes that route handler directly on the runner (no session — the runner
holds the same backend credentials from Actions secrets), so an ops run is
byte-for-byte what the console UI would have done; the activity feed
attributes it to "operator".

- **Ops · Console API** — generic: any method + path + JSON body
  (payments, stage changes, sends, tasks, notes, billing, …).
- **Ops · New Client** — the New-client pipeline (estimate, questionnaire,
  PDFs, subdomain, email).
- **Ops · Document Action** — publish / unpublish / delete / regenerate
  (with instructions + cascade) / retry stage-2.
- **Ops · Publish Article** / **Ops · Add Project** — the landing-page Publish
  portal: optional Claude draft, gpt-image-2 artwork, PR against the landing
  repo's `dev`.

Secrets: the workflows read the same names as `.env.local` — seed them with
`gh secret set -f .env.local` (plus `LANDING_REPO_TOKEN` / `OPENAI_API_KEY`
if not already there).

### Ops-via-Actions (the UI executes on Actions too)

With `OPS_VIA_ACTIONS=1` and `CONSOLE_REPO_TOKEN` (fine-grained PAT on this
repo, Actions: write) set, the console UI itself stops executing business
mutations in the deployment: `lib/ops-fetch.ts` sends every
POST/PATCH/PUT/DELETE under `/api/clients` and `/api/publish` to
`/api/ops/relay`, which dispatches the "Ops · Console API" workflow (with the
signed-in admin as `actor`, so the activity feed keeps attribution), waits for
`scripts/ops.ts` to write the route's response back into the store
(`ops-results/<id>.json`), and returns it — the UI behaves as before, just
slower (runner spin-up ≈ 30–60s), and every operation has an Actions run as
its receipt. Unset the flag (or the token) and the UI falls back to direct
execution automatically. Reads and housekeeping (activity, sessions, search,
assets, auth) always stay direct.

## Storage

Cloudflare R2 via its S3-compatible API (endpoint
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`). The bucket
is **private** — no public access, no `r2.dev` domain. Console-side links go
through `GET /api/asset/<key>`, which the proxy's session gate protects and
which refuses to render stored HTML/SVG on the console origin; the few links
that end up in emails are presigned GETs (7 days).

Browser-direct questionnaire uploads need a CORS policy on the bucket
(`PUT`, `content-type`, origins = console host + `*.luminary-dev.xyz` +
localhost). `npm run r2:init` verifies the credentials with a probe object and
prints the exact policy to paste.
