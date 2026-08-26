# Security findings — Luminary Console (2026-08-26)

Audited against the section-5 checklist. Findings are detailed in
`FINDINGS.md`; this is the security-specific view, plus the checklist status.

Internal tools are usually the softest target in a company because everyone
assumes they are safe behind a login. This one is behind a real login, but the
session it issues can outlive "sign out", it ships no CSP, and it hashes secrets
with a fast hash.

## Highest-priority security findings

| ID | Severity | Summary |
| --- | --- | --- |
| LC-010 | High | "Sign out" only clears the cookie; the token stays valid (up to the idle window, indefinitely if reused). Validity does not require the sid to exist in the registry. |
| LC-012 | High | No Content-Security-Policy on any HTML; no COOP/CORP; HSTS without preload. |
| LC-011 | Medium | Passwords and OTP codes hashed with a single SHA-256, not a slow KDF; the OTP hash is brute-forceable offline over 10^6. |
| LC-013 | Medium | Rate limiting is per-instance in-memory; effective ceiling is limit × instances and resets on cold start. |
| LC-016 | Medium | Operator-uploaded design HTML is served inline on the client subdomain with no sanitization. |
| LC-017 | Medium | No tested log-redaction layer; errors/provider objects logged verbatim. |
| LC-014 | Low | No CSRF token or origin check on cookie-authed mutations (SameSite=Lax + host-scoped cookie keep the practical risk low). |
| LC-015 | Low | OTP attempt counter is a non-atomic read-modify-write; parallel guesses can outrun the lockout. |

## Section-5 checklist status

| Item | Status | Notes |
| --- | --- | --- |
| Strict CSP with per-request nonces, no unsafe-inline/eval | **Absent** | LC-012. Only the asset route sets a CSP. |
| HSTS with preload | **Partial** | `max-age=63072000; includeSubDomains` set, no `preload`. |
| X-Content-Type-Options / Referrer-Policy / Permissions-Policy | **Present** | `proxy.ts:34-41`. |
| COOP / CORP / frame-ancestors | **Absent** | X-Frame-Options DENY is set; no COOP/CORP, no CSP frame-ancestors. |
| Webhook HMAC verification over the raw body, timing-safe, replay + dedup | **N/A yet** | No webhooks exist (LC-060). Must be built to spec in Phase 4. |
| Secret handling (no secrets in repo/bundle/logs; envelope-encrypt third-party tokens) | **Partial** | Secrets are in env, not the repo. No envelope encryption of stored tokens; logs are not redacted (LC-017). |
| SSRF-hardened fetch client (DNS-resolve, block private/link-local/metadata, no redirect to new host, size cap) | **Absent** | No such client. Current outbound fetches target fixed vendor hosts and operator-supplied `org/name` (GitHub tarball), so exposure is low today; required before any user/webhook-supplied URL fetch. |
| XSS: sanitize untrusted markdown, allowlist, no raw dangerouslySetInnerHTML | **Partial** | React auto-escapes client text; email HTML uses `esc()`. No `dangerouslySetInnerHTML` on untrusted content. But design-preview HTML is served raw (LC-016), and no CSP backstop (LC-012). |
| Injection: parameterized queries, lint rule | **N/A** | No SQL/database yet (LC-062). |
| CSRF: origin check + token | **Absent** | LC-014. |
| Rate limiting per-user/per-IP/per-endpoint, shared store | **Partial** | Per-IP/per-endpoint exists but per-instance in-memory (LC-013); no per-user bucket. |
| Gitleaks + push protection, pnpm/npm audit, Renovate, Trivy, SBOM, Cosign, SLSA | **Absent** | LC-057. One high-severity transitive advisory unpatched. |
| Static analysis: CodeQL, Semgrep, ESLint security, no-unsanitized | **Absent** | No ESLint config at all (LC-053). |
| Log hygiene / tested redaction | **Absent** | LC-017. |
| GitHub App least privilege + documented permissions + write-confirmation | **N/A yet** | No GitHub App (LC-060). The existing landing-repo PAT and deploy tokens are broad; document and scope in Phase 4. |
| SECURITY.md + internal disclosure path | **Absent** | To write (section 14). |

## What is done well

- The cron bearer check is constant-time (`timingSafeEqual`,
  `app/api/cron/backup/route.ts:29-33`) and is the route's only guard by design.
- The asset route is correctly scoped to the four asset subtrees and refuses
  path traversal, and forces `attachment` + `default-src 'none'; sandbox` for
  anything not plainly inert (`app/api/asset/[...key]/route.ts`).
- Presigned uploads bind content-type *and* content-length into the signature,
  so the 15MB cap and type allowlist survive leaving the server
  (`lib/store.ts:206-222`).
- Attachment refs are re-validated against the client's own prefix on submit
  (`lib/attachments.ts:40-45`); absolute URLs are refused.
- Login uses one generic "wrong email or password" message with an 800ms delay,
  avoiding account enumeration (`app/api/auth/route.ts:82-86`).
- Every public portal action has a honeypot, a rate-limit bucket checked before
  the store read, and length caps.
- The unauthenticated redirect and 401 now go through `harden()` (a Wave 6 fix),
  so the console host's most-requested response carries the security headers.
