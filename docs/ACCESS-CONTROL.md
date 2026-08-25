# Access control

The console is for three people. That constraint is a feature, and this
document describes the model as it actually is, including where it differs
from the target model in the audit (LC-061) and why.

## Who gets in

**Entry path**: email plus password plus a six-digit code emailed to that
address. Three factors of a kind: something known (password), something
possessed (the mailbox), and an allowlist.

**Allowlist**: `CONSOLE_USERS` holds one entry per operator. Only these
addresses can sign in. There is no registration, no password reset flow, and
no way to add an operator except by changing the environment and redeploying,
which is deliberate for a three-person tool: the deploy IS the audit trail for
an access change.

Two credential formats are supported, checked in this order:

```
email:scrypt$N$r$p$saltB64url$hashB64url     current
email:salt:sha256hex                         legacy, still accepted
```

The legacy format is a single fast SHA-256 and is brute-forceable offline if
`CONSOLE_USERS` ever leaks (audit finding LC-011). Migrate each operator with
`encodePassword()` from `lib/users.ts`; a half-migrated `CONSOLE_USERS` is a
supported state, so migrate one person at a time and confirm a sign-in between
each.

**Default deny**: anything not on the allowlist gets one generic message,
"Wrong email or password", with an 800ms delay, so the login cannot be used to
discover which addresses exist.

## Sessions

- HMAC-signed cookie (`lum_session`), `HttpOnly`, `Secure`, `SameSite=Lax`,
  scoped to the console host.
- **30 minute idle window**, slid forward on activity, and a **24 hour
  absolute cap** that never moves. Signing in again is required daily.
- The cookie carries `absExp.idleExp.sid.signature`. The `sid` is the session's
  identity in a server-side registry.
- **The registry is an allowlist, not just a denylist** (audit finding
  LC-010). A signature-valid token whose `sid` is not registered, has been
  revoked, is past the absolute cap, or belongs to an email no longer in
  `CONSOLE_USERS`, does not authenticate anything. This is what makes "sign
  out" a real logout rather than a local cookie wipe, and it is what makes
  removing someone from `CONSOLE_USERS` take effect on their live sessions
  (GAP-3.5a).
- **Failure mode**: the proxy caches the allowlist for 60 seconds. If the
  store read fails, it **fails open**, accepting any signature-valid unexpired
  token. An allowlist that failed closed would turn a storage hiccup into
  "every operator is locked out", which is worse than a stolen cookie
  surviving the outage. The token is still signed, still expires, and the
  window is the length of the outage. Signature verification is never skipped.
- A cache miss for a token issued AFTER the snapshot triggers one fresh read,
  so signing in does not mean waiting up to a minute to be let in. A replayed
  old cookie cannot use that path, because the issue time comes out of the
  signed token.

**Device list and revocation**: the dashboard's Sessions card lists every
signed-in device with a per-session Revoke and a Sign out everywhere.
Revocation propagates within about a minute; revoking your own session clears
your cookie and returns you to the login immediately.

## Step-up authentication

One action re-verifies the password on top of the session: **deleting a
client**, which is irreversible. It is also rate limited on the same bucket as
the login, because an 800ms delay is not a guessing defence.

Merging a pull request is not password-gated, but it does require the head SHA
the operator was looking at, so a push landing between page load and click
causes GitHub to refuse the merge rather than shipping unreviewed code. That
is a different kind of guard for a different kind of risk.

WebAuthn as a step-up factor is not implemented. It is a reasonable addition
for a team this size and is recorded as future work rather than done.

## Machine access

- **Cron**: `CRON_SECRET` as a bearer token, compared with `timingSafeEqual`.
  The proxy waves `/api/cron/*` past the session gate, so that check is the
  route's only guard, which is why it is constant-time.
- **GitHub webhooks**: `/api/github/webhook` is public by necessity (GitHub
  cannot hold a session cookie). Its guard is the HMAC signature over the raw
  body, verified before the payload is parsed, stored or logged. It is
  allowlisted as an exact path, not a prefix, so the delivery inbox and the
  processing sweep stay behind the session gate.
- **GitHub API**: a GitHub App installation token, minted on demand, one hour
  lifetime, scoped to the org. See `docs/GITHUB-APP.md`. App credentials never
  touch a user session.
- **Ops via Actions**: `CONSOLE_REPO_TOKEN` lets the console dispatch its own
  workflow so a business mutation can execute on a runner with the run log as
  its receipt.

There is no general-purpose API key system. Nothing external calls this
console except GitHub's webhooks and Vercel Cron, both covered above. Adding
scoped, hashed, prefixed API keys is straightforward when something needs
them, and it is not built speculatively.

## Roles

There is one role. All three operators can do everything.

This is a deliberate reading of the mandate's "do not build a permission
matrix for an org of three". A second role would mean deciding, today, which
of three trusted co-founders is not allowed to do what, and maintaining that
decision in code forever. The audit log is the accountability mechanism
instead: everything is attributable, nothing is prevented.

The one thing that behaves like a privilege boundary is client deletion, which
re-verifies a password, and any operator's password satisfies it.

## Audit log

Every mutating action writes an entry: actor, action, target, optional detail,
and an ISO timestamp. Actor is the signed-in operator's email resolved from
the session registry, or `operator` when it cannot be resolved, or `system`
for cron work.

This covers: sign-ins, client create and delete, document publish, unpublish,
regenerate, delete, billing generation and publication, payments, stage
changes, emails sent, design and site actions, push subscription changes,
session revocations, and every GitHub mutation (approve, merge, close, label,
re-run, and the webhook replay and backfill actions).

Known limits, recorded honestly:

- It is **append-only by convention, not tamper-evident**. Anyone who can
  write to the bucket can rewrite history. Making it genuinely immutable needs
  a different store.
- It records the action, not a **before and after** diff.
- It is **capped at 500 entries**. Older entries are gone, not archived.
- Notification read state is **shared across the team**, not per operator, so
  one person clearing an update clears it for everyone.

## Break glass

If GitHub OAuth were the entry path, losing it would lock everyone out. It is
not: the entry path is email plus password plus a mailbox, which depends on
Resend and the store.

The realistic lockouts and their remedies:

1. **Email delivery is down**, so no codes arrive. Remedy: the OTP is stored
   hashed with a keyed HMAC in the state store. An operator with deployment
   access can read the store, but cannot reverse the HMAC. The practical
   remedy is to fix or switch the mail provider, `SENDER` being an environment
   variable.
2. **`CONSOLE_USERS` is misconfigured** and nobody can authenticate. Remedy:
   fix the environment variable and redeploy. Deployment access is the real
   break-glass credential for this console, and it is held by all three
   operators through Vercel.
3. **The store is unreachable.** Sessions fail open, so anyone already signed
   in keeps working; nobody new can sign in because the OTP needs the store.
   Remedy: restore storage. There is no bypass, on purpose.
4. **Everyone is locked out and the store is fine.** Add a temporary operator
   entry to `CONSOLE_USERS`, redeploy, sign in, fix the cause, remove the
   temporary entry, redeploy. This is single-use by construction, is visible
   in the deployment history, and the sign-in itself is audited.

The break-glass credential is therefore **Vercel deployment access**, and it
should be protected accordingly: all three accounts on the Vercel team need
two-factor authentication enabled, because that access is equivalent to
console access.

## Distance from the target model

The audit records the target access model (LC-061) as GitHub OAuth restricted
to the org, plus a numeric-GitHub-ID allowlist, two roles, and a tamper-evident
audit log with before and after. What exists instead is the model above.

The gap is deliberate for now and small in practice for three people, but it
is a gap. The pieces that would close it, in order of value:

1. Tamper-evident audit entries and before/after capture.
2. GitHub OAuth as the entry path, with the numeric user ID (never the login,
   which can be changed and reused) as the allowlist key. `GITHUB_OPERATORS`
   already maps console emails to GitHub logins for the personal views, which
   is the same information in a weaker form.
3. WebAuthn step-up for irreversible actions.
