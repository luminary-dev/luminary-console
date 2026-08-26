# Runbook: break-glass access

**When**: nobody can sign in to the console.

Read `docs/ACCESS-CONTROL.md` first for the model. The short version: the
entry path is email plus password plus an emailed code, checked against the
`CONSOLE_USERS` allowlist, and the real break-glass credential is **Vercel
deployment access**, which all three operators hold.

That is worth stating plainly: anyone who can deploy can grant themselves
console access. Deployment access is therefore equivalent to console access
and every Vercel account on the team must have two-factor authentication on.

## Diagnose first

| Symptom | Likely cause | Go to |
| --- | --- | --- |
| Login says "Wrong email or password" for a known-good password | `CONSOLE_USERS` malformed or missing | Procedure A |
| Login accepts the password but no code arrives | Mail delivery | Procedure B |
| Code arrives but "Login expired" every time | Store unreachable, or `SESSION_SECRET` changed | Procedure C |
| Everything 500s | Store outage | Procedure C |
| Signed in already and still working, but nobody new can sign in | Store outage, sessions failing open by design | Procedure C |

## Procedure A: repair the allowlist

1. Read the current value: `vercel env pull` or the Vercel dashboard.
2. Check the format. Each entry is `email:salt:sha256hex` (legacy) or
   `email:scrypt$N$r$p$salt$hash` (current), comma separated, no spaces around
   the commas. A single stray quote or newline breaks parsing for everyone,
   and the parser silently drops malformed entries, so a typo looks exactly
   like "wrong password".
3. Generate a replacement credential if needed. In a local checkout with the
   repo's dependencies installed:

   ```
   npx tsx -e "import('./lib/users').then(async m => console.log(await m.encodePassword('the new password')))"
   ```

   Prepend `email:` to what it prints.
4. Update the variable for **all** environments, redeploy, sign in, confirm.

## Procedure B: mail delivery

Sign-in codes go out through Resend from the `no_reply` sender.

1. Check Resend's dashboard for bounces or a suspended account.
2. Check `RESEND_API_KEY` is set and current.
3. Check spam folders. The code email is transactional and plain.
4. If Resend is down and access is urgent: there is no bypass by design. The
   OTP is stored as a keyed HMAC, so it cannot be reversed out of the store
   even with deployment access. The remedy is to fix or switch the provider;
   `SENDER` is an environment variable.

## Procedure C: store outage

The console reads and writes Cloudflare R2 for everything.

1. Check `https://www.cloudflarestatus.com`.
2. Verify the four R2 variables are intact and the token has not been
   rotated or expired.
3. `npm run r2:init` probes the credentials with a throwaway object and
   prints what is wrong. It is safe against the live bucket.

While the store is down: anyone already signed in keeps working, because the
session gate fails open deliberately. Nobody new can sign in, because the OTP
needs the store. That asymmetry is intentional.

## Procedure D: emergency temporary operator

Use only when A through C are exhausted and access is genuinely blocking.

1. Generate a credential for a strong throwaway password (see A.3).
2. Append it to `CONSOLE_USERS` as an additional entry. Do not replace the
   existing entries.
3. Redeploy. Sign in. The sign-in is written to the audit log like any other.
4. Fix the underlying cause.
5. **Remove the temporary entry and redeploy.** Removing it from
   `CONSOLE_USERS` also invalidates its live sessions, because the session
   allowlist checks that the session's email is still an allowlisted operator.
6. Note what happened in the team channel with the timestamp.

This is single-use by construction: the entry only exists between two
deployments, both of which are visible in the deployment history, and the
sign-in it enables is audited. There is no standing emergency credential to
leak.

## Rehearsal

This procedure has NOT been rehearsed end to end on production. Rehearsing it
means deliberately adding and removing an operator entry, which is safe and
takes about ten minutes. Do it once so the first real use is not the first
use. Record the date here when done.

Last rehearsed: never.
