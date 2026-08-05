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
- `lib/store.ts` — Vercel Blob persistence (immutable versioned writes).
- `lib/domains.ts` — Cloudflare DNS + Vercel domain automation.
- `app/c/[slug]/…` — the public client sites; `app/…` — the console.

## Environment

| Var | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` / `SESSION_SECRET` | console auth |
| `ANTHROPIC_API_KEY` | document drafting |
| `RESEND_API_KEY` / `SENDER` / `STUDIO_EMAIL` | email |
| `BLOB_READ_WRITE_TOKEN` | storage (auto via Vercel Blob) |
| `CLOUDFLARE_API_TOKEN` (+ optional `CLOUDFLARE_ZONE_ID`) | DNS automation |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` | domain attach |
| `ROOT_DOMAIN` / `CONSOLE_HOST` | defaults: `luminary-dev.xyz` / `console.…` |

Missing DNS tokens degrade gracefully: everything still generates, and the
client record shows the manual CNAME to add.

## Develop

```bash
npm install && vercel env pull && npm run dev
```
