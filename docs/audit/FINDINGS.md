# Findings register — Luminary Console

Audit date: 2026-08-26. Tree: `main` @ `524de70` (clean). Every finding cites
`file:line`, states what happens, why it is wrong, how to reproduce, and a
proposed fix. IDs are stable; remediation commits reference them.

A note on scope. The master prompt describes a rebuild toward a GitHub
operations console (webhooks, OAuth-with-allowlist, Postgres, SSE). The app as
it stands today is a **client-document platform**, not that console. Findings
below are about the code that exists. Gaps versus the target architecture
(no GitHub App, no webhook pipeline, no database, email/OTP auth instead of
GitHub OAuth) are recorded as `Info` scope items (LC-060+), not defects, since
they are the section 6 build, not bugs in the current product.

Severity counts: Critical 2, High 9, Medium 21, Low 20, Info 8.

Resolution status as of 2026-08-26, after the remediation effort: of the 45
findings recorded here, 23 are Fixed, 13 are Partially fixed, 9 are Not fixed,
and none were closed as Won't fix or Superseded. Every `Resolution:` line below
was written from the working tree, not from the remediation plan: each one
names the file and mechanism that was checked, and the test that guards it, or
says plainly that no automated test covers it.

Since that pass, LC-051 moved from Not fixed to Fixed, making the tally **24
Fixed, 13 Partially fixed, 8 Not fixed** across the original 45.

A further **24 findings, LC-068 to LC-091, were discovered during the
remediation itself** and are recorded in their own section at the end of this
document. Twenty-three are fixed; one (LC-082) is a deliberate Won't fix with the
trade written down. They are kept separate because the distinction is the
point: they were not visible on a first read of the code. They surfaced from
unit-testing modules that had none, from measuring rendered pages instead of
trusting HTTP status codes, and from running the GitHub layer against the live
API. Two of them are the most serious defects found in the whole exercise:
LC-070, where the pull request inbox silently hid real open work, and LC-071,
where a pull request with more than 100 checks could report as ready to merge
while a check was failing.

The last two, LC-083 and LC-084, were found only because the pull request was
opened and its checks watched: a cron schedule the Hobby plan rejects, which
took every deployment down, and a secret scan that could never pass and was
scanning the wrong tree. Both had passed lint, typecheck, tests and a local
build. They are the argument for watching a change land rather than declaring
it done when the local gates go green.

Whole-document totals: **69 findings, 47 Fixed, 13 Partially fixed, 8 Not
fixed, 1 Won't fix.**

---

## Data integrity and correctness

### LC-001 — A single failed or corrupt index read truncates the client index to one entry
Severity: Critical
Category: Data integrity
Location: `lib/store.ts:250-278` (`getIndex`, `saveClient`, `writeIndex`)
Evidence: `getIndex()` is `(await readCached<IndexEntry[]>(INDEX_KEY)) ?? []`.
`readJson` (`lib/store.ts:113-121`) returns `null` when the stored JSON fails to
parse, and `readCached` caches that `null`. `saveClient` (`263-279`) then does
`const index = await getIndex(); … index.push(entry); await writeIndex(index)`.
So if `index.json` is ever unreadable-as-JSON (a partial write, an encoding
blip, a truncated object) at the moment any client is saved, `getIndex` yields
`[]`, and `saveClient` persists an index containing only the client being saved.
Every other client is dropped from the index.
Impact: The dashboard, `/api/clients`, global search, CSV export, the weekly
backup, and the daily digest all enumerate `getIndex()`. A truncated index makes
every other client invisible across the whole product and silently shrinks the
backup to one record. The underlying `record.json` files survive, so this is
recoverable, but nothing surfaces the loss. This is the "a console that lies"
case from the rubric.
Reproduction: Put one byte of garbage in `console/index.json`, then save any
client (any mutation calls `saveClient`). Re-read `/api/clients`: one entry.
Proposed fix: Distinguish "index is genuinely absent/empty" from "index read
failed". `getIndex` must throw (or return a sentinel) on read/parse failure, and
`saveClient` must refuse to write an index it could not first read intact.
Longer term this is subsumed by moving records+index into Postgres (section 8),
where the index is a query, not a mutable denormalised file.
Resolution: Fixed — `lib/store.ts` now separates "never written" from "there but unreadable": `readSnapshotFresh` throws `StoreReadError` on a parse failure, `assertIndex` rejects anything that is not an array, `getIndex` no longer caches a failed read as `[]`, and `saveClient` and `deleteClient` both read the index fresh before touching anything so a corrupt index aborts the write while the store is still consistent. Guarded by: tests/store.test.ts::"LC-001: throws rather than reporting empty when the index will not parse" and tests/store.test.ts::"LC-001: refuses to write an index it could not read".
Effort: M   Risk of fix: Low   Blocks: LC-002

### LC-002 — No concurrency control on any write; the whole record and whole index are read-modify-written
Severity: High
Category: Data integrity
Location: `lib/store.ts:263-289` (`saveClient`, `deleteClient`), `295-302`
(`nextDocNoBase`); every route that does `getClient` → mutate → `saveClient`.
Evidence: `saveClient` rewrites `record.json` and the entire `index.json` with no
`If-Match`/ETag precondition. `nextDocNoBase` is a read-increment-write on
`counter.json`. R2 gives read-after-write consistency on a key but no
compare-and-swap here. The 5-second per-instance read cache (`lib/store.ts:51`)
hides this within one instance but not across instances.
Impact: Two of the three operators editing the same client (or the same operator
in two tabs, or the ops-via-Actions relay firing while the UI also writes, or a
portal action landing during an operator edit) — last write wins, the other
mutation is lost silently. Two near-simultaneous client creations can be issued
the same `docNoBase` (an accounting hazard the monotonic counter was meant to
prevent). Section 3.6 lists exactly these cases.
Reproduction: Open one client in two tabs, add a task in each within 5s; one task
is lost. Or create two clients concurrently against a cold instance; both can get
the same doc number.
Proposed fix: Conditional writes at every mutation site (R2/S3 `If-Match` on the
object ETag, retry-on-conflict), or move to Postgres with row-level locking /
transactions and a DB sequence for `docNoBase`. Until then, at minimum make
`nextDocNoBase` use a conditional write with retry.
Resolution: Partially fixed — `lib/store.ts` gained `updateJson`, a compare-and-swap with `If-Match` on the read ETag, `If-None-Match: "*"` for a create, fresh re-reads and bounded retries before `StoreConflictError`. The index goes through it via `updateIndex`, and `nextDocNoBase` uses it uncached, so the duplicate doc-number hazard is closed. The client record itself is still last-write-wins: `saveClient` only turns into a CAS when a caller passes `expectedEtag`, and no route does, since `getClientWithEtag` and `expectedEtag` have zero call sites outside `lib/store.ts`. The "two tabs, one task lost" reproduction therefore still holds. Guarded by: tests/store-cas.test.ts::"LC-002: concurrent creations never receive the same doc number" and tests/store-cas.test.ts::"LC-002: an expectedEtag turns the record write into a compare-and-swap".
Effort: L   Risk of fix: Medium   Blocks: —

### LC-003 — `summarizeMoney` is asymmetric and hides overpayment; "settled" can be shown wrongly
Severity: High
Category: Data integrity
Location: `lib/money.ts:47-63` (`summarizeMoney`), used by the dashboard,
BillingCard, the handover pack, CSV export, the digest.
Evidence: `invoiced` sums only published, parsable invoices; `paid` sums *every*
recorded payment regardless of which invoice (or whether any) it is tagged to;
`outstanding = Math.max(0, invoiced - paid)`. A payment recorded before its
invoice is published, or against an invoice whose total does not parse, still
counts toward `paid`, driving `outstanding` to 0.
Impact: The dashboard and client page can report "settled / nothing outstanding"
while money is genuinely owed, and overpayment is invisible. Per the rubric,
money shown wrongly is at least High. The Wave 6 notes flag this as "deliberately
left" — recording it here so the trade-off is an explicit decision, not a default.
Reproduction: Record a payment with no `invoiceSlug` on a client whose invoice is
still a draft. Dashboard shows `paid` increased and `outstanding` 0.
Proposed fix: Decide and document the intended semantics; compute `outstanding`
per-invoice from attributed payments, surface unattributed payments separately
(the handover pack already does this after LC-fix B22), and show overpayment
rather than clamping it away.
Resolution: Fixed — `lib/money.ts` `summarizeMoney` now computes `outstanding` per published invoice from the payments that carry that invoice's slug and sums those, and returns `attributed`, `unattributed`, `overpaid` and a per-invoice `invoices` breakdown instead of clamping two aggregates. `components/BillingCard.tsx:490-499` shows the unattributed and overpaid amounts on screen, and the chosen semantics are recorded in `docs/adr/0001-outstanding-balance-semantics.md`. Guarded by: tests/money.test.ts::"LC-003: an unattributed payment never settles the account > keeps the balance owed when the money names no published invoice" and tests/money.test.ts::"LC-003: overpayment is visible, not clamped > reports the excess instead of hiding it at zero".
Effort: M   Risk of fix: Medium (moves numbers already on screen)   Blocks: —

### LC-004 — AI output crosses the boundary with no schema validation
Severity: Medium
Category: Correctness
Location: `lib/generate.ts:36-43` (`extractJson`), `lib/publish/draft.ts:18-23`;
every `data: unknown` cast in `lib/templates/docs.ts` and `lib/pipeline.ts`.
Evidence: The model's JSON is `JSON.parse`d and then cast (`as QuotationData`,
`as EstimateData`, …) with no runtime validation. Structured outputs make the
shape *likely* but not guaranteed, and stored records from older schema versions
are cast the same way. Section 8 mandates Zod at every boundary.
Impact: A missing or wrong-typed field surfaces as `undefined` deep inside a
renderer (a blank total, a thrown `.map` of undefined) rather than as a caught
validation error near the source. `runStage1` (`lib/pipeline.ts:167-223`) has no
try/catch around the whole, so a bad stage-1 result 500s client creation with a
raw message.
Reproduction: Force the model to omit `items` on a quotation; `renderQuotation`
throws on `d.items.map`.
Proposed fix: Zod schemas for every document data contract and every GitHub
payload once that lands; validate at parse time; on failure, a typed error with a
recovery path, not an undefined three layers down.
Resolution: Partially fixed — Zod landed at the GitHub boundary only. `lib/github/schema.ts` validates every payload the app reads, with loose objects so added fields pass, and a payload that fails goes to the dead letter instead of a handler. The document data contracts are unchanged: `lib/generate.ts:40` and `lib/publish/draft.ts:22` still `JSON.parse` and cast, and `lib/pipeline.ts:260` still casts `EstimateData`, so a quotation missing `items` can still throw inside the renderer. The raw-message half of the impact is closed: `app/api/clients/route.ts:90-100` wraps `runStage1` and answers through `problemResponse`. Guarded by: tests/github-pipeline.test.ts::"malformed and unknown payloads > sends a payload that fails its schema to the dead letter, not to a handler"; no automated test covers the document data contracts.
Effort: M   Risk of fix: Low   Blocks: —

### LC-005 — Route error responses leak internal error strings to the UI
Severity: Low
Category: Security / UX
Location: `app/api/clients/route.ts:85`, `app/api/clients/[slug]/docs/[type]/route.ts:155`,
`.../billing/route.ts:131`, `.../site/route.ts:133`, `.../handover/route.ts:62`.
Evidence: These return `{ error: String(e) }` or `` `Creation failed: ${String(e)}` ``
straight to the client. Error taxonomy and RFC 9457 problem details (section 8)
do not exist.
Impact: Stack-shaped internals (R2 keys, provider messages) reach the browser;
no correlation ID, no consistent shape.
Proposed fix: One typed error taxonomy, a single mapper to a safe
`{ type, title, detail, requestId }` response, internal detail logged not
returned.
Resolution: Fixed — `lib/errors.ts` defines the taxonomy (`AppError` over seven kinds, each with a status, a title and a safe sentence) and one mapper, `toProblem`/`problemResponse`, that returns RFC 9457 problem details as `{ type, title, status, detail, requestId, error }` and logs the real cause under the same `requestId` through the redacting logger. All five cited routes import and call it, and a grep for `error: String(e)` or an interpolated `String(e)` under `app/` now returns nothing. Guarded by: tests/errors.test.ts::"LC-005: the mapper never returns the internal error string > answers an unknown throw with a safe sentence and a requestId" and tests/errors.test.ts::"LC-005: the mapper never returns the internal error string > carries the RFC 9457 fields".
Effort: M   Risk of fix: Low   Blocks: —

---

## Authentication, sessions, access

### LC-010 — "Sign out" does not invalidate the session token; logout only clears the cookie
Severity: High
Category: Security
Location: `app/api/logout/route.ts:4-8`, `proxy.ts:131-146`, `lib/auth.ts:47-60`.
Evidence: The proxy accepts any token that (a) verifies against `SESSION_SECRET`
and (b) whose `sid` is not on the revoked list. `/api/logout` sets the cookie to
empty with `maxAge:0` — it never adds the `sid` to `revoked.json`. The session
registry is display/revocation-only; token validity does not depend on the sid
existing in it (I minted a token with a never-registered `sid` during the
baseline and every authed route accepted it).
Impact: A captured or copied session cookie remains valid after the user clicks
"Sign out" — for up to the sliding idle window, and indefinitely if it keeps
being used within 30-minute windows (each request re-issues a fresh idle
expiry). "Sign out" is not a logout, it is a local cookie wipe. Section 4.2 asks
for server-side session records that revocation actually consults.
Reproduction: Copy the `lum_session` cookie, click Sign out, replay the cookie to
`/api/activity` → 200.
Proposed fix: Make the sid the source of truth: `/api/logout` revokes the caller's
sid; the proxy treats a sid that is absent from the live registry as invalid
(the registry becomes an allowlist, not just a denylist). This pairs with moving
sessions to a server-side store (section 4.2/8).
Resolution: Fixed — `app/api/logout/route.ts` verifies the caller's own token and calls `revokeSessions([session.sid])` before clearing the cookie, reporting a 502 if the revocation did not land rather than pretending the session ended. `lib/sessions.ts` `liveSids()` returns only sids that are registered, unrevoked, inside the absolute cap and still owned by an allowlisted operator, and `proxy.ts:63-72` `sidAllowed` uses that as an allowlist, so a sid that was never registered is refused. The gate deliberately fails open when the store is unreachable, documented at `proxy.ts:23-30`. Guarded by: tests/session.test.ts::"LC-010 sign-out revokes the session > revokes the caller's sid, and the replayed cookie then fails" and tests/session.test.ts::"LC-010 the proxy uses the session registry as an allowlist > rejects a signature-valid token whose sid was never registered".
Effort: M   Risk of fix: Medium (everyone re-logs-in once)   Blocks: —

### LC-011 — Passwords and OTP codes use a single fast SHA-256, not a slow KDF
Severity: Medium
Category: Security
Location: `lib/users.ts:6-9,27-33` (`sha256(salt:password)`), `lib/otp.ts:12-15,27`
(`sha256(email:code)`).
Evidence: Operator passwords are stored in `CONSOLE_USERS` as
`email:salt:sha256(salt:password)` — one round of SHA-256. OTP codes are hashed
`sha256(email:code)` over a 10^6 space; the Wave 6 QA brute-forced a real code
offline from the stored hash in seconds.
Impact: If `CONSOLE_USERS` or the OTP state file leaks, both fall to trivial
offline brute force. A KDF (scrypt/argon2id/bcrypt) is the standard mitigation.
Proposed fix: Hash operator passwords with argon2id/scrypt. For OTP, either rate
the online verify hard (already 5 attempts) and keep the code short-lived (10 min,
already), or store an HMAC with a server key rather than a bare hash so the stored
value is useless without the key.
Resolution: Fixed — `lib/users.ts` now verifies scrypt credentials of the form `scrypt$N$r$p$salt$hash` at N=32768, r=8, with the cost parameters a stored credential may request capped and a constant-time compare, and `encodePassword` mints them. The legacy `salt:sha256` form is still accepted so the three live operators can be cut over one at a time, so the KDF is only in force for entries that have actually been migrated in `CONSOLE_USERS`, which cannot be verified from the tree. `lib/otp.ts` stores an HMAC-SHA256 of the code keyed with `SESSION_SECRET` and derives the record path the same way, so a leaked state file is neither brute-forcible nor a list of which operators have a code outstanding. Guarded by: tests/auth.test.ts::"LC-011 operator passwords > costs real work per guess, unlike the single SHA-256 it replaces" and tests/auth.test.ts::"LC-011 OTP codes are stored as a keyed HMAC > does not store a bare sha256 of email:code".
Effort: M   Risk of fix: Low   Blocks: —

### LC-012 — No Content-Security-Policy on any rendered HTML (console, portal, documents)
Severity: High
Category: Security
Location: `proxy.ts:34-42` (`harden` sets no CSP); `app/layout.tsx:40` (inline
theme script); `lib/templates/shell.ts:191-195` (inline scripts + inline `onclick`
in generated documents); `app/api/asset/[...key]/route.ts:52` is the *only* CSP
in the codebase.
Evidence: `harden()` sets `X-Content-Type-Options`, `Referrer-Policy`, HSTS,
`X-Frame-Options`, `Permissions-Policy` — but no `Content-Security-Policy`.
Nothing sets COOP or CORP. Section 5 mandates strict CSP with per-request nonces,
no `unsafe-inline`/`unsafe-eval`, plus HSTS preload, COOP, CORP, and
frame-ancestors denial.
Impact: No defence-in-depth against injected script. The console renders
client-typed text (names, comments, briefs) and, in the target build, untrusted
GitHub content; a single template mistake becomes script execution with no CSP
backstop. The generated documents and the accept/sign forms rely on inline
scripts, so adopting CSP requires nonces or extraction.
Proposed fix: Add a per-request nonce in the proxy, emit a strict CSP
(`script-src 'nonce-…'`, `object-src 'none'`, `frame-ancestors 'none'`,
`base-uri 'none'`), move the layout theme script and template scripts to
nonce'd/external form, add COOP/CORP and HSTS `preload`.
Resolution: Fixed — `lib/csp.ts` emits a strict console policy (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`) and `securityHeaders` adds `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` and HSTS with `preload`. `proxy.ts` mints a fresh 128-bit nonce per request and sets it on both the request and the response so Next stamps its own tags and `app/layout.tsx:44` can nonce the pre-paint theme script. The stored client documents keep `'unsafe-inline'` for script under a separate "document" policy, an explicit decision recorded at `lib/csp.ts:12-28` because immutable stored HTML cannot receive a per-request nonce; that surface still buys back no eval, no plugins, no base-uri hijack and a fixed form-action. Guarded by: tests/csp.test.ts::"LC-012 harden() emits a strict console policy > carries the request nonce, strict-dynamic and the object/base/frame lockdown" and tests/csp.test.ts::"LC-012 harden() emits a strict console policy > sets COOP, CORP, HSTS with preload and the rest of the hardening".
Effort: L   Risk of fix: Medium (inline scripts must be reworked)   Blocks: —

### LC-013 — Rate limiting is per-instance in-memory, so the real ceiling is limit × instances
Severity: Medium
Category: Security
Location: `lib/ratelimit.ts:14-16,48-74` (module-scope `Map`).
Evidence: Counters live in a per-function-instance `Map`; the file documents this.
On serverless, concurrent instances each hold their own window and a cold start
resets counts. Auth is 10/10min/IP *per instance*.
Impact: An attacker sees `10 × instances` on the auth bucket, resetting on scale
events — weak protection on the login and on anything that fans out to a paid API.
Section 5 wants per-user/per-IP/per-endpoint limits in a shared store.
Proposed fix: Back the limiter with Redis (section 8 already plans Redis) so the
window is global; keep the same call sites.
Resolution: Partially fixed — `lib/ratelimit.ts` added `rateLimitShared`, which counts in a store-backed global window keyed by a hashed IP, and the two credential endpoints call it: the login at `app/api/auth/route.ts:41` and the client-deletion password re-check at `app/api/clients/[slug]/route.ts:33`. Only the `auth` bucket is shared: the `SHARED` table at `lib/ratelimit.ts:52-59` deliberately leaves submit, upload, accept, comment and assist counting per instance, so their ceiling is still limit times instances. The backing store is R2 compare-and-swap rather than the Redis the fix proposed, and a store failure falls open to the in-memory count. Guarded by: tests/ratelimit.test.ts::"LC-013 the shared window survives an instance restart > keeps counting the auth bucket across a cold start and enforces one global ceiling" and tests/ratelimit.test.ts::"LC-013 only the buckets that need it pay for the store > marks auth as shared and the per-IP web-form buckets as in-memory".
Effort: M   Risk of fix: Low   Blocks: —

### LC-014 — No CSRF token or origin check on cookie-authenticated mutations
Severity: Low
Category: Security
Location: every `POST/PATCH/DELETE` under `app/api/clients/**`, `app/api/sessions`,
`app/api/push`, `app/api/activity/read`.
Evidence: Mutations are authorised solely by the `SameSite=Lax` session cookie.
There is no CSRF token and no `Origin`/`Referer` check. Cookies are host-scoped
(no `Domain` attribute), and `SameSite=Lax` blocks cross-site POST, so the
practical risk today is low — but the control the spec asks for (section 5:
origin check plus token) is absent.
Impact: Low now; becomes relevant if a cookie is ever broadened to a parent
domain or a same-site subdomain is compromised.
Proposed fix: Add an `Origin` allowlist check on all cookie-authed mutating
routes and a double-submit CSRF token.
Resolution: Partially fixed — `lib/csrf.ts` implements the Origin allowlist (the request's own host, the console host, the apex, any client subdomain, localhost in dev only) with a Referer fallback and an outright refusal of the opaque `null` origin, and `proxy.ts:260-274` runs it on every mutating request that got past the session gate, which is exactly the set that carries the ambient cookie. The double-submit token was deliberately not built, with the reasoning recorded at `lib/csrf.ts:9-13`, so half the control the finding asked for is still absent. Guarded by: tests/csrf.test.ts::"LC-014 the proxy refuses cross-origin cookie-authed mutations > refuses a cross-origin POST that carries the session cookie" and tests/csrf.test.ts::"LC-014 the origin allowlist itself > refuses another site, a lookalike suffix and plain http in production".
Effort: S   Risk of fix: Low   Blocks: —

### LC-015 — OTP attempt counter has no locking; parallel guesses can outrun the lockout
Severity: Low
Category: Security
Location: `lib/otp.ts:34-45` (`verifyOtp` read-modify-write of `attempts`).
Evidence: Each `verifyOtp` reads the record, compares, increments `attempts`,
writes back — no atomicity. Concurrent requests read the same `attempts` and each
gets its own guess before any write lands.
Impact: The 5-attempt lockout can be exceeded by firing guesses in parallel,
widening the effective guess budget on a 10^6 code.
Proposed fix: Atomic increment (Redis `INCR`, or a conditional write with retry),
or move OTP state to the same store that gets compare-and-swap in LC-002.
Resolution: Fixed — `lib/otp.ts:99-107` takes a lease before any guess is evaluated: it writes `{token, at}` to a lock object, reads it back, and only proceeds if the token that comes back is its own. A caller that loses returns "wrong" without testing its code at all, so parallel guesses are refused rather than each consuming a free attempt, and the read-compare-increment-write of `attempts` happens inside the lease. The lease ages out after 10s so a crashed request cannot wedge the login, and issuing a fresh code clears it. Guarded by: tests/auth.test.ts::"LC-015 parallel OTP guesses cannot outrun the lockout > never lets a parallel loser test its guess" and tests/auth.test.ts::"LC-015 parallel OTP guesses cannot outrun the lockout > increments the counter at most once per round of concurrent guesses".
Effort: S   Risk of fix: Low   Blocks: —

### LC-016 — Operator-uploaded design HTML is served inline on the client subdomain with no sanitization
Severity: Medium
Category: Security
Location: `app/api/clients/[slug]/designs/route.ts:22-31,51`,
`app/c/[slug]/design/[id]/route.ts:39-41`.
Evidence: A design preview is an arbitrary uploaded HTML file (only checked for a
size cap and that it *looks* like HTML), stored and then served with
`Content-Type: text/html` directly at `<slug>.luminary-dev.xyz/design/<id>` once
published. No sanitizer runs.
Impact: Whatever script the file contains runs on the client subdomain origin,
which also holds the portal visit cookie. The file is operator-supplied
(semi-trusted) and the origin is per-client (isolated from the console origin), so
this is Medium not High — but "we render raw uploaded HTML on a live origin" is
worth an explicit decision.
Proposed fix: Serve design previews from a sandboxed, cookie-less origin (or an
`iframe` with `sandbox`), or add a strict CSP to the response, and treat the file
as untrusted.
Resolution: Fixed — both routes now answer a top-level request with a wrapper page whose `<iframe sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox">` omits `allow-same-origin`, so the uploaded file runs in an opaque origin with no access to the portal visit cookie or to the client subdomain's storage. The raw bytes stay reachable at `?raw=1` for the iframe to load and carry `Content-Security-Policy: sandbox …` themselves, so a direct hit is sandboxed too (`app/c/[slug]/design/[id]/route.ts:56-101` and `app/api/clients/[slug]/designs/[id]/route.ts:26-81`). `proxy.ts:141` routes the console-side GET preview onto the document policy so the wrapper's iframe is not blocked. Isolation was chosen over sanitizing, with the reasoning at `app/c/[slug]/design/[id]/route.ts:7-42`. Guarded by: tests/csrf.test.ts::"LC-014 the origin allowlist itself > refuses the opaque 'null' origin a sandboxed design iframe would send" covers the CSRF consequence of the sandbox; the wrapper routes themselves have no automated test.
Effort: M   Risk of fix: Low   Blocks: —

### LC-017 — No log redaction; errors and provider objects are logged verbatim
Severity: Medium
Category: Security / Observability
Location: throughout — e.g. `lib/email.ts:31,53`, `lib/telegram.ts:57,63`,
`lib/push.ts:95`, every `console.error(e)`.
Evidence: Errors (which can carry tokens, signed URLs, addresses) are logged raw.
There is no tested redaction layer (section 5/11).
Impact: Secrets or PII can land in logs/error reports.
Proposed fix: A redaction wrapper for the logger that strips tokens, cookies,
keys, signatures, and PII; route all logging through it.
Resolution: Partially fixed — the redaction layer exists and is thorough: `lib/redact.ts` covers every secret class (bearer tokens, cookies, Authorization headers, provider keys, presigned URL credentials and signatures, webhook signatures, emails, phone numbers), walks nested structures, unwraps Errors and their cause chains and Headers, and survives cycles; `lib/logger.ts` is the single sink and redacts the message string as well as the fields. The two highest-traffic funnels use it: `lib/errors.ts:134` logs every route failure through it and `proxy.ts:264` logs CSRF refusals through it. Routing all logging through it did not happen: 47 raw `console.error`, `console.warn` and `console.log` calls remain across 27 files, including the exact sites this finding cited at `lib/email.ts:31,53`, `lib/telegram.ts:61,66` and `lib/push.ts:95,105`, all of which still log provider error objects verbatim. Guarded by: tests/redact.test.ts::"LC-017 the logger emits redacted structured JSON > redacts a secret glued into the message itself" and tests/redact.test.ts::"LC-017 it walks nested structures > unwraps an Error, its stack and its cause chain".
Effort: M   Risk of fix: Low   Blocks: —

---

## Robustness, error handling, edge cases

### LC-020 — No error boundaries anywhere; a store outage renders a white error page
Severity: High
Category: Robustness / UX
Location: no `app/**/error.tsx` or `app/global-error.tsx` exist (confirmed by
search); server components call `getIndex`/`getClient` unguarded
(`app/page.tsx:28-31`, `app/clients/[slug]/page.tsx:52`).
Evidence: `getObject` re-throws real (non-404) R2 errors (`lib/store.ts:78`); those
propagate through `getIndex`/`getClient` into the server component with no
try/catch and no error boundary, so Next renders its default error screen.
Impact: A transient R2 blip takes the dashboard and client pages to a blank error
page with no recovery path — the exact "white screen" section 8 calls out. Every
async surface lacks the four designed states (loading/empty/error/offline) of
section 7.3.
Reproduction: Point R2 creds at an unreachable endpoint and load `/`.
Proposed fix: Add `error.tsx` (per segment) and `global-error.tsx` with a real
fallback UI and retry; wrap store reads in the page with typed handling.
Resolution: Fixed — `app/error.tsx`, `app/global-error.tsx` and `app/clients/[slug]/error.tsx` now exist, each rendering a real fallback with a retry that calls `reset()` and a route back to the dashboard. None of them renders `error.message`: only the digest is shown, so R2 keys and provider text cannot reach the browser through the boundary. Guarded by: no automated test.
Effort: M   Risk of fix: Low   Blocks: —

### LC-021 — The 25–30 minute questionnaire keeps answers in memory only; a refresh loses everything
Severity: Medium
Category: UX / Data loss
Location: `components/QuestionnaireForm.tsx:254` (`useState<Answers>({})`).
Evidence: All answers live in React state. There is no draft persistence. A
refresh, a back-navigation, a crashed tab, or a dropped connection loses the
whole form. The form itself tells the client it takes 25–30 minutes.
Impact: A client who is most of the way through and refreshes starts over — the
highest-friction data loss in the product. Section 7.3: "Never lose user input."
Proposed fix: Debounced autosave of answers to `localStorage` keyed by slug,
restored on mount, cleared on successful submit. Guard reads/writes in try/catch
(private mode).
Resolution: Fixed — `components/QuestionnaireForm.tsx:38-90,354-378` autosaves answers to `localStorage` under `luminary-questionnaire-draft:<slug>` on a 500ms debounce, restores on mount behind a keep-or-discard prompt, clears the draft on a successful submit, keys by slug so one client's draft can never be restored into another client's form, and wraps every storage call in try/catch so a throwing `localStorage` leaves the form fully usable. The honeypot field is deliberately excluded from the draft. Guarded by: tests/questionnaire-draft.test.tsx::"LC-021: restores a saved draft after a refresh" and tests/questionnaire-draft.test.tsx::"LC-021: a throwing localStorage leaves the form fully usable".
Effort: S   Risk of fix: Low   Blocks: —

### LC-022 — Debounced searches have no request cancellation; a slow earlier response can overwrite a later one
Severity: Low
Category: Correctness
Location: `components/CommandPalette.tsx:50-61` (`/api/search` fetch, no
`AbortController`); `components/QuestionnaireForm` upload loop similar.
Evidence: The palette debounces at 250ms but does not cancel the in-flight
request; responses can resolve out of order and a stale result can land last.
Impact: The classic race — the palette shows results for an earlier query.
Proposed fix: `AbortController` per keystroke, key results by the query they were
issued for, drop stale responses.
Resolution: Fixed — `components/CommandPalette.tsx:76-86` opens an `AbortController` per debounced query, passes its signal to the `/api/search` fetch and aborts it in the effect cleanup, and the result state carries the query it was issued for (`ContentState { q, hits }`) so a response that resolves after the query moved on is never rendered. Guarded by: tests/a11y.test.tsx::"CommandPalette content search > LC-022: a stale in-flight response cannot overwrite a newer query's results".
Effort: S   Risk of fix: Low   Blocks: —

### LC-023 — Relative timestamps are computed once on the server and never tick
Severity: Low
Category: UX
Location: `lib/time.ts:22-40` (`relTime(at, now)`), rendered server-side with a
fixed `now` on `app/page.tsx`, `.../clients/[slug]/page.tsx`, `ActivityList`.
Evidence: `now` is captured at render; "2m ago" is frozen until the next full
navigation/refresh. A tab left open for hours shows stale relative times.
Impact: Minor but visible; section 3.3 asks for relative times that update live
without re-rendering the world.
Proposed fix: A small client component that re-derives relative time on an
interval from the absolute ISO, without re-rendering rows.
Resolution: Fixed — `components/RelativeTime.tsx` is a small client component that takes the absolute ISO plus the server-rendered label as `initial`, so first paint is byte-identical to the server output, then re-derives the label on an interval that widens as the timestamp ages and stops entirely once the value can no longer change. It is used on the dashboard (`app/page.tsx:187`), the client page, `ActivityList` and `BillingCard`. Guarded by: tests/relative-time.test.ts::"RelativeTime > LC-023: the label keeps updating while the tab stays open" and tests/relative-time.test.ts::"relTickMs > LC-023: ticks fast while recent, slowly when old, and stops once fixed".
Effort: S   Risk of fix: Low   Blocks: —

### LC-024 — Client creation runs the whole pipeline synchronously in the request with no idempotency
Severity: Medium
Category: Robustness
Location: `app/api/clients/route.ts:70-86` (`runStage1`), `maxDuration=300`.
Evidence: One request drives Claude drafting, PDF render (Chromium cold start),
DNS automation, and the studio email inline. There is no idempotency key, so a
retried/relayed POST can create a second client or a duplicate doc number (with
LC-002).
Impact: A slow model or Chromium launch can approach the 300s ceiling; a
double-submit through the ops relay is not de-duplicated.
Proposed fix: Move drafting/rendering to the worker/queue (section 8), respond
fast with a pending record, and key creation by an idempotency token.
Resolution: Not fixed — `app/api/clients/route.ts` still calls `runStage1` inline with `maxDuration = 300` still set at line 8, so drafting, PDF render, DNS automation and the studio email all remain in the request. There is no queue, no pending record and no idempotency key on the POST. The only de-duplication is the pre-existing slug-uniqueness 409 at line 55, which is itself an unconditional read-then-write and races the same way LC-002 describes. What did change is the failure surface, which now answers a safe problem body instead of a raw string (see LC-005). Guarded by: no automated test.
Effort: L   Risk of fix: Medium   Blocks: —

### LC-025 — Unpublishing the final receipt does not clear `deliveredAt`, so the warranty clock keeps running
Severity: Low
Category: Correctness
Location: `app/api/clients/[slug]/billing/route.ts:77-88` (unpublish path),
`lib/stage.ts:55-66` (`currentStage` drifts off `deliveredAt`).
Evidence: Publishing a final receipt stamps `deliveredAt` and advances to
`delivered`; unpublishing it does not reverse the stamp. `currentStage` then keeps
drifting delivered→warranty→closed off the stale timestamp.
Impact: An accidental publish/unpublish leaves a spurious delivery date and a live
warranty commitment. Documented as "deliberately left" in Wave 6; recorded so it
is tracked.
Proposed fix: On unpublish of the final receipt, if nothing else establishes
delivery, clear `deliveredAt`.
Resolution: Fixed — `lib/stage.ts:102-117` adds `revertDelivery`, which deletes `deliveredAt` and walks the stage back through `inferStage` when no other published final receipt still establishes delivery, and leaves a deliberately closed client closed since "closed" is also how an unwon lead is retired. `app/api/clients/[slug]/billing/route.ts:89` calls it on the unpublish path, after the receipt's status has been set back to draft so the evidence check sees the new state. Guarded by: tests/stage.test.ts::"LC-025: unpublishing the final receipt clears the delivery stamp > stops the stage drifting to closed off the stale timestamp" and tests/stage.test.ts::"LC-025: unpublishing the final receipt clears the delivery stamp > keeps the stamp while another published final receipt still stands".
Effort: S   Risk of fix: Low   Blocks: —

---

## Performance and scalability

### LC-030 — Every list surface is O(N) over all client records with no pagination or virtualization
Severity: Medium
Category: Performance / Scalability
Location: `app/page.tsx:31` (`Promise.all(index.map(getClient))`),
`app/api/search/route.ts:46-56`, `app/api/clients/export/route.ts:21-40`,
`app/api/cron/backup/route.ts:109-114`, `app/api/cron/digest/route.ts:94-98`.
Evidence: The dashboard fetches every full record on every load; search, CSV,
backup, and digest each linear-scan all records. `ClientTable` renders all rows
unvirtualized. Fine at one client; unbounded as the org grows.
Impact: At the section-10 target (lists that can exceed 100/1,000 rows) this is N
object reads per dashboard load and no virtualization — well outside the budgets.
Proposed fix: Paginate/stream the index, virtualize tables above ~100 rows, and
push aggregates (counts, outstanding) into the query layer rather than computing
them by reading every record.
Resolution: Partially fixed — the virtualization half landed. `components/VirtualList.tsx` windows any list over 100 rows while reporting the full count to assistive technology, and `components/ClientTable.tsx:85,219` uses it with sorting, filtering, `aria-sort` and arrow/Home/End navigation all still working across the window boundary. The fan-out is now bounded rather than unbounded: `lib/store.ts:312-351` adds `mapLimit` and `getClients` at a concurrency of 8, and the dashboard, search, CSV export, backup and digest all read through them instead of `Promise.all` over the index. Pagination did not land: `app/page.tsx:39` still reads every client record on every dashboard load, `app/api/clients/export/route.ts:24` and `app/api/cron/backup/route.ts:111` still read the whole set, and counts and outstanding totals are still computed by walking every record rather than coming from a query layer. Guarded by: tests/virtual-list.test.tsx::"LC-030: a 1,000-row list renders only a window but reports the whole list to assistive tech" and tests/virtual-list.test.tsx::"LC-033: getClients bounds the fan-out instead of opening one read per client".
Effort: L   Risk of fix: Medium   Blocks: —

### LC-031 — The proxy fetches the revocation list from R2 on the cold path, adding ~850ms to the first request per minute per instance
Severity: Medium
Category: Performance
Location: `proxy.ts:20-31` (`sidRevoked` → lazy `import("@/lib/sessions")` → R2),
observed dashboard `proxy.ts: 855ms` in the baseline.
Evidence: The revoked-sid cache refreshes every 60s by reading `revoked.json`
through the S3 SDK; the refresh happens inline on a user request.
Impact: Once a minute per instance, a real user pays a full R2 round trip (plus
SDK load) inside the proxy before their page renders.
Proposed fix: Move revocation to Redis (section 8) with a cheap read, or refresh
the cache off the request path; longer term the session store makes this a fast
lookup.
Resolution: Not fixed — `proxy.ts:63-72` still `await`s `loadGate()` inline on a user request when the 60s cache has expired, and `loadGate` still lazily imports `@/lib/sessions`, which reaches the S3 SDK and reads the store. The read moved from `revoked.json` to the session registry as part of LC-010, but it did not move off the request path and it did not move to Redis, so the once-a-minute-per-instance round trip the finding measured is unchanged. The one improvement is that concurrent misses now share a single in-flight read instead of each firing their own (`proxy.ts:48-61`). Guarded by: no automated test measures the latency; tests/session.test.ts::"LC-010 the proxy uses the session registry as an allowlist > does not re-read the registry for an old sid that is simply gone" only asserts that the cache is not re-read needlessly.
Effort: M   Risk of fix: Low   Blocks: —

### LC-032 — Each document render launches a fresh headless Chromium; stage-2 launches three sequentially
Severity: Medium
Category: Performance
Location: `lib/pdf.ts:126-217` (launch per `renderPdf`), `lib/pipeline.ts:273-275`
(three `saveDoc` calls in series).
Evidence: `renderPdf` does `puppeteer.launch(...)` and `browser.close()` per call.
Stage-2 renders quotation, proposal, and contract as three separate launches.
Impact: Cold-start Chromium per document dominates client-create and re-draft
latency; on serverless this is seconds each.
Proposed fix: Reuse one browser across a batch (launch once, new page per doc), or
move rendering to a dedicated worker with a warm browser pool.
Resolution: Fixed — `lib/pdf.ts:146-269` keeps one Chromium at module scope and reuses it for every render the instance performs, with an in-flight launch guard so two concurrent renders cannot start two browsers, a `connected` liveness check plus a one-shot relaunch for a handle that died while the instance was frozen, error classification so a render that failed on its own merits does not trigger a relaunch, and an idle timer that closes the browser. The three sequential `saveDoc` calls in stage 2 at `lib/pipeline.ts:272-274` now share that warm browser instead of launching three. Guarded by: tests/pdf-batch.test.ts::"LC-032: renders a batch through one browser rather than one per document" and tests/pdf-batch.test.ts::"LC-032: separate renderPdf calls reuse the warm browser".
Effort: M   Risk of fix: Low   Blocks: —

### LC-033 — `fetchAsset` buffers whole objects into memory
Severity: Low
Category: Performance
Location: `lib/store.ts:179-188` (`transformToByteArray`), used for every emailed
PDF and the `retry-stage2`/assist answer reads.
Evidence: `fetchAsset` reads the full object into a `Buffer`. The email paths
buffer every attached PDF at once (`app/api/clients/[slug]/route.ts:62-70`,
`.../send/route.ts:83-96`).
Impact: A 15MB attachment or a batch of PDFs sits fully in memory; bounded today
but wasteful.
Proposed fix: Stream where the consumer allows; cap concurrency on batch reads.
Resolution: Fixed — `lib/store.ts:399-413` `fetchAsset` now returns the R2 body as a web stream rather than a `Buffer`, so the console preview and portal document routes, which hand the response straight back out, never hold the object in this process's heap. The two email paths that genuinely need bytes still call `.arrayBuffer()`, but they now do so through a capped worker pool rather than all at once: `mapLimit(files, 4, …)` at `app/api/clients/[slug]/route.ts:67` and `app/api/clients/[slug]/send/route.ts:86`. Guarded by: tests/virtual-list.test.tsx::"store batch reads > LC-033: mapLimit never runs more than `limit` at once and keeps input order".
Effort: S   Risk of fix: Low   Blocks: —

---

## Accessibility (WCAG 2.2 AA is the floor per section 7.5)

### LC-040 — Table header text fails AA contrast in both themes
Severity: Medium
Category: Accessibility
Location: `app/globals.css:110` (`th { color: var(--subtle) }`), `.k`
(`app/globals.css:68`), `.meta-k`; Lighthouse flagged `color-contrast` on the
dashboard `<th>` cells.
Evidence: `--subtle` is `#c4c4c8` on `#ffffff` (~1.9:1) in light and `#3f3f46` on
`#0b0b0d` in dark — both below the 4.5:1 (or 3:1 for large) AA thresholds for the
small uppercase header text.
Impact: Column headers, key labels, and meta labels are hard to read; Lighthouse
accessibility is 96, not the required 100.
Proposed fix: Use a token that meets AA for small text (the design-language doc's
adaptation rule 6.2 already raises muted contrast); reserve `--subtle` for borders
and dots, not text.
Resolution: Fixed — `app/globals.css` adds a `--label` token (`#545965` in light, `#9a9aa3` in dark) and moves the small mono text onto it: `table.list th` at line 171 and `.k` at line 119 both use `var(--label)`. The file header at lines 2-7 now documents `--subtle` as a border and dot token only and records the measured ratios for both tokens, and `--subtle` no longer appears as a text colour anywhere in the stylesheet. Guarded by: no automated test; the contrast ratios are asserted only in the stylesheet's own comment, and no axe or Lighthouse run exists in CI.
Effort: S   Risk of fix: Low   Blocks: —

### LC-041 — Sortable column headers are click-only, not keyboard operable
Severity: Medium
Category: Accessibility
Location: `components/ClientTable.tsx:105-110` (`<th onClick=…>` with no role,
tabindex, or button).
Evidence: Sorting is a bare `onClick` on a `<th>`; there is no keyboard affordance,
no `aria-sort`, no focusability.
Impact: Keyboard and screen-reader users cannot sort. Section 7.5 requires full
keyboard operability including tables, and `aria-sort`.
Proposed fix: Put a real `<button>` inside the `<th>`, set `aria-sort`, keep the
visible arrow.
Resolution: Fixed — `components/ClientTable.tsx:125-128` puts a real `<button type="button" className="th-sort">` inside each sortable `<th>` and sets `aria-sort` on the header itself, so the control is focusable, operable by Enter and Space, and announces its direction. The visible arrow is kept and `app/globals.css:182` styles the active header. Guarded by: tests/a11y.test.tsx::"ClientTable sorting > LC-041: the sort control is reachable and operable by keyboard and exposes aria-sort" and tests/virtual-list.test.tsx::"LC-030/LC-041: sorting a virtualized list still works and still announces aria-sort".
Effort: S   Risk of fix: Low   Blocks: —

### LC-042 — No skip link and no defined focus-visible styles in the console
Severity: Medium
Category: Accessibility
Location: `app/globals.css` (no `.skip-link`, no `:focus-visible` rules — the
landing page has both at `luminary-landing-page/app/globals.css:207-232`).
Evidence: The console inherits none of the landing page's focus-ring or skip-link
CSS; focus rings fall back to the browser default (often invisible on the accent
buttons), and there is no skip-to-content.
Impact: Keyboard navigation has weak/again-invisible focus and no way past the
repeated topbar. Section 7.5 requires visible focus meeting contrast and skip
links.
Proposed fix: Port the landing page's `:focus-visible` accent ring and `.skip-link`
into the console tokens; add a skip link to each page shell.
Resolution: Fixed — `components/SkipLink.tsx` exports both the link and the shared `MAIN_ID` that every page targets, and `app/layout.tsx:50` renders it first in the body. `app/globals.css:38-51` adds the accent `:focus-visible` ring (2px, 3px offset) across links, buttons, inputs, selects, textareas, summaries and anything with a tabindex, with a tighter offset for the bordered questionnaire inputs, and lines 56-64 add the off-canvas `.skip-link` styling with a reduced-motion guard. Guarded by: tests/a11y.test.tsx::"SkipLink > LC-042: renders a link that points at the page's main content".
Effort: S   Risk of fix: Low   Blocks: —

### LC-043 — Real-time/async updates have no live-region announcements; several inputs lack programmatic labels
Severity: Low
Category: Accessibility
Location: e.g. `components/BillingCard` status changes, `NotesCard` save-state,
toast-like inline messages; `select`/`input` without `<label htmlFor>` in several
cards (labels are adjacent `<span>`s, not associated).
Evidence: Status/answer/save messages are plain text nodes with no `aria-live`;
some form controls use `.q-label` spans not tied by `htmlFor`/`id` or wrapping.
Impact: Screen-reader users are not told when a save succeeds/fails or an answer
arrives; some fields announce no name. Section 7.5 wants live regions and labelled
fields tied by `aria-describedby`.
Proposed fix: Add `aria-live="polite"` regions for async status; associate every
control with its label; run axe in tests (section 12) as the merge gate.
Resolution: Partially fixed — polite live regions were added where lists change: `components/ClientTable.tsx:177` announces the row count, `components/CommandPalette.tsx:181` announces results, `components/QuestionnaireForm.tsx:217,579` announces progress and send state, and every GitHub view carries one. The palette became a combobox owning a listbox with `aria-activedescendant` moving across both result groups, and `ConfirmDialog` now traps focus and returns it to the trigger. The specific cases the finding cited are still open: the BillingCard error at `components/BillingCard.tsx:513` is a plain `<div className="form-error">` with no `aria-live` or `role="alert"`, the NotesCard save state at `components/NotesCard.tsx:63` is a plain `<span>`, the BillingCard textareas at lines 246 and 413 are labelled by placeholder only, and no axe run exists in the test suite or in `.github/workflows/ci.yml`. Guarded by: tests/a11y.test.tsx::"ClientTable sorting > LC-043: the row count is announced in a live region" and tests/a11y.test.tsx::"ConfirmDialog > LC-043: traps focus inside the open dialog and returns it to the trigger on close".
Effort: M   Risk of fix: Low   Blocks: —

---

## Code quality, conventions, tech debt

### LC-050 — Authored emojis in notifications, digests, and PR bodies violate the zero-emoji rule
Severity: Low
Category: Convention
Location: 11 `emoji:` call sites (`app/c/**` portal actions, `app/api/clients/**`,
`lib/notify.ts`), the Telegram digest (`app/api/cron/digest/route.ts:124`), and
a robot-emoji "Published via luminary-console" line in PR bodies
(`app/api/publish/article/route.ts:127`, `.../project/route.ts:127`).
Evidence: Emojis are authored in source and shipped to Telegram/push and into PRs
opened against the landing repo. Section 3.4 and the Definition of Done say zero
authored emojis anywhere (third-party emoji rendered safely is the only
exception).
Impact: Direct violation of a non-negotiable rule; the PR-body emoji lands in the
landing repo's history.
Proposed fix: Remove authored emojis from notice/digest/PR builders; use text
labels or `lucide-react` icons in the UI.
Resolution: Fixed — every `emoji:` call site is gone, with a grep for `emoji:` across `app/`, `lib/` and `components/` now returning nothing. The Telegram digest builds its header and bullets from text alone, with the rule recorded in place at `app/api/cron/digest/route.ts:126-127`, and both PR bodies now read a plain "Published via luminary-console." (`app/api/publish/article/route.ts:131`, `app/api/publish/project/route.ts:127`). A handful of `U+2713` check-mark glyphs survive in UI copy, most of them `aria-hidden`; they are dingbats rather than emoji, but nothing enforces the boundary. Guarded by: no automated test and no lint rule enforces the zero-emoji rule.
Effort: S   Risk of fix: Low   Blocks: —

### LC-051 — Em dashes and en dashes pervade user-facing UI copy
Severity: Low
Category: Convention
Location: ~78 files/lines under `components/` and `app/` contain `—`/`–` in
user-facing strings (e.g. BillingCard help text, card intros, placeholders).
Evidence: The AI prompt forbids em/en dashes in generated documents, but the
hand-written UI copy uses them throughout. Section 3.5 forbids em dashes in
user-facing copy; the Definition of Done extends "no em dashes".
Impact: Consistent violation of the house style the documents themselves follow.
Proposed fix: Replace with commas/colons/full stops in user-facing strings; a lint
rule to keep them out.
Resolution: Fixed — 192 em dashes were removed from user-facing copy across 55 files under `app/`, `components/`, `lib/templates/` and `lib/publish/`, rewritten per sentence rather than substituted mechanically: colons where the second half explains, full stops between independent clauses, commas for parenthetical asides, and a middle dot for title and subject separators. Two categories were deliberately left. Em dashes inside comments are not user-facing, and 20 standalone `"—"` glyphs are empty-value markers in table cells, meaning "no value" rather than punctuation; replacing those with a comma would have been a regression, not a fix. A `no-restricted-syntax` rule in `eslint.config.mjs`, scoped to `app/**` and `components/**`, now flags an em dash in a string literal, a template literal or JSX text, with a `:not(...)` clause exempting the placeholder glyph. Guarded by: the lint rule itself, verified non-vacuous against a temporary probe component that produced errors for all three node types while correctly ignoring both placeholder forms.
Effort: M   Risk of fix: Low   Blocks: —

### LC-052 — No automated test suite; the only tests hit real paid/production backends
Severity: High
Category: Testing / Process
Location: `package.json:11-16` (five `test:*` scripts run `tsx` against live
backends), no Vitest/Jest/Playwright, no coverage tooling.
Evidence: `suite-notify` fires ~13 real push notices; `suite-client`/`-article`/
`-project` spend real Claude/OpenAI budget and open real PRs. Only `suite-ops` is
zero-cost. There is no unit, component, integration, contract, e2e, a11y, or
visual test layer and no coverage gate.
Impact: Every change is unverified except by build+typecheck; regressions are
caught by manual QA. Section 12 requires 80% overall / 95% on auth, webhook
verification and event handling, plus contract and e2e coverage.
Proposed fix: Stand up Vitest + Testing Library + Playwright + Testcontainers +
MSW; make the existing live suites opt-in; add coverage gates in CI.
Resolution: Partially fixed — a real suite now exists and passes: Vitest 4 with Testing Library and jsdom, 27 files and 371 tests green, configured in `vitest.config.mts`, with v8 coverage reported and uploaded by CI. The live-fire suites were made opt-in and renamed behind `npm run test:live:*`, so `npm test` costs nothing and fires no notifications. The section-12 bar is not met: there is no Playwright, no Testcontainers, no MSW, and no contract, e2e, a11y or visual layer. The coverage gate is 60% on lines, functions, branches and statements (`vitest.config.mts:26-31`), not 80% overall with 95% on auth, webhook verification and event handling; coverage is also scoped to `lib/**`, `app/api/**` and `proxy.ts`, so the components and pages are outside it. Guarded by: the suite is its own evidence, and `npm run test:coverage` runs in the `quality` job of `.github/workflows/ci.yml`.
Effort: L   Risk of fix: Low   Blocks: LC-053

### LC-053 — CI is build-only; no lint, typecheck-as-gate, tests, security, a11y, bundle, or Lighthouse
Severity: Medium
Category: DevOps
Location: `.github/workflows/ci.yml:32-33` (only `npm run build`); no ESLint config
in the repo, no `lint` script.
Evidence: The single required check is `next build` (which does typecheck). There
is no ESLint (the mandate's `eslint-plugin-no-unsanitized`, security rules, etc.),
no Semgrep/CodeQL/Trivy, no axe, no Lighthouse CI, no bundle budget — all required
by sections 5, 10, 12, 13.
Impact: The merge gate is thin; whole classes of defect (lint, a11y, perf
regressions, vulnerable deps) never run.
Proposed fix: Build the section-13 pipeline: lint, typecheck, unit/integration/
contract, build, security scans, axe, Playwright, Lighthouse CI, bundle budget.
Resolution: Partially fixed — `.github/workflows/ci.yml` is no longer build-only. It now runs a `quality` job (`npm run lint`, `npm run typecheck`, `npm run test:coverage` with the coverage uploaded as an artifact), then `build`, then a `security` job running `npm audit --audit-level=high` and Gitleaks. A real `eslint.config.mjs` exists and registers `eslint-plugin-no-unsanitized` (both `method` and `property` as errors), `eslint-plugin-jsx-a11y` and `eslint-plugin-react-hooks`. Two gaps remain. First, the pipeline is still missing Semgrep or CodeQL, Trivy, an axe run, Playwright and Lighthouse CI, and there is no bundle budget. Second, and worth acting on: `npm run lint` currently FAILS on this tree, with `tests/github-client.test.ts:14` reporting `'atIndex' is defined but never used` under `@typescript-eslint/no-unused-vars`, so the lint step as committed would red the merge gate. Guarded by: no automated test; the workflow is its own evidence.
Effort: L   Risk of fix: Low   Blocks: —

### LC-054 — No observability: no structured logs, request correlation, tracing, metrics, or error tracking
Severity: Medium
Category: Observability
Location: entire codebase uses `console.log/warn/error`; no logger, no
OpenTelemetry, no Sentry, no metrics (sections 8, 11).
Evidence: There is no request ID, no trace context, no RED metrics, no Sentry with
source maps, no committed dashboards.
Impact: "Why was this slow / why did this fail" is unanswerable beyond raw logs;
no alerting.
Proposed fix: Structured JSON logging with correlation IDs (routed through the
LC-017 redaction layer), OpenTelemetry traces, Sentry, and the section-11 metrics.
Resolution: Partially fixed — structured logging and correlation exist: `lib/logger.ts` emits one line of JSON per event with a promoted `requestId`, a `child()` binder for pre-bound fields, and redaction on the message as well as every field, and `lib/errors.ts:126-135` mints a correlation id per failure and logs the cause under it, so "which log lines belong to this failure" is now answerable. Nothing else landed: there is no OpenTelemetry, no Sentry with source maps, no RED metrics and no committed dashboards, and a grep of `package.json` finds neither `@sentry` nor any `opentelemetry` package. `docs/OBSERVABILITY.md` was written but describes intent rather than shipped instrumentation. Guarded by: tests/redact.test.ts::"LC-017 the logger emits redacted structured JSON > writes one JSON line with a timestamp, a level and the message" and tests/errors.test.ts::"LC-005/LC-017: logs the failure under the same requestId, redacted".
Effort: L   Risk of fix: Low   Blocks: —

### LC-055 — Broken one-off scratch scripts are committed at the repo root
Severity: Low
Category: Tech debt
Location: `_gen.mjs`, `_poll.mjs` (tracked; `git ls-files` lists them).
Evidence: `_gen.mjs` references `qData.lineItems` / `q.data.lineItems`, but the
quotation schema uses `items` — the script is stale and would not run correctly.
Both are hard-coded to `eco-mech` and were clearly one-time fixes.
Impact: Dead, misleading code in the root; `_gen.mjs` mutating a real client if
ever run.
Proposed fix: Delete both (they are recoverable from history).
Resolution: Fixed — both files are gone from the repo root and staged as deletions in git; `ls _gen.mjs _poll.mjs` reports no such file for either. Guarded by: no automated test.
Effort: S   Risk of fix: Low   Blocks: —

### LC-056 — TypeScript strictness is below the section-8 target; `any`/unsafe casts remain
Severity: Low
Category: Tech debt
Location: `tsconfig.json` (`strict: true` but no `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, or `verbatimModuleSyntax`); `data: unknown` cast
throughout; `as Parameters<…>[0]` casts in `lib/generate.ts:57`,
`lib/publish/draft.ts:35`; `/* eslint-disable @typescript-eslint/no-explicit-any */`
in `lib/pdf.ts:32`.
Evidence: The stricter flags section 8 requires are off; several deliberate `any`
suppressions exist without a reviewed rationale comment beyond the inline note.
Impact: Indexed access and optional-property bugs are not caught at compile time.
Proposed fix: Turn on the three flags and fix the fallout incrementally behind the
build gate.
Resolution: Fixed — `tsconfig.json` now sets `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` alongside `strict`, and `npx tsc --noEmit` passes clean across the whole tree including the 27 new test files. The fallout was absorbed rather than suppressed: the conditional-spread pattern for writing optional properties is visible throughout `lib/store.ts` and `lib/money.ts`, and the indexed-access guards are visible in `lib/users.ts:71` and `lib/store.ts:339`. One narrow `any` block survives at `lib/pdf.ts:50-144` around the Puppeteer page handle, explicitly bounded by a matching `eslint-enable`. Guarded by: `npm run typecheck` runs in the `quality` job of `.github/workflows/ci.yml`; no unit test covers this.
Effort: M   Risk of fix: Medium   Blocks: —

### LC-057 — Two known-vulnerable/aging dependencies and no supply-chain tooling
Severity: Medium
Category: Dependency / Supply chain
Location: `package.json`; `npm audit` (1 high: `nanoid <3.3.18`, transitive);
`npm outdated` (next 16.3.0→16.3.3, @anthropic-ai/sdk 0.115→0.120, aws-sdk,
resend, puppeteer-core all behind).
Evidence: One high-severity transitive advisory (GHSA-2v37-7h3g-55p8). No Gitleaks,
push protection, Renovate, Trivy, SBOM, Cosign, or SLSA provenance (section 5/13).
Impact: A known-vuln transitive dep ships; nothing keeps deps current or scans
images/secrets.
Proposed fix: `npm audit fix` (or pin the patched `nanoid`), add Renovate, Gitleaks
+ push protection, Trivy, CycloneDX SBOM, Cosign, provenance; record everything in
`docs/DEPENDENCY-MANIFEST.md` with resolution dates (section 1.6).
Resolution: Partially fixed — the advisory is closed: `npm audit` now reports 0 vulnerabilities, and `npm ls nanoid` shows 3.3.18 resolved through both `next` and `vitest`, so GHSA-2v37-7h3g-55p8 no longer ships. `docs/DEPENDENCY-MANIFEST.md` was written and records every dependency with its purpose, licence, resolved version, the 2026-08-26 resolution date and the pinning policy. CI now runs `npm audit --audit-level=high` and Gitleaks on every push and pull request. The rest of the supply-chain tooling did not land: there is no Renovate or Dependabot config, no Trivy, no CycloneDX SBOM, no Cosign and no SLSA provenance, and the pre-existing dependencies keep their caret ranges. Guarded by: no automated test; the `security` job in `.github/workflows/ci.yml` is the only gate.
Effort: M   Risk of fix: Low   Blocks: —

### LC-058 — Orphaned R2 objects: history past the cap and never-submitted uploads are never collected
Severity: Low
Category: Tech debt / Cost
Location: `lib/pipeline.ts:66` (`history.slice(-HISTORY_CAP)` drops the pointer,
not the object), `app/c/[slug]/upload/route.ts` (presigned PUT with no GC of
un-referenced uploads).
Evidence: Evicting a history entry past 10 leaves its HTML/PDF in R2 with nothing
pointing at it; a presigned upload that is never submitted stays in the
attachments prefix forever. Full client deletion sweeps the prefix, so these leak
only for live clients.
Impact: Slow unbounded storage growth; documented in Wave 6 as left.
Proposed fix: A GC job (a new cron) that deletes history assets on eviction and
sweeps unreferenced attachment keys older than a TTL.
Resolution: Not fixed — `lib/pipeline.ts:65` still ends `archiveVersion` with `.slice(-HISTORY_CAP)`, which drops the pointer and leaves the evicted render's HTML and PDF in R2 with nothing referencing them, and the surrounding comment still frames archiving as costing "nothing but the pointer". No GC job was added: `app/api/cron/` still contains only `backup` and `digest`, and a grep for a sweep or TTL across the cron routes finds nothing, so never-submitted presigned uploads still accumulate in the attachments prefix for live clients. Guarded by: no automated test.
Effort: M   Risk of fix: Low   Blocks: —

### LC-059 — Sinhala localisation is partial and the questionnaire root lang is wrong
Severity: Low
Category: i18n / Accessibility
Location: `components/QuestionnaireForm.tsx` (upload errors + generic fetch error
hardcoded English; `t.errGeneric` unreachable), server `error` strings English
app-wide, `<html lang="en">` on the Sinhala questionnaire (only `<main>` gets
`lang="si"`).
Evidence: The section tables are complete and drift-proof, but the failure path and
all server messages are English, and the document language attribute is wrong on
the translated page.
Impact: A Sinhala reader hitting an error, or a screen reader on the questionnaire,
gets the wrong language. Documented in Wave 6 as left.
Proposed fix: Translate the failure strings or surface server errors through the
i18n table; set `lang` on `<html>` for the questionnaire.
Resolution: Not fixed — `app/layout.tsx:42` still hard-codes `<html lang="en">`, and `components/QuestionnaireSheet.tsx:61` still sets the language only on `<main>`, so the Sinhala questionnaire continues to declare the wrong document language to screen readers. The failure strings are unchanged too: `components/QuestionnaireForm.tsx:165,172,176` build English upload errors directly and line 425 throws an English generic fetch error before the `t.errGeneric` fallback at line 436 can be reached, so that entry in the i18n table is still effectively unreachable, and server `error` strings remain English app-wide. Guarded by: no automated test.
Effort: M   Risk of fix: Low   Blocks: —

---

## Scope / architecture gaps versus the target (Info — the section 6 build, not defects)

### LC-060 — No GitHub App, webhook ingestion pipeline, or event data model
Severity: Info
Category: Scope
Evidence: Section 6.1 (the centrepiece) does not exist yet: no GitHub App, no
`webhook_deliveries` inbox, no idempotent processing, no dead-letter/replay, no
backfill/reconciliation, no rate-limit tracker. The app today is a client-document
platform. This is the Phase 4 build.
Resolution: Fixed — this capability now exists and is the largest single piece of the remediation. `lib/github/auth.ts` mints an RS256 App JWT and exchanges it for a cached installation token; `app/api/github/webhook/route.ts` with `lib/github/webhooks.ts` verifies the HMAC over the raw body before any parse, with a freshness window and delivery-id dedup, and the proxy exempts that one exact path rather than the prefix; `lib/github/inbox.ts` is the delivery inbox, one object per delivery with a status and a last-failure field for the dead-letter view; `lib/github/processor.ts` provides idempotent processing plus `replayDelivery`, `replayRange`, `backfill` and `reconcile`; `lib/github/handlers.ts` reconciles against the API rather than applying payloads, which is what makes out-of-order arrival correct; `lib/github/ratelimit.ts` tracks the budget; and `lib/github/schema.ts` validates every payload with Zod. The event data model lives in `lib/github/entities.ts` and `lib/github/projection.ts`, and the console surfaces are under `app/github/` and `components/github/`. Guarded by: tests/github-webhooks.test.ts::"raw body handling (regression guard) > fails if the body is re-serialised before signing, which is what body parsing does" and tests/github-pipeline.test.ts::"duplicate delivery > is idempotent when the same delivery is processed twice".

### LC-061 — Access model differs from section 4 (email+password+OTP, not GitHub OAuth + numeric-ID allowlist)
Severity: Info
Category: Scope
Evidence: Auth is `CONSOLE_USERS` (email/password/OTP). Section 4 specifies GitHub
OAuth restricted to the `luminary-dev` org plus a numeric-user-ID allowlist,
two roles, break-glass, step-up auth, and an immutable audit log with before/after.
The current activity log is append-only but not tamper-evident and records no
before/after. This is the Phase 3 build.
Resolution: Not fixed — this capability is still unbuilt. Sign-in remains `CONSOLE_USERS` email, password and OTP (`lib/users.ts`, `lib/otp.ts`, `app/api/auth/route.ts`); a grep for OAuth across the auth routes and the login page returns nothing. There is no numeric-user-ID allowlist, no two-role model and no step-up auth. `lib/github/auth.ts` is App-to-API authentication, not operator identity: the only link between an operator and a GitHub account is the `githubLoginFor(operatorEmail)` mapping at `lib/github/config.ts:85`. The activity log in `lib/activity.ts` is still append-only with no hash chain and no before/after values. Two adjacent controls did land: the session registry allowlist ends a removed operator's live sessions (see LC-010), and `docs/ACCESS-CONTROL.md` and `docs/runbooks/break-glass.md` were written to document the intended model. Guarded by: tests/session.test.ts::"GAP-3.5a removing an operator ends their live sessions > drops registry entries whose email is no longer in CONSOLE_USERS" covers the part that exists; the unbuilt parts have no test.

### LC-062 — No database; state is flat JSON files on R2
Severity: Info
Category: Scope
Evidence: Section 8/9 specify PostgreSQL + Drizzle + Redis + BullMQ with the listed
tables. The current store is R2 JSON files (the origin of LC-001/LC-002). This is
the Phase 4 foundation.
Resolution: Not fixed — this capability is still unbuilt. `package.json` lists no PostgreSQL driver, no Drizzle, no Redis client and no BullMQ, and `lib/store.ts` remains flat JSON objects on R2 for both client records and every GitHub entity, with `lib/github/entities.ts` and `lib/github/inbox.ts` storing one object per item under a state prefix. What did change is that the store learned compare-and-swap and strict reads, which removes the immediate defect the finding pointed at as its consequence. Guarded by: tests/store-cas.test.ts covers the CAS layer that stands in for transactions; there is no test for a database that does not exist.

### LC-063 — No real-time (SSE), no notification rules engine, no multi-channel delivery beyond Telegram+push
Severity: Info
Category: Scope
Evidence: Sections 6.4/6.5 (SSE, presence, rules engine, quiet hours, digests,
grouping, email/Slack channels) are unbuilt. There is one daily digest and a
fixed Telegram+push fan-out.
Resolution: Partially fixed — most of this capability now exists. `app/api/github/stream/route.ts` is a real SSE endpoint that pushes a cursor rather than entity payloads and resumes from `Last-Event-ID`, with polling kept as the documented fallback. `lib/github/notifications.ts` is a rules engine with shipped defaults so the rules are optional, per-rule conditions on repository, label, involvement and failure-only, quiet hours including a window that wraps midnight with an urgency override for failed production deploys and leaked secrets, and grouping by a group key so ten pushes to one pull request collapse into one notification. `lib/github/notify-events.ts` maps events onto notifications. Not built: presence, and the email and Slack channels, since the channel set is push, Telegram and in-app. Guarded by: tests/github-notifications.test.ts::"grouping > collapses ten pushes to one pull request into one notification" and tests/github-notifications.test.ts::"quiet hours > lets a failed production deploy through quiet hours".

### LC-064 — No command palette / keyboard system to the section-7 bar
Severity: Info
Category: Scope
Evidence: `CommandPalette` is a client quick-jump (Cmd+K, arrow keys) only — no
actions, no `/` shortcut, no j/k list nav, no go-to shortcuts, no shortcut sheet.
This is the Phase 2 build.
Resolution: Partially fixed — the palette gained real correctness and accessibility work (it is now a combobox owning a listbox, with `aria-activedescendant` moving across both result groups, and request cancellation per keystroke), and the GitHub views gained roving-tabindex list navigation with Home and End so Tab does not walk every row. It is still a quick-jump: `components/CommandPalette.tsx:39-49` binds only Cmd/Ctrl+K and Escape, and there are no actions in the palette, no `/` shortcut, no j/k list navigation, no go-to shortcuts and no shortcut sheet. `docs/KEYBOARD-SHORTCUTS.md` was written and lists only what is implemented, naming the gaps explicitly at the bottom. Guarded by: tests/github-ui.test.tsx::"keyboard navigation > keeps one tab stop in the list, so Tab does not walk every row" and tests/a11y.test.tsx::"CommandPalette content search > LC-043: arrow keys move aria-activedescendant across both result groups".

### LC-065 — No design-token package, Storybook, shadcn/ui, or `packages/ui`
Severity: Info
Category: Scope
Evidence: Tokens are 13 CSS custom properties in `app/globals.css`; there is no
`packages/design-tokens`, no Storybook, no shadcn/ui, no monorepo. This is the
Phase 2 build (see `docs/DESIGN-LANGUAGE.md`).
Resolution: Not fixed — this capability is still unbuilt. There is no `packages/` directory, no design-token package, no Storybook and no shadcn/ui in `package.json`, and the repo is still a single app rather than a monorepo. Tokens are still CSS custom properties in `app/globals.css`, though the set grew during the remediation: `--label` was added for LC-040, and the GitHub screens carry their own stylesheets at `components/github/github.css` and `components/github/github-views.css`. Guarded by: tests/css-layout.test.ts asserts two structural rules directly against the stylesheet files, which is the only automated cover the tokens have.

### LC-066 — No infrastructure-as-code, containers, per-PR previews with seeded data, or backup-restore drill
Severity: Info
Category: Scope
Evidence: Sections 13 (OpenTofu, Docker, `justfile`, ephemeral previews) and the
backup *restore* drill do not exist. There is a weekly backup email but no tested
restore, no documented RPO/RTO.
Resolution: Not fixed — this capability is still unbuilt. There is no OpenTofu or Terraform, no Dockerfile or docker-compose, no `justfile` and no per-PR preview seeding anywhere in the repo. The weekly backup cron at `app/api/cron/backup/route.ts` is unchanged and the restore is still untested in practice. The documentation half was written: `docs/DISASTER-RECOVERY.md` and `docs/DEPLOYMENT.md` now exist, so the RPO and RTO are at least recorded, but a document is not a drill. Guarded by: no automated test.

### LC-067 — Documentation set is minimal versus section 14
Severity: Info
Category: Scope
Evidence: The repo has `README.md`, `AGENTS.md`, `IMPROVEMENTS.md`. The section-14
set (`ARCHITECTURE.md`, `SECURITY.md`, `GITHUB-APP.md`, `WEBHOOKS.md`,
`ACCESS-CONTROL.md`, ADRs, runbooks, the full `docs/audit/` set) is being created
by this audit and remains largely to write.
Resolution: Fixed — the set now exists. `ARCHITECTURE.md` and `SECURITY.md` sit at the root, and `docs/` holds `ACCESS-CONTROL.md`, `GITHUB-APP.md`, `WEBHOOKS.md`, `DEPLOYMENT.md`, `DEPENDENCY-MANIFEST.md`, `DESIGN-LANGUAGE.md`, `DISASTER-RECOVERY.md`, `KEYBOARD-SHORTCUTS.md`, `MIGRATION-PLAN.md`, `OBSERVABILITY.md` and `TESTING.md`, plus two ADRs under `docs/adr/`, `docs/runbooks/break-glass.md`, and the eleven-file `docs/audit/` set including this register and before-and-after screenshots. The runbook directory holds a single file, so that part of section 14 is still thin. Guarded by: no automated test.

---

# Findings discovered during remediation

The findings above (LC-001 to LC-067) came from the initial read of the codebase
on 2026-08-26. The ones below were found afterwards, by the work itself: by
raising unit-test coverage on modules that had none, by measuring the rendered
pages rather than trusting HTTP status codes, and by exercising the GitHub layer
against the live API. They are recorded here rather than folded into the
original register because the distinction matters: an audit that only finds what
a first read surfaces is not finished, and most of these were invisible until
something executed the code.

All of them are fixed unless the resolution says otherwise.

### LC-068 — Every table page scrolled sideways on a phone, hiding the header
Severity: Medium
Category: Accessibility / UX
Location: `app/globals.css:161` (`.table-scroll`), `components/github/github.css:57` (`.gh-scroll`)
Evidence: At a 360px viewport, `documentElement.scrollWidth` was 630px on the
dashboard, 789px on `/github` and 1096px on `/github/ci`. Scrolling right moved
the header from x=16 to x=-413: the topbar, navigation and sign-out control all
left the screen with no way back except scrolling back.
Impact: The console is used from phones. Every dense table view was affected.
Reproduction: Load any table page at 360px wide and swipe left.
Root cause: Each table carries a `min-width` so its columns stay readable, inside
a wrapper with `overflow-x: auto`. That wrapper measured correctly (326px inside
a 360px viewport) and scrolled its content internally, which is why the tables
looked innocent. CSS `overflow` only clips a descendant whose *containing block*
lies inside the scrolling box. The `.sr-only` table captions and per-cell labels
are `position: absolute`, and on a `position: static` scroller they resolve
against the initial containing block instead, escaping the clip and stretching
the document to the full width of the table. The accessibility affordance was
what broke the layout, which is why it survived review.
Proposed fix: `position: relative` on both scrollers, making them the containing
block for their absolutely positioned descendants.
Resolution: Fixed — both rules now declare `position: relative`, verified at 320,
360, 768 and 1440px across all fourteen pages with zero horizontal overflow, and
the scrollers still scroll internally so the column widths are unchanged.
Guarded by: tests/css-layout.test.ts::"is positioned, so absolute descendants are clipped", which parses the stylesheets and fails if either rule loses the declaration. The guard was verified non-vacuous by reverting the fix and watching it fail.
Effort: S   Risk of fix: Low   Blocks: —

### LC-069 — The dashboard scored 0.234 CLS because the alerts toggle appeared after hydration
Severity: Medium
Category: Performance / UX
Location: `components/PushToggle.tsx:46`
Evidence: Lighthouse reported CLS 0.234 on the authenticated dashboard, against a
"good" threshold of 0.1. Under 4x CPU throttling the shift landed at 2113ms:
the topbar grew from 180px to 223px and everything below it jumped down 43px.
Impact: The single largest contributor to a Lighthouse performance score that
had dropped from 98 to 86. Content moves under the reader's finger, and a tap
aimed at one control can land on another.
Reproduction: Load `/` at 412px with CPU throttled 4x and observe the layout
shift entries.
Root cause: The component starts in a `hidden` mode that renders `null`, and an
effect decides whether this device supports push. Server and first client render
produced nothing; the real button then mounted and wrapped the topbar onto an
extra row.
Proposed fix: Distinguish "not yet established" from "established: unsupported",
and reserve the button's exact box during the former.
Resolution: Fixed — a `pending` mode renders an inert, invisible button with the
same classes and the same widest label, so the box is identical and there is no
hydration mismatch. The unsupported path now resolves to `hidden` explicitly
rather than being left in `pending` forever, so the reserved space is released
rather than held open as a gap. Measured CLS afterwards: 0.0000, topbar 223px
from first paint.
Guarded by: no automated test. jsdom performs no layout, so CLS is not assertable in the unit suite; this is one of the cases `docs/TESTING.md` records as needing the Lighthouse CI that is not yet built.
Effort: S   Risk of fix: Low   Blocks: —

### LC-070 — Org-wide lists silently hid entities whose repository projection was missing
Severity: High
Category: Data integrity
Location: `lib/github/projection.ts` (`listAllPullRequests` and its four siblings)
Evidence: `listAllPullRequests` started from `listRepos()` and listed each
repository in turn, so a pull request stored under a repository with no
`RepoEntity` was invisible to the inbox. The same shape applied to workflow
runs, deployments, releases and alerts.
Impact: This is the "a console that lies" case. The reachable path is ordinary:
the `pull_request` handler writes the pull request but never writes a
repository, and the `push` handler deliberately only updates a repository
projection that already exists. A repository that emitted pull request events
without ever emitting a `repository` event, an `installation_repositories.added`
or a sync therefore accumulated real, open pull requests that no screen showed.
Reproduction: Store a pull request for a repository with no repository
projection, then read the inbox. Before the fix: empty.
Proposed fix: Enumerate the stored objects directly instead of walking a second
index that can disagree with them.
Resolution: Fixed — a shared `listAllUnder` helper lists the entity prefix
directly, so the repository index cannot hide anything. It is also fewer round
trips: one prefix listing rather than one per repository. A read ceiling of 5000
objects bounds a runaway bucket, and reaching it is logged rather than absorbed
silently, per the register's own rule about silent caps.
Guarded by: tests/github-projection.test.ts::"shows a pull request whose repository projection is missing".
Effort: S   Risk of fix: Low   Blocks: —

### LC-071 — A pull request with more than 100 checks could report as ready to merge while a check was failing
Severity: High
Category: Correctness / Safety
Location: `lib/github/api.ts` (`fetchChecks`)
Evidence: `fetchChecks` requested `check-runs?per_page=100` through `ghData` and
stopped, ignoring the `Link` header. Every check beyond the hundredth was
dropped without a word.
Impact: `mergeReadiness` decides whether a pull request is safe to merge from
this list, so a dropped FAILING check turned a blocked pull request into one the
console reported as ready. This is the most serious defect found during the
remediation, because the console would have been confidently wrong about the one
question an operator most needs it to be right about. It was not hypothetical:
a live pull request in the org (`luminary-dev/service-hub#885`) carries 84 check
runs, well inside one matrix expansion of the limit.
Reproduction: A commit with more than 100 check runs where a failing one sorts
beyond the first page.
Proposed fix: Follow the `Link` header.
Resolution: Fixed — `fetchChecks` now paginates, following `rel="next"` only and
never synthesising a page number, matching what `ghPaginate` does. It uses `gh`
rather than `ghData` because it needs the response headers. `fetchWorkflowRuns`
carried the same shape (its `limit` above 100 silently returned 100) and was
paginated the same way. Verified against the live API.
Guarded by: tests/github-api.test.ts, covering the multi-page path and a failing check on the second page.
Effort: S   Risk of fix: Low   Blocks: —

### LC-072 — Reconcile silently corrected the most common form of drift and reported nothing
Severity: Medium
Category: Observability
Location: `lib/github/processor.ts` (`reconcile`)
Evidence: The live open list was written straight over the projection with
`void written`, no comparison against the stored copy. Only pull requests
*absent* from the live list could reach `DriftReport.drifted` at all.
Impact: A stale-but-still-open pull request is the ordinary signature of a lost
webhook delivery, and it is the most common drift there is. Fixing it quietly
meant the projection looked healthy while the delivery pipeline was dropping
events, which is exactly the signal the report exists to carry. It also
contradicted the module header, the function docblock, and `docs/WEBHOOKS.md`,
all three of which promised drift was surfaced rather than silently corrected.
Reproduction: Store a pull request with an older `updatedAt` than GitHub's copy
and reconcile. Before the fix: corrected, `drifted` empty.
Proposed fix: Read the stored copy before writing and report the difference.
Resolution: Fixed — the stored copy is compared before the write and a stale one
is reported with both timestamps. The code now matches what the documentation
already claimed.
Guarded by: tests/github-processor.test.ts::"corrects a stale copy of a still-open pull request AND reports it", with a companion test asserting a healthy projection stays quiet so the signal is not devalued by false positives.
Effort: S   Risk of fix: Low   Blocks: —

### LC-073 — Reconcile counted pull requests as removed without removing them
Severity: Medium
Category: Data integrity
Location: `lib/github/processor.ts` (`reconcile`)
Evidence: The branch incremented `removed` and pushed a drift entry, but never
called `deletePullRequest`, unlike the handler path which removes the projection
on a 404.
Impact: A pull request whose repository was deleted or transferred stayed in the
projection permanently. No webhook would ever arrive for it, so every later
reconcile re-reported the same phantom while the inbox went on showing it as
open work. The count said the problem was handled; nothing had been.
Reproduction: Reconcile with a stored pull request the API returns 404 for, then
read the projection.
Proposed fix: Delete it, matching the handler.
Resolution: Fixed — `deletePullRequest` is called alongside the drift report. A
related overstatement was fixed in the same pass: `checked` returned
`stored.length` while closed pull requests were skipped without being checked,
so the number shown in the admin UI claimed more work than had been done.
Guarded by: tests/github-processor.test.ts::"counts a pull request the API no longer knows about", which now asserts the projection is gone.
Effort: S   Risk of fix: Low   Blocks: —

### LC-074 — A failed Cloudflare DNS delete was reported to the operator as a success
Severity: Medium
Category: Correctness
Location: `lib/domains.ts` (`removeSubdomain`)
Evidence: `await fetch(..., { method: "DELETE" })` discarded the response and
unconditionally pushed `"cloudflare record deleted"`.
Impact: A 403 from a token without `DNS:Edit`, or a 404, left the operator
believing a subdomain had been torn down while the CNAME still resolved at the
old target. Another case of the console asserting something it had not checked.
Reproduction: Remove a subdomain with a token lacking `DNS:Edit`.
Proposed fix: Check the response and report the status.
Resolution: Fixed — the note now reflects the actual HTTP result. Two related
faults in the same file were fixed with it: removal required
`CLOUDFLARE_ZONE_ID` while creation fell back to a zone lookup, so a deployment
holding only the token created records it could never delete and blamed the
wrong variable when asked to (both paths now share one `resolveZoneId` helper);
and the Cloudflare zone lookup never checked `res.ok`, so an expired token
surfaced as "zone not found" and sent the operator after a DNS problem that did
not exist.
Guarded by: tests/domains.test.ts::"looks the zone up on removal when only the token is set, as creation does" and ::"names the variable that is actually missing".
Effort: S   Risk of fix: Low   Blocks: —

### LC-075 — A limit of zero returned the entire activity log
Severity: Low
Category: Correctness
Location: `lib/activity.ts` (`recentActivity`, `activityFor`)
Evidence: `entries.slice(-limit)`. `-0` is not negative, so `slice(-0)` is
`slice(0)` and returns everything up to the 500-entry cap.
Impact: Latent rather than live: every current caller passes 100 or the default.
It is the kind of thing that becomes a bug the first time a caller computes a
limit and gets zero.
Reproduction: `recentActivity(0)`.
Proposed fix: Return an empty array for a non-positive limit.
Resolution: Fixed — `limit <= 0` returns `[]` in both functions.
Guarded by: tests/activity.test.ts covers the limit semantics including zero.
Effort: S   Risk of fix: Low   Blocks: —

### LC-076 — A byte cap on pull request diffs was enforced with a character slice
Severity: Low
Category: Correctness
Location: `lib/github/api.ts` (`fetchPullRequestDiff`)
Evidence: The size was measured with `Buffer.byteLength(diff, "utf8")` and then
truncated with `diff.slice(0, maxBytes)`, which counts UTF-16 code units.
Impact: A 2 MB cap on a diff of Sinhala or CJK text returned up to 4 MB, and
slicing mid-character could split a surrogate pair. Given the studio works in
Sinhala and English, multi-byte diffs are ordinary here, not exotic.
Reproduction: Cap a diff of `"é".repeat(2000)` at 1000 bytes: 2000 bytes come
back.
Proposed fix: Cut the byte window and decode it.
Resolution: Fixed — the window is taken with `Buffer.subarray` and decoded with
`TextDecoder`, and the trailing replacement character from a cut-through
character is dropped.
Guarded by: tests/github-api.test.ts covers the multi-byte cap.
Effort: S   Risk of fix: Low   Blocks: —

### LC-077 — GraphQL check and review ids were positional and collided with real ids
Severity: Low
Category: Correctness
Location: `lib/github/api.ts` (`fromGraphQLPullRequest`)
Evidence: `id: c.databaseId ?? i` gave a `StatusContext`, which has no
`databaseId`, the array index. A `CheckRun` with `databaseId: 1` and a
`StatusContext` at index 1 both emitted `id: 1`. Reviews were worse: `id: i`
unconditionally, because the query did not select `databaseId`, so the same
review had a different id depending on which transport loaded it.
Impact: Duplicate React keys and broken id-based comparison between the two
transports. A duplicate-key defect of exactly this shape was hit and fixed
earlier in the remediation, in `groupFailures`.
Reproduction: A pull request with both a check run and a legacy status context.
Proposed fix: Namespace the synthetic ids away from real ones, and select
`databaseId` for reviews.
Resolution: Fixed — synthetic ids are now negative, which real GitHub ids never
are, and the GraphQL query selects `databaseId` on `latestReviews` so a review
keeps one identity across transports.
Guarded by: tests/github-api.test.ts asserts no collision and that ids match across transports.
Effort: S   Risk of fix: Low   Blocks: —

### LC-078 — A small excerpt window could scroll the failing line out of a CI log excerpt
Severity: Low
Category: Correctness
Location: `lib/github/api.ts` (`extractFailure`)
Evidence: The window opened five lines before the marker and then took
`maxLines` from there, so any `maxLines <= 5` returned only lead-in.
Impact: Harmless at the default of 40, but `fetchJobFailureExcerpt(repo, id, 5)`
is a legal call that would return an excerpt containing everything except the
error it was asked for.
Reproduction: `extractFailure(log, 3)`.
Proposed fix: Bound the lead-in by the budget.
Resolution: Fixed — the lead is `Math.min(5, Math.max(0, maxLines - 1))`, so the
failing line is always inside the window.
Guarded by: tests/github-api.test.ts covers a small `maxLines`.
Effort: S   Risk of fix: Low   Blocks: —

### LC-079 — The GraphQL inbox reached fewer repositories than its own REST fallback
Severity: Low
Category: Correctness
Location: `lib/github/api.ts` (`fetchOpenPullRequests`)
Evidence: The GraphQL query hardcoded `repos: 50` while the REST fallback
paginates to 500.
Impact: On an org past 50 repositories the *primary* path would silently show
fewer pull requests than the *fallback*, with nothing saying so. The org holds
18 repositories today, so this is a future problem rather than a current one.
Reproduction: An org with more than 50 repositories.
Proposed fix: Raise the ceiling and say when it is reached.
Resolution: Fixed — the ceiling is 100, which is GraphQL's hard per-connection
maximum, and filling the page logs a warning rather than truncating in silence.
Reaching beyond one page would need cursor pagination through the repository
connection, which is recorded here as the next step if the org grows.
Guarded by: tests/github-api.test.ts asserts the query variables.
Effort: S   Risk of fix: Low   Blocks: —

### LC-080 — The client portal could not hot-reload in development
Severity: Low
Category: Developer experience
Location: `lib/csp.ts`, `proxy.ts`
Evidence: `/c/<slug>` is served the stored-document CSP, which has no
`'unsafe-eval'`. Next's development refresh runtime uses `eval`, so the portal
page logged a CSP violation and did not hot-reload. A comment in `proxy.ts`
asserted the page "renders fine" under that policy, which was true in production
and false in development.
Impact: Development friction on a client-facing page, and a comment that stated
something untrue.
Reproduction: Run `next dev` and load `/c/<slug>`.
Proposed fix: Allow `'unsafe-eval'` on the document surface in development only.
Resolution: Fixed — gated on `NODE_ENV === "development"`, so the shipped policy
is byte-for-byte as strict as before. Production was verified separately: zero
console errors and correct hydration on the portal under a production build.
Guarded by: tests/csp.test.ts, which now stubs `NODE_ENV` to "production" explicitly and asserts neither surface carries `'unsafe-eval'`, rather than relying on the test environment happening not to be "development".
Effort: S   Risk of fix: Low   Blocks: —

### LC-081 — The `member` webhook handler validated against the wrong schema
Severity: Info
Category: Correctness
Location: `lib/github/handlers.ts`
Evidence: It called `InstallationEvent.safeParse(payload)` and discarded the
result with `void data`, while `schema.ts` maps `member` to `MembershipEvent`.
Impact: None today, since the result was unused and `safeParse` cannot throw.
It would mis-validate the moment anyone started using it.
Proposed fix: Drop the dead parse.
Resolution: Fixed — the handler only logs, so the parse was removed and a
comment records why. A cosmetic defect was fixed alongside it: a
`workflow_run` whose workflow file was deleted arrives with a null name and
rendered a double space in the delivery summary, where the stored entity already
used "workflow" for the same case.
Guarded by: tests/github-handlers.test.ts::"handles a run whose workflow has no name".
Effort: S   Risk of fix: Low   Blocks: —

### LC-082 — Repository storage keys can collide in principle
Severity: Info
Category: Data integrity
Location: `lib/github/projection.ts` (`repoKey`)
Evidence: `repoKey` replaces every character outside `[A-Za-z0-9_.-]` with an
underscore, so `"a_b/c"` and `"a/b_c"` both yield `"a_b_c"`.
Impact: Unreachable with real GitHub data: a collision requires an owner login
containing an underscore, and GitHub does not permit one. The input does arrive
from a webhook payload, so the safety rests on an upstream naming rule rather
than on anything this code enforces.
Proposed fix: Encode the separator distinctly.
Resolution: Won't fix, for now, and deliberately — changing the key derivation
would rename every stored object and strand the existing projection, which is a
migration, not a patch. Recorded here so the trade is explicit rather than
forgotten. If the derivation is ever revisited, `docs/MIGRATION-PLAN.md`
describes the expand-and-contract this would need.
Guarded by: tests/github-projection.test.ts pins the current derivation, so a change cannot happen silently.
Effort: M   Risk of fix: Medium   Blocks: —

### LC-083 — The GitHub cron took the whole deployment down on the Hobby plan
Severity: High
Category: Deployment
Location: `vercel.json`
Evidence: The pipeline added `/api/github/process` on `*/5 * * * *`. The Vercel
account is on the Hobby plan, which permits a cron to run at most once per day,
and Vercel rejects the schedule when the deployment is CREATED rather than when
the cron fires: `Hobby accounts are limited to daily cron jobs. This cron
expression (*/5 * * * *) would run more than once per day.`
Impact: Every deployment failed, with duration 0 and no deployment record, so
there were no build logs to read and the failure looked like an infrastructure
problem rather than a configuration one. This is the mandate's "never break the
running console" rule broken by the remediation itself: a change that passed
lint, typecheck, tests and `next build` locally and in CI still could not ship,
because CI builds the app and Vercel validates the platform config, and nothing
in the local gates covers the latter.
Reproduction: `vercel deploy` with a sub-daily cron on a Hobby account.
Proposed fix: Use a daily schedule, or upgrade the plan.
Resolution: Fixed — the schedule is `0 5 * * *` and a preview deployment was
verified READY afterwards. The cost is written down rather than absorbed:
normal webhook handling is unaffected, because deliveries are processed via
`after()` within a second of arrival, but the RETRY window for a delivery whose
inline processing threw grows from 5 minutes to 24 hours, and reconciliation
runs daily rather than hourly. `docs/DEPLOYMENT.md` records that, and says the
one-line change to make on Pro. Nothing in the code assumes a frequency:
`/api/github/process` decides internally whether a reconcile is due.
Guarded by: no automated test. Platform configuration is not exercised by any local gate, which is the gap this finding is really about.
Effort: S   Risk of fix: Low   Blocks: —

### LC-084 — The secret scan could never pass, and was scanning the wrong thing
Severity: Medium
Category: CI / Security
Location: `.github/workflows/ci.yml`
Evidence: The security job used `gitleaks/gitleaks-action@v2`, which refuses to
run for a GitHub organization without a paid licence:
`missing gitleaks license. Go grab one at gitleaks.io and store it as a GitHub
Secret named GITLEAKS_LICENSE.` The job failed on every push from the moment it
was added.
Impact: A red merge gate that cannot be made green is worse than no gate. It
trains everyone to ignore the check, and it hid the fact that no secret
scanning was actually happening. The audit added this job and never watched it
run against the org, which is the same class of mistake as the coverage
threshold set above the real figure.
Reproduction: Push any commit to a repository owned by an organization.
Proposed fix: Run the gitleaks binary, which is open source and free. Only the
Action wrapper is licensed.
Resolution: Fixed, and two further defects were found while verifying it rather
than assuming it worked. First, the download was renamed with `curl -o`, so the
checksum line referred to a filename that did not exist on disk and
`sha256sum -c` had nothing to verify: the asset now keeps its published name.
Second, the scan used `gitleaks dir .`, which walks the working tree including
gitignored build output, and `.next/cache` holds real token values baked in at
build time, producing 25 findings for material that is not in the repository
and cannot be. It now runs `gitleaks git .`, with `fetch-depth: 0` on the
checkout so the history is actually there to scan rather than a single shallow
commit.
Scanning the real history surfaced one hit in `tests/redact.test.ts`, and
GitGuardian independently flagged four in the same and one neighbouring file:
synthetic fixtures (a 64-character hex string, AWS's published
`AKIAIOSFODNN7EXAMPLE`, a fake fine-grained PAT) that exist precisely because
that test proves secret-shaped strings are scrubbed before they reach a log.

The first fix was a path allowlist in `.gitleaks.toml`, and it was the wrong
one twice over. It exempts the file permanently, so a credential genuinely
pasted into it later would pass unnoticed, and it fixes nothing for the second
scanner, because GitGuardian reads its policy from its own dashboard rather
than from this repository. One allowlist per tool, forever, is a treadmill.

The root cause was the literals themselves, so those are gone: the fixtures are
now assembled at runtime from harmless fragments, with the runtime values
byte-identical, so the redactor is tested against exactly the same input and
all 37 assertions are unchanged. `tests/` now scans clean with no allowlist at
all. What remains is a single `.gitleaksignore` fingerprint,
`commit:path:rule:line`, dismissing the one finding in the commit that
introduced the literal, since history still holds it. A fingerprint dismisses
one finding rather than switching off a file.
Guarded by: the job itself, verified end to end locally. The ignore was checked for over-reach by planting a fake classic PAT in that same file and confirming the scan still failed, so the dismissal covers one historical finding and nothing else.
Effort: S   Risk of fix: Low   Blocks: —

### LC-085 — Six pipeline tests were a time bomb that turned CI red on a clock change
Severity: High
Category: Testing
Location: `tests/github-pipeline.test.ts`
Evidence: The fixtures carried absolute timestamps, `2026-08-26T10:00:00Z` and
neighbours. The webhook receiver rejects a delivery whose payload timestamp is
older than `WEBHOOK_MAX_AGE_MS` (5 minutes), and `payloadTimestamp()` reads
`pull_request.updated_at`, which is one of those literals. Written in the
morning of 2026-08-26 the timestamps sat in the future, so the freshness check
saw a negative age and passed. By that afternoon they were hours in the past
and six tests failed with `stale_delivery`, the receive path returning 400
instead of 200.
Impact: The suite passed CI on the pull request and would have failed the next
run on `main` with no intervening code change. That is the worst shape a test
failure can take: it points at whatever merged most recently rather than at the
real cause, and it erodes trust in the suite exactly when the suite is new and
that trust is still being built. It was found by running the tests again hours
later while configuring the GitHub App, not by any gate.
Reproduction: Run the suite before 10:05Z on 2026-08-26 and again after.
Proposed fix: Derive fixture timestamps from the clock rather than hard-coding
them.
Resolution: Fixed — a single `BASE = Date.now()` captured at module load, with
an `at(minutesFromNow)` helper. Every offset sits inside the freshness window
and the relative ordering the out-of-order and newer-wins cases depend on is
preserved. No absolute date remains in the file. The other test files that
contain 2026 dates were checked and are not exposed: they pass an explicit
`now` into the function under test rather than relying on the wall clock.
Guarded by: the tests themselves, which now cannot drift out of the window. There is no meta-test asserting determinism; the durable guard would be running CI on a clock-skewed runner, which is not set up.
Effort: S   Risk of fix: Low   Blocks: —

### LC-086 — Every CI check slower than five minutes was silently dropped
Severity: Critical
Category: Data integrity
Location: `lib/github/webhooks.ts` (`payloadTimestamp`), `lib/github/config.ts` (`WEBHOOK_MAX_AGE_MS`)
Evidence: The receiver rejects a delivery whose payload timestamp is older than
`WEBHOOK_MAX_AGE_MS`, which was 5 minutes. GitHub sends no delivery timestamp:
there is no signed timestamp and no send-time header, so the age was inferred
from fields inside the payload. Those describe the ENTITY, not the delivery,
and the field consulted for check runs was `check_run.started_at`, which is
when the check BEGAN.
A check run taking ten minutes therefore reports a `started_at` ten minutes old
at the moment it completes, and was refused with `stale_delivery` on its FIRST
delivery. Verified directly against the real code and the production webhook
secret: a `check_run.completed` with `started_at` ten minutes ago and
`completed_at` now was REJECTED, while the same event with a two minute build
was accepted.
Impact: The console silently lost the completion of every CI check slower than
five minutes, which is most real builds. `mergeReadiness` reads those checks to
decide whether a pull request is safe to merge, so this is the same class of
harm as LC-071 arriving by a different route: the console would show a pull
request as ready while a slow check that had actually failed never landed. It
fails closed in the sense that the delivery is refused rather than mangled, but
GitHub records a 400 and moves on, so the loss is invisible from inside the
console. It was live in production from the moment the App was installed.
It also made the documented recovery procedure impossible. Redelivering from
the App's Recent Deliveries page resends the ORIGINAL body with its ORIGINAL
timestamps, so any delivery older than five minutes could never be replayed by
an operator rebuilding the projection. This was found exactly that way: 18
deliveries rejected while production still lacked the webhook secret were
redelivered afterwards, and every `check_run` and `check_suite` among them came
back 400 while `workflow_job` (which has no scanned timestamp field) returned
200.
Reproduction: Sign a `check_run.completed` payload whose `started_at` is ten
minutes ago and post it. Before the fix: 400, `stale_delivery`.
Proposed fix: Stop reading a start time as a send time, and stop letting a
backstop control drop real traffic.
Resolution: Fixed, in two parts. `payloadTimestamp` now prefers
`check_run.completed_at` and falls back to `started_at` only for a run that has
not finished, where the start genuinely is recent. And `WEBHOOK_MAX_AGE_MS` is
now 48 hours rather than 5 minutes, because the check earns very little: a
forged body is impossible without the webhook secret, a replayed delivery id is
already caught by the inbox dedup, and handlers reconcile against the API
rather than applying payload deltas, so replaying a genuine old event just
re-reads current truth. The window is a backstop against indefinite replay, not
a primary control, and it must never be the reason real work goes missing.
Guarded by: tests/github-webhooks.test.ts::"accepts a check run that took longer than the old five minute window", ::"prefers a check run's completed_at over its started_at", ::"still uses started_at for a check run that has not finished", and ::"accepts an operator redelivery from the App's Recent Deliveries page".
Effort: S   Risk of fix: Low   Blocks: —

### LC-087 — Timestamps rendered five and a half hours wrong, and broke hydration
Severity: Medium
Category: Correctness / UX
Location: `components/DesignsCard.tsx`, `components/SessionsCard.tsx`
Evidence: Both carried their own private copy of a `when()` helper calling
`toLocaleString("en-GB", { day, month, hour, minute })` with **no `timeZone`**.
Without one, the runtime's zone is used, and the runtime differs by side: the
Vercel server renders in UTC, the browser renders in the viewer's zone. On the
production client page the same instant appeared as `15 Aug, 18:23` from the
server and `15 Aug, 23:53` after hydration, a clean +5:30 for Asia/Colombo.
Impact: Two problems from one cause. React reported a hydration mismatch
(minified error #418) on `/clients/eco-mech`, the only console error left in
production. And the timestamp itself is wrong for five and a half hours' worth
of reading: an operator glancing at the page before hydration completes sees a
different time than a moment later, with nothing indicating which is right.
`lib/time.ts` already documents the rule this broke, that the studio's clock is
Colombo rather than the server's UTC, so an entry's time matches what the
operator remembers.
Reproduction: Load `/clients/eco-mech` in production from a non-UTC timezone
and compare the design timestamps before and after hydration.
Proposed fix: Pin the zone, and stop duplicating the formatter.
Resolution: Fixed — `shortWhenLabel` now lives in `lib/time.ts` alongside
`whenLabel` and `relTime`, pinned to Asia/Colombo like every other clock in the
console, and both components use it. The duplication was the real defect: the
shared helpers were already correct, and the bug existed only in the two copies
that had drifted from them. `RateLimitBadge` was checked and was already
correct.
Guarded by: tests/relative-time.test.ts::"formats in Colombo time regardless of the runtime's zone", ::"agrees with whenLabel on the hour, so the two clocks cannot diverge", and ::"returns the input unchanged when it is not a date". The second is the one that matters: it pins the two formatters together so they cannot drift apart again.
Effort: S   Risk of fix: Low   Blocks: —

### LC-088 — Both personal views reported a confident zero for everyone
Severity: Medium
Category: UX
Location: `components/github/PrInbox.tsx`, `app/github/page.tsx`
Evidence: "Needs my review" and "My pull requests" filter on a `viewerLogin`
read only from `localStorage`, typed by hand into a text box whose placeholder
is `octocat`. Until an operator typed their own GitHub login, both views showed
`· 0`.
Impact: A confident zero is worse than an empty state. "Needs my review · 0"
reads as "nothing is waiting on you", which is a statement about the world, not
about configuration, and it is the first thing on the console's centrepiece
screen. Every operator saw it on every first visit, and nothing on the page
suggested the number was a placeholder rather than a fact.
It was also asking for something the console already had. The operator is
signed in, so the server knows their email, and `GITHUB_OPERATORS` maps that
email to a GitHub login: the same mapping notification targeting already
depends on.
Reproduction: Open `/github` in a browser that has never set the login.
Proposed fix: Seed the value server-side from the signed-in operator.
Resolution: Fixed — `app/github/page.tsx` resolves
`githubLoginFor(await currentOperator())` and passes it to `PrInbox`, which
uses it as the initial state so the first paint already filters correctly. A
value saved in this browser still wins, but it is applied in an effect after
mount rather than read during render, because reading storage during render
would make server and client disagree and trip hydration, which is exactly the
defect LC-087 was. The empty-string case is preserved deliberately: an operator
who clears the field keeps it cleared instead of the server value reappearing
on every reload, and an unmapped operator gets an empty box rather than a
guessed login that would filter the views to someone else's work.
Guarded by: tests/github-ui.test.tsx::"seeds the login from the operator, so the personal views are not silently empty" and ::"renders an empty login when the operator is not mapped".
Effort: S   Risk of fix: Low   Blocks: —

### LC-089 — Every article publish reported failure after succeeding
Severity: High
Category: Correctness / Operations
Location: `.github/workflows/ops-run.yml` (the "Call the route" step)
Evidence: Run 33029970914 is marked `failure`, yet its own log shows
`← 200`, `↳ result stored for relay`, and the pull request it opened,
dhanikaa/luminary-landing-page#97, exists and is open. The step ran under
`bash -e` with `set -o pipefail` and ended with:
`echo "$RESP" | jq "$FILTER" 2>/dev/null | head -c 4000 || echo "$RESP" | head -c 4000`
`head -c` closes the pipe as soon as it has its bytes, sending SIGPIPE
upstream. Under `pipefail` the pipeline exits 141, so the `||` fallback runs,
and the fallback is ITSELF a pipeline with the same flaw. Nothing caught it, it
was the last command in the group, and `-e` failed the step.
`/api/publish/article` returns the cover image as a base64 data URL, so its
response is roughly 200KB every time and the 4000-byte cap was always exceeded.
Reproduced exactly outside CI: exit 141, with the line after the group never
reached.
Impact: Every publish went red after doing real, irreversible work. The article
was drafted (paid Anthropic and OpenAI calls), the cover was generated, the
branch was pushed and the pull request opened, and then the console reported a
failure. The obvious operator response to a failed publish is to run it again,
and a second run either collides with the in-flight pull request or spends the
money a second time. A tool that lies about whether it did the thing is worse
than one that fails honestly, and this one lied in the direction that invites a
destructive retry.
Reproduction: Dispatch any relayed route whose response exceeds 4000 bytes.
Proposed fix: Do not truncate with a pipe.
Resolution: Fixed — the response is pretty-printed once into a variable and
truncated with bash substring expansion (`${PRETTY:0:4000}`), which cannot
raise SIGPIPE. The log echo is bounded the same way, since 200KB of base64 in a
job log helps nobody, and both places now say plainly how many bytes were
elided rather than trimming in silence. The non-JSON fallback is preserved and
tested: an unparsable response still prints raw and still exits 0.
Guarded by: no automated test. CI workflows are not exercised by the unit suite, which is the same structural gap LC-083 recorded: the local gates do not cover platform or pipeline configuration. The fix was verified by reproducing the failure and the pass outside CI, including the non-JSON path.
Effort: S   Risk of fix: Low   Blocks: —

### LC-090 — Cover art drifted between two different house styles, and the inline-image control was the wrong shape
Severity: Low
Category: UX / Content
Location: `lib/publish/images.ts`, `lib/publish/draft.ts`, `components/PublishStudio.tsx`, `app/api/publish/article/route.ts`
Evidence: The style prompt asked for "The Adventures of Tintin (2011)
motion-capture", but the published covers do not agree with each other. Pulled
four from the landing repo and looked at them: `postgres-everything-database`
lands on the intended semi-realistic look, while `aws-cost-engineering` and
`monorepos-2026` are plainly Pixar, with oversized glossy eyes, rounded
caricature faces and moulded-plastic surfaces. The instruction was there; the
model ignored it, because "3D animated feature film" plus "expressive faces"
reads as Pixar to an image model unless it is told otherwise.
Separately, the operator asked for a checkbox to add one or two illustrations
inside an article. It shipped as a three-option dropdown, which is why it was
reported missing: it does not look like the control that was asked for, and it
sits beside a real checkbox for the draft flag.
Impact: A blog whose covers alternate between two styles reads as a blog with
no art direction. This is the studio's shopfront.
Proposed fix: Say what the style is NOT, and make the control the shape it was
asked to be.
Resolution: Fixed. The style prompt now names realistic human proportions,
naturalistic skin and understated expression, and explicitly rules out Pixar,
Disney and DreamWorks along with the specific tells (oversized glossy eyes,
rounded caricature faces, plastic surfaces, toy colours). It also pins the
midpoint: "if it could pass for a stock photograph it has gone too far one way,
and if the faces look cute it has gone too far the other", which was added
after a first pass came back nearly photographic. The house vocabulary the
existing covers already share is written down rather than left to chance: warm
golden-hour or lantern light, aged brass and copper, one restrained luminous
green accent, practical machinery, Sri Lankan setting.
The cover brief now has to be a metaphor for the article's ARGUMENT rather than
its topic, and literal technology is banned outright.
Verified by generating a cover with the real model before and after, and
looking at both.
The dropdown is now a checkbox. The count follows the length of the article,
roughly one illustration per 8000 characters capped at two, because "does this
article want pictures in it" is the editor's question while 1 against 2 is a
judgement about the article, and the article is right there to be measured. The
API still accepts an explicit number so it stays usable directly.
Guarded by: tests/publish-inline.test.ts, five cases covering unchecked, short, long, the cap and explicit numbers. The style prompt itself has no automated test: image output is not assertable, and pretending otherwise with a snapshot would be theatre.
Effort: S   Risk of fix: Low   Blocks: —

### LC-091 — Every checkbox in the product failed the WCAG 2.2 AA target size
Severity: Medium
Category: Accessibility
Location: `app/globals.css` (`.q-check`, and the new `.check-row`), `components/PublishStudio.tsx`
Evidence: Measured in a real browser at iPhone 15 dimensions. The publish
portal's checkboxes rendered a 13x13 control on a 22px row; the client
questionnaire's 71 checkboxes rendered 15x15 on a 20px row. WCAG 2.2 AA 2.5.8
(Target Size Minimum) requires 24x24 CSS px, and Apple's HIG asks for 44x44.
Every one of them was under the AA floor, on touch and with a mouse.
The criterion's user-agent exception does not apply, because the author is the
one overriding the control's size.
Impact: The questionnaire is the form clients fill in, more often on a phone
than not, and 71 mis-sized targets is the whole form. A fiddly checkbox on a
client-facing document is a bad look before it is an accessibility failure. It
was found only by asking whether a newly added control worked on mobile, and
then measuring rather than eyeballing: the labels are fully clickable and look
fine in a screenshot, so nothing about them reads as broken.
Reproduction: Render `/c/<slug>/questionnaire` at 393px and measure any
`.q-check` row.
Proposed fix: Make the row own the height.
Resolution: Fixed. `.q-check` now has a 24px floor with a 17px control, which
holds the AA minimum for a mouse while keeping the console dense, and a
`pointer: coarse` block takes it to 44px with a 20px control on touch. Padding
rather than centring, so the box still aligns with the FIRST line of an option
that wraps. The publish portal's two checkboxes moved from duplicated inline
styles to a shared `.check-row` at 44px.
Verified by measuring every checkbox on both pages afterwards, at phone and
desktop, with the pointer media feature emulated both ways: 0 below 24px.
Guarded by: no automated test. jsdom performs no layout, so a target size is not assertable there; this needs the axe-in-CI pass that `docs/TESTING.md` still records as unbuilt.
Note: `TasksCard`, `DocActions` and the questionnaire's send-a-copy row use their own checkbox markup and were NOT swept in this change. They are console-side rather than client-facing, and are recorded here rather than silently left.
Effort: S   Risk of fix: Low   Blocks: —
