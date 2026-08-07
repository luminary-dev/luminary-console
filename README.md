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
