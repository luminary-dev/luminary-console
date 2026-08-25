# Edge case matrix — current behavior (2026-08-26)

Section 3 of the mandate, with what the code does **today**. Verified by reading
the responsible code path and, where marked (probed), by exercising it against
the running app read-only. Rows marked GAP become tests in Phase 1+.

Legend: OK = correct today · PARTIAL = handled but incompletely · GAP = wrong or
unhandled · N/A = the feature does not exist yet (Phase 4+ scope).

## 3.1 Data shape and volume

| Case | Today | Ref |
| --- | --- | --- |
| Empty state on every list | OK — every card has a written empty state (clients, tasks, comments, emails, activity, designs, billing, payments) | — |
| Exactly one item | OK (probed: one client renders correctly everywhere) | — |
| Pagination boundary | N/A — nothing paginates; lists are unbounded | LC-030 |
| Ten thousand items | GAP — dashboard reads every record, table unvirtualized | LC-030 |
| Null / undefined / empty / whitespace field | PARTIAL — optional record fields are guarded (`?? "—"`), but AI doc data is cast unvalidated, so a missing `items` throws in the renderer | LC-004 |
| Zero as value vs absence | PARTIAL — `parseAmount` accepts 0; `summarizeMoney` clamps negatives, hiding overpayment | LC-003 |
| Negative numbers | OK — payments reject `<= 0` (400) | — |
| Very large numbers | OK — payments cap at 1e9 | — |
| Floating point money | PARTIAL — payments round to 2dp; doc totals are strings; change orders are strings | debt #8 |
| Deeply nested / arrays of arrays | OK — doc `data` is opaque JSON, rendered by known shape | — |
| Duplicate IDs in a list | PARTIAL — design ids and billing slugs are server-assigned and unique; activity entries have no id (keyed by `at|target|action`) | — |
| Items out of order | OK — lists sort explicitly (activity newest-first, docIndex oldest-first) | — |

## 3.2 Text and internationalization

| Case | Today | Ref |
| --- | --- | --- |
| 200-char unbroken string | OK — `overflow-wrap: anywhere` on document text, `.copy-url` breaks, `word-break` in cards; 360px baseline shows no overflow | — |
| Long branch/repo names | OK (same rules) | — |
| RTL text | GAP — no `dir` handling anywhere | — |
| Combining / zero-width characters | PARTIAL — stored and rendered as-is; no normalization | — |
| Emoji incl. ZWJ/skin tone in third-party data | PARTIAL — React renders them safely; but truncation uses `.slice()` on UTF-16 units (`app/c/[slug]/comment/route.ts:63,71`, `assist` clip, `tgEsc` slices), which can split a surrogate pair or ZWJ sequence | GAP-3.2a |
| HTML/markdown injected into a title | OK — React escapes; emails use `esc()`; `tgEsc` escapes Telegram HTML | — |
| Script tags in a body | OK for stored client text (escaped everywhere it renders) | LC-016 for uploaded design HTML |
| Null bytes | PARTIAL — accepted into strings; JSON-safe; not stripped | — |
| Unicode direction-override characters | GAP — not stripped; could disguise text in the console or a document | GAP-3.2b |
| Non-Latin-1 company name in a header | OK — PDF `Content-Disposition` uses ASCII fallback + RFC 5987 (Wave 6 B29) | — |

## 3.3 Time

| Case | Today | Ref |
| --- | --- | --- |
| Three users in different timezones | OK — all display formats pin `Asia/Colombo`; storage is ISO UTC | — |
| DST transitions | OK — Colombo has no DST; UTC storage is safe | — |
| Server/client clock disagreement | PARTIAL — `relTime` takes `now` from the server, so no client-clock skew in relative labels; future timestamps clamp to "just now" | — |
| Timestamps in the future | OK — clamped | — |
| Very old timestamps | OK — past 14 days falls back to an absolute date | — |
| Duration across boundaries | OK — minute/hour/day thresholds in `relTime` | — |
| Relative times updating live | GAP — computed once at render, never ticks | LC-023 |
| Date range end before start | N/A — no range pickers |
| Sorting by a nullable date | OK — `(a.due \|\| "9999-99-99")` sentinel; activity sorts by ISO string | — |
| Date-only due dates vs UTC "today" | PARTIAL — `today()` derives from UTC ISO slice, compared to a Colombo-intent date: off by one near midnight | GAP-3.3a |

## 3.4 Network and failure

| Case | Today | Ref |
| --- | --- | --- |
| Offline at load | GAP — no offline state; service worker deliberately does not cache | LC-020 |
| Offline mid-action | PARTIAL — fetches `.catch(() => null)` in most cards and show an error; NotesCard shows "Not saved — retry" and keeps the text | — |
| Flaky / Slow 3G | PARTIAL — busy states everywhere; no timeouts or retries on client fetches | — |
| Request timeout | GAP — no client-side timeout; server routes cap at `maxDuration` | — |
| 500 / 502 / 503 / 429 / 401 / 403 / 404 / 409 / 422 | PARTIAL — routes return correct codes and the UI surfaces `error` strings; 401 mid-session does not redirect to login from a fetch (only SessionGuard's ping catches it) | GAP-3.4a |
| HTML returned where JSON expected | OK — every `res.json().catch(() => null)` guards it | — |
| Valid JSON of the wrong shape | GAP — no schema validation on responses | LC-004 |
| Response after unmount | GAP — no AbortController anywhere; state set after unmount is possible | LC-022 |
| Two responses out of order | GAP — palette search has no cancellation | LC-022 |
| Request cancelled by navigation | PARTIAL — browser cancels; no cleanup logic | — |
| Retry storms | OK — no automatic retries exist (nothing to storm) | — |
| Backend deployed mid-session | GAP — no build-id check or reload prompt | — |

## 3.5 Authentication and session

| Case | Today | Ref |
| --- | --- | --- |
| Token expires with a form half-filled | GAP — the next mutation 401s and the input is lost (except NotesCard, which keeps its text) | LC-021-adjacent |
| Token expires mid-upload | PARTIAL — presigned PUT is independent of the session, so bytes land; the recording call 401s | — |
| Session revoked from another device | OK — proxy rejects within ~60s | — |
| Logout in one tab, another active | GAP — the other tab keeps working until its next navigation; the token itself stays valid | LC-010 |
| Login in two tabs | OK — pending cookie is per-browser; second login supersedes the device's registry row | — |
| OAuth state mismatch / denial | N/A — no OAuth | LC-061 |
| Clock skew invalidating a token early | PARTIAL — timestamps are server-generated and server-verified, so client skew is irrelevant | — |
| Refresh-token reuse | N/A — no refresh tokens; sliding idle window instead | — |
| User removed from the org while logged in | N/A — no org model; removing an operator from `CONSOLE_USERS` does not revoke live sessions | GAP-3.5a |

## 3.6 Concurrency

| Case | Today | Ref |
| --- | --- | --- |
| Two operators editing the same record | GAP — last write wins, silently | LC-002 |
| Same user in two tabs | GAP — same | LC-002 |
| Double-clicking submit | PARTIAL — buttons disable on `busy`, so the UI prevents it; the API has no idempotency key | LC-024 |
| Double-submit via Enter | PARTIAL — same |
| Rapid toggling a switch | PARTIAL — TasksCard is optimistic with rollback; toggles send an array index that can go stale | LC-002 |
| Mutation landing during a refetch | GAP — no request coordination | LC-002 |
| Optimistic update whose server call fails | OK — TasksCard restores the previous list with a reason | — |
| Webhook before its parent record exists | N/A | LC-060 |

## 3.7 GitHub-specific

Entirely N/A today (LC-060): there is no GitHub App, no webhook ingestion, no
PR/check/deployment model. The only GitHub usage is (a) opening PRs against the
landing repo with a PAT (`lib/publish/github.ts`), (b) fetching a repo tarball
to deploy a client site (`lib/deploy.ts`), and (c) dispatching the ops workflow
(`lib/ghops.ts`). Relevant sub-cases that *do* apply today:

| Case | Today | Ref |
| --- | --- | --- |
| Publish branch already exists | OK — refuses with 409 rather than opening a competing PR | — |
| Slug already published | OK — 409 | — |
| Repo missing / token lacking access | OK — mapped to a readable `manual:` error | — |
| GitHub rate limit / 502 on these calls | GAP — no rate-limit awareness, no retry/backoff, no ETag | LC-060 |
| Ops dispatch token revoked | OK — 502 with a readable message, not a hang | — |
| Ops run never writes a result | OK — relay 504s after 270s with the request id | — |

## 3.8 Browser and environment

| Case | Today | Ref |
| --- | --- | --- |
| Back/forward, back into a form | GAP — form state is in memory; back loses it | LC-021 |
| Deep link to data you cannot access | OK — proxy redirects to login; unknown slug 404s | — |
| Refresh mid-flow | GAP — questionnaire loses everything | LC-021 |
| Bookmarked stale URL | OK — 404 or holding page | — |
| Autofill / password manager | PARTIAL — login uses correct `autocomplete` tokens; other inputs unlabelled for autofill | LC-043 |
| Ad blocker | OK — no third-party scripts to block | — |
| Cookies disabled | GAP — login cannot work; no message explains why | — |
| localStorage full/unavailable | OK — every access is try/caught (theme, lang) | — |
| Reduced motion | PARTIAL — modal + theme wipe honor it; hover transforms do not | — |
| Forced colors mode | GAP — untested, no `forced-colors` styles | — |
| 200% zoom | PARTIAL — layout is fluid; unverified at 200% | — |
| 360px | OK — verified in the baseline screenshots, no overflow | — |
| 3440px | PARTIAL — `.wrap` caps at 1080px, so ultrawide shows a centred column (intentional, but the density mandate wants more) | — |
| Two monitors, different DPI | OK — no raster UI assets | — |
| Tab backgrounded for hours | PARTIAL — SessionGuard idles out at 30 min and redirects to `/login?timedout=1`; stale data otherwise stays on screen with no freshness indicator | — |

## 3.9 Input

| Case | Today | Ref |
| --- | --- | --- |
| Paste formatted HTML into a text field | OK — plain-text inputs; stored escaped | — |
| Paste an image | GAP — not handled (file picker only) | — |
| Drag and drop unsupported type | PARTIAL — no drop zone; the picker filters by type; server re-validates | — |
| 500MB file | OK — client checks 15MB before upload; server signs only the validated length | — |
| Misleading extension | OK — content-type is signed and bound; markup types refused; store forces `attachment` for anything not inert | — |
| Unicode file name | OK — sanitized to a safe charset, length-capped | — |
| Copy from the app, paste elsewhere | PARTIAL — assistant answers copy as plain text; tables copy as raw markup | — |
| Keyboard-only completion of every flow | GAP — sorting is mouse-only; no focus trap in dialogs; no skip link | LC-041, LC-042 |
| Screen reader completion | GAP — no live regions; some unlabelled controls | LC-043 |
| IME composition | GAP — `onChange` fires mid-composition (no `compositionstart/end` handling), relevant for the Sinhala questionnaire | GAP-3.9a |
| 10,000 characters into every input | OK — every text field is length-capped server-side (notes 20k, comments 2k, answers 8k/field, prompt 4k) with a readable error | — |

## New gap IDs raised by this pass

- **GAP-3.2a** — grapheme-unsafe truncation (`.slice()` on UTF-16) in comment,
  assist, notice, and name fields; can split emoji/conjunct clusters.
- **GAP-3.2b** — Unicode bidi/direction-override characters are not stripped
  from client-supplied text rendered in the console and in documents.
- **GAP-3.3a** — date-only due dates compared against a UTC-derived "today";
  off by one near Colombo midnight.
- **GAP-3.4a** — a 401 from a data fetch does not route the operator to login.
- **GAP-3.5a** — removing an operator from `CONSOLE_USERS` does not revoke their
  live sessions.
- **GAP-3.9a** — no IME composition handling on text inputs.
