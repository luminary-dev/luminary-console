# Runbook: secret rotation

Rotate on a schedule, and immediately on any suspicion of exposure. Every
secret below lives in the Vercel environment (all three targets) and in
`.env.local` for local work. Nothing is in the repository, and Gitleaks runs
in CI to keep it that way.

## Order of operations matters

For a secret WE present to someone else (an API key), update the provider
first or accept a gap. For a secret SOMEONE ELSE presents to us (the webhook
secret), update our side first, because deliveries signed with the old secret
are rejected and retried, whereas deliveries we cannot verify are dropped.

## GitHub App private key

Zero downtime, because GitHub allows two keys at once.

1. Generate a second private key in the App settings.
2. Update `GITHUB_APP_PRIVATE_KEY`, redeploy.
3. Confirm reads work (the rate limit badge on `/github`, or a reconcile).
4. Delete the old key in the App settings.

Installation tokens need no rotation: they live one hour and are minted on
demand.

## GitHub webhook secret

Not zero downtime: GitHub allows one.

1. Generate: `openssl rand -hex 32`.
2. Update `GITHUB_WEBHOOK_SECRET` and **redeploy first**.
3. Update the secret in the App settings.
4. Deliveries signed with the old secret during the gap are rejected with a
   401 and GitHub retries them.
5. Run a reconcile and confirm drift is zero.

## SESSION_SECRET

Rotating this invalidates every session AND every outstanding OTP, because
OTP codes are stored as an HMAC keyed with it. Everyone signs in again.

1. Generate: `openssl rand -hex 32`.
2. Update, redeploy.
3. Tell the team, or three people will simultaneously think the console is
   broken.

## CONSOLE_USERS passwords

Per operator, one at a time. A half-migrated allowlist is a supported state.

1. `npx tsx -e "import('./lib/users').then(async m => console.log(await m.encodePassword('new password')))"`
2. Replace that operator's `salt:hash` tail, keeping `email:` in front.
3. Redeploy, confirm that operator can sign in, then move to the next.

## R2 credentials

1. Create a new API token in Cloudflare with the same bucket scope.
2. Update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, redeploy.
3. `npm run r2:init` to confirm.
4. Delete the old token.

Presigned URLs already issued (7 day expiry, used in client emails) are signed
with the old credential and will stop working. If that matters, wait out the
week or re-send the affected emails.

## CRON_SECRET

1. Generate, update, redeploy.
2. Vercel Cron picks it up automatically; no action on their side.

## ANTHROPIC_API_KEY, OPENAI_API_KEY, RESEND_API_KEY

Create the new key at the provider, update, redeploy, confirm one operation
works, then revoke the old key. In that order, so there is no window with no
valid key.

## VAPID keys

Rotating these invalidates every push subscription. Every device must
re-enable alerts from the console topbar afterwards. Say so in the team
channel before doing it.

## Third-party tokens at rest

`GH_TOKEN`, `LANDING_REPO_TOKEN`, `CONSOLE_REPO_TOKEN`, `VERCEL_TOKEN` and
`CLOUDFLARE_API_TOKEN` are stored as plain environment variables, not envelope
encrypted. That is a known gap from the audit. Rotate them on the same
schedule as everything else and keep their scopes minimal.

## Rehearsal

Rotation has not been rehearsed on production. Rehearse the GitHub private key
first, since it is the zero-downtime one.

Last rehearsed: never.
