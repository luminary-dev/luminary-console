# Security

This is an internal tool for three people, which is exactly the profile that
gets treated as safe because it is behind a login. It is not exempt.

## Reporting something

There is no external disclosure process because there is no external surface
worth one: the console is not advertised, has no public sign-up, and the only
publicly reachable endpoints are the client portals and the GitHub webhook.

If you find something:

1. **Do not open a GitHub issue.** Issues in `luminary-dev` are visible to
   everyone with repository access and are indexed by the console itself.
2. Message the other two operators directly, or email
   `support@luminary-dev.xyz` with `SECURITY` in the subject.
3. Include what you did, what happened, and what you expected. A reproduction
   matters more than a severity rating.
4. If it is live and exploitable, say so in the first line, and suspend the
   GitHub App installation and rotate the affected credential before writing
   anything up. Availability is recoverable; a leaked credential in use is not.

For a client or an outside party reporting something, the same address works.

## What is protected, and how

| Surface | Control |
| --- | --- |
| Console pages and APIs | HMAC session cookie, verified in the proxy, with the session id checked against a server-side allowlist |
| Login | Email plus password plus an emailed code, allowlisted operators only, globally rate limited |
| Client deletion | Re-verifies a password on top of the session, rate limited on the auth bucket |
| Merging a pull request | Requires the head SHA the operator reviewed, so a push landing mid-review cannot be merged unseen |
| GitHub webhook | HMAC-SHA256 over the raw body, timing-safe, with a replay window and delivery dedup |
| Cron endpoints | `CRON_SECRET` bearer, compared with `timingSafeEqual` |
| Client portals | Public by design. Honeypot, per-IP rate limits, length caps, and no operator data on them |
| Uploads | Presigned PUT with content type AND length signed in, so the cap and allowlist survive leaving the server |
| Stored assets | Private bucket. Console links stream through an authed route scoped to four asset subtrees; email links are 7 day presigned URLs |
| Design previews | Sandboxed iframe with an opaque origin, so an uploaded prototype cannot reach the portal's cookies or storage |

## Headers

Set in `proxy.ts` on every response, with the policy chosen per surface
(`lib/csp.ts`):

- **Content-Security-Policy** with a per-request nonce, `strict-dynamic`,
  `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`,
  `form-action 'self'`.
- **HSTS** `max-age=63072000; includeSubDomains; preload`.
- **COOP** `same-origin`, **CORP** `same-origin` (console) or `same-site`
  (client hosts).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Frame-Options: DENY`.

Stored client documents take a relaxed policy that still forbids `eval`,
because they are immutable HTML written before the request and cannot receive
a per-request nonce. The reasoning is in `lib/csp.ts`.

## CSRF

Cookie-authenticated mutations are checked against an Origin and Referer
allowlist in the proxy, after the session gate. Requests with neither header
are allowed, deliberately: a browser always sends one on a cross-site POST, so
"neither" means a server-to-server caller with no ambient cookie, which is how
the GitHub webhook and Vercel Cron reach us. `Origin: null` is refused
outright, because the sandboxed design previews have an opaque origin.

## Secrets

- Never in the repository. Gitleaks runs in CI.
- Never in a client bundle: everything sensitive is read server-side.
- **Never in logs**: `lib/redact.ts` strips tokens, cookies, session tokens,
  provider API keys, AWS and R2 credentials, webhook signatures, presigned URL
  parameters, emails and phone numbers, and `lib/logger.ts` routes every field
  and the message itself through it.
- Rotation procedures: `docs/runbooks/secret-rotation.md`.
- **Not yet done**: third-party tokens are stored as plain environment
  variables rather than envelope encrypted.

## Credential hashing

Operator passwords use scrypt. A legacy single-SHA-256 format is still
accepted so the existing three operators are not locked out, and each can be
migrated independently; see `docs/ACCESS-CONTROL.md`. Sign-in codes are stored
as a keyed HMAC, so a leaked state file is neither brute-forcible nor a list of
who has a code outstanding.

## GitHub App

Least privilege, with every permission justified in `docs/GITHUB-APP.md`,
including a written list of the permissions deliberately NOT requested
(repository administration, org membership writes, secrets, workflow writes).
Every write action confirms in the UI before it runs and is written to the
audit log.

## Dependencies

`npm audit --audit-level=high` and Gitleaks run in CI on every pull request.
Currently 0 vulnerabilities. The supply-chain tooling the mandate asks for and
that is NOT yet in place: Renovate, CycloneDX SBOM, Trivy, Cosign signing and
SLSA provenance. See `docs/DEPENDENCY-MANIFEST.md`.

## Known gaps

Written down because an honest list is more useful than a clean one. Full
detail in `docs/audit/SECURITY-FINDINGS.md`.

- **No SSRF-hardened fetch client.** Every outbound call currently targets a
  fixed vendor host or an operator-supplied `org/name`, so exposure is low.
  This must be built before anything fetches a user or webhook supplied URL.
- **Third-party tokens are not envelope encrypted at rest.**
- **The audit log is append-only by convention, not tamper-evident**, records
  no before and after, and is capped at 500 entries.
- **No WebAuthn step-up** for irreversible actions.
- **Rate limiting is shared only for the auth bucket.** Other buckets remain
  per-instance, so their effective ceiling is limit times instances.
- **No automated ZAP baseline or penetration test.**

## What the console will never do

- Change repository or organisation settings.
- Edit workflow files.
- Read Actions secrets.
- Force-push or delete a branch.
- Email a client without an explicit operator action.
- Delete a client's documents without first emailing the studio a complete
  archive, and it aborts the deletion if that email does not go out.
