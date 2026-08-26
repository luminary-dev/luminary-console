# Remediation plan (2026-08-26)

Findings grouped into ordered work batches with dependencies. Batches inside a
phase can run in parallel unless a dependency is named. Every batch ends with a
green build, a regression test naming the finding IDs it closes, and a commit
referencing them.

The mandate's rule "fix before you feature" is applied per area, with one
deliberate exception called out in Batch 4.

---

## Phase 1 — Stabilize (fix every Critical and High)

**Batch 1.1 — Testing and CI harness** *(no dependencies; everything else
depends on it)*
Closes: LC-052, LC-053 (partly), plus the harness for all regression tests.
- Vitest + Testing Library; Playwright; MSW for the Anthropic/Resend/Cloudflare/
  Vercel/GitHub boundaries; Testcontainers only once Postgres lands (Batch 4.1).
- ESLint (typescript, react-hooks, jsx-a11y, security, no-unsanitized) and a
  `lint` script.
- CI: lint, typecheck, unit, build, axe, bundle budget, Lighthouse CI. Keep the
  existing `Build` job name (it is a required check in the branch ruleset).
- Mark the five live-fire suites opt-in (`test:live:*`) so they cannot run by
  accident.
*Acceptance*: CI runs the new gates on a PR; a deliberately broken test fails it.

**Batch 1.2 — Store integrity** *(depends on 1.1)*
Closes: LC-001, LC-002 (mitigation), LC-015.
- `getIndex` distinguishes absent from unreadable; `saveClient` refuses to write
  an index it could not read intact. Regression test: corrupt index + save must
  not truncate.
- Conditional writes (ETag `If-Match` + bounded retry) on `saveClient`,
  `writeIndex`, `nextDocNoBase`, and the OTP record. Full CAS everywhere is
  superseded by Batch 4.1, so this is the interim guard, not the final answer.
- Test: two concurrent saves; neither is silently lost.

**Batch 1.3 — Session and auth hardening** *(depends on 1.1)*
Closes: LC-010, LC-011.
- Logout revokes the sid; the proxy requires the sid to exist in the live
  registry (registry becomes an allowlist). Everyone re-authenticates once.
- argon2id/scrypt for operator passwords; keyed HMAC for OTP records. Provide a
  one-time migration path for `CONSOLE_USERS` entries.
- Tests: replay-after-logout must 401; a token whose sid is unregistered must
  401.

**Batch 1.4 — Headers and CSP** *(depends on 1.1; touches every inline script)*
Closes: LC-012.
- Per-request nonce in the proxy; strict CSP (`script-src 'nonce-…'`,
  `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`); COOP, CORP;
  HSTS `preload`.
- Rework the three inline-script sites: `app/layout.tsx` theme script, the
  document shell's theme/accept/sign scripts, and the `onclick` attribute in
  `lib/templates/shell.ts`.
- Note: newly rendered documents get the new shell; existing stored renders keep
  theirs (they are immutable by design). Re-render deliberately excludes
  eco-mech (it rotates asset URLs and re-flags the client's portal).

**Batch 1.5 — Error boundaries and error taxonomy** *(depends on 1.1)*
Closes: LC-020, LC-005.
- `error.tsx` per segment + `global-error.tsx` with a real fallback and retry.
- One typed error taxonomy, RFC 9457 problem details on the wire, a single
  mapper; stop returning `String(e)`.

**Batch 1.6 — Money semantics decision** *(depends on 1.1; needs an owner
decision, see "Questions" in the summary)*
Closes: LC-003.
- Decide the intended definition of outstanding; implement per-invoice
  attribution, surface unattributed payments and overpayment; ADR recording the
  change because it moves numbers already on screen.

**Batch 1.7 — Quick correctness and convention fixes** *(depends on 1.1)*
Closes: LC-021, LC-022, LC-023, LC-025, LC-050, LC-051, LC-055, LC-057,
GAP-3.4a, UX-21.
- Questionnaire draft autosave to `localStorage` (the highest-value single fix
  for clients).
- AbortController on the palette search; live-ticking relative time.
- Clear `deliveredAt` when the final receipt is unpublished.
- Strip authored emojis; replace em/en dashes in UI copy; delete `_gen.mjs` and
  `_poll.mjs`; `npm audit fix` + dependency bumps + pinned versions +
  `DEPENDENCY-MANIFEST.md`.
- 401 from a data fetch routes to login; SessionGuard skips its ping on
  `/login`.

*Phase 1 acceptance*: zero Critical/High open; every fix has a failing-then-
passing test naming its ID; CI green; `BASELINE.md` re-measured.

---

## Phase 2 — Foundation (design system and shell)

**Batch 2.1 — Design tokens and UI package**
Closes: LC-065, and the a11y token work in LC-040.
- `packages/design-tokens` exporting the `DESIGN-LANGUAGE.md` set as TS, CSS
  custom properties, a Tailwind preset, and a shadcn theme; fix small-text
  contrast to AA as part of the token pass.
- `packages/ui` on shadcn/ui + `lucide-react`; Storybook.

**Batch 2.2 — App shell, palette, keyboard system**
Closes: LC-064, UX-01, UX-02, UX-60, UX-62, UX-64.
- Left nav + top bar (search, freshness/connection, notifications), command
  palette as a real action surface, keyboard system with a shortcut sheet,
  Sonner toasts, `nuqs` URL state, density control.

**Batch 2.3 — Accessibility sweep**
Closes: LC-040, LC-041, LC-042, LC-043; axe as a merge gate.
- Skip links, focus-visible rings, keyboard-operable sorting with `aria-sort`,
  live regions, label association, dialog focus trap and focus return.

**Batch 2.4 — Strangler scaffolding**
- Feature flags, `MIGRATION-PLAN.md`, the workspace split (`web`, `worker`,
  `ui`, `schema`, `config`, `testing`) with the existing app still serving.

---

## Phase 3 — Access model (section 4)

**Batch 3.1** — GitHub OAuth + org check + numeric-ID allowlist, two roles,
server-side sessions (completing LC-010 properly), step-up auth, break-glass,
immutable audit log with before/after, admin UI. Closes LC-061, GAP-3.5a.
*Depends on*: 2.4 (flags), 1.3 (session model).

---

## Phase 4 — GitHub ingestion (section 6.1) and the database

**Batch 4.1 — Postgres + Drizzle + Redis** *(the deliberate exception to
"fix before you feature": LC-002's full fix is this migration, not more CAS
patches on flat files)*
Closes: LC-002 (fully), LC-062, LC-030 (with pagination), LC-013 (shared
rate-limit store), LC-031 (session/revocation lookups).
- Expand-and-contract migration of records, index, and state files; seed script;
  tested rollback.

**Batch 4.2 — Zod at every boundary** — closes LC-004; prerequisite for
consuming GitHub payloads.

**Batch 4.3 — GitHub App, webhook inbox, idempotent processing, dead letter +
replay, backfill, reconciliation, hardened API client** — closes LC-060.
Webhook HMAC over the raw body with a regression test that fails if raw-body
handling regresses (section 5).

**Batch 4.4 — Observability** — closes LC-054, LC-017 (redaction lands with the
logger). Structured logs + correlation, OpenTelemetry, Sentry, metrics, alerts
to Slack with runbook links.

---

## Phase 5-7 — Product build

PR workspace (6.2), real time and notifications (6.4/6.5, closes LC-063), and
beyond-PRs (6.3). Performance work rides along: virtualization and pagination
(LC-030), warm-browser rendering or worker offload (LC-032, LC-024), streaming
reads (LC-033).

---

## Phase 8 — UX overhaul

Work through `UX-AUDIT.md` end to end: UX-03/04/05/06/07, UX-10 through UX-16,
UX-20/22, UX-30/31/32, UX-40/41/42, UX-50/51, UX-61/63/65. Motion pass and the
full a11y sweep re-run.

---

## Phase 9 — Hardening and operations

Remaining section-5 items: SSRF-hardened fetch client, envelope encryption for
third-party tokens, CSRF (LC-014), supply-chain tooling completion (LC-057),
`SECURITY.md`. Plus LC-066 (IaC, containers, previews, **tested restore drill**
with documented RPO/RTO), LC-058 (orphan GC cron), runbooks.

---

## Phase 10 — Polish and handover

Remaining Medium/Low: LC-016 (sandbox design previews), LC-024 (idempotency),
LC-033, LC-056 (strict TS flags), LC-059 (i18n completion), LC-067 (docs),
GAP-3.2a/3.2b/3.3a/3.9a, and the tech-debt list items 11-19.

---

## Dependency graph (critical path)

```
1.1 testing/CI
 ├─→ 1.2 store integrity ──────────────→ 4.1 Postgres ──→ 4.2 Zod ──→ 4.3 GitHub ingestion
 ├─→ 1.3 sessions ─────→ 3.1 access model ──────────────↗
 ├─→ 1.4 CSP
 ├─→ 1.5 error boundaries
 ├─→ 1.6 money decision (owner input)
 └─→ 1.7 quick fixes
2.1 tokens → 2.2 shell → 2.3 a11y gate
2.4 strangler → 3.1
4.1 → 4.4 observability → phases 5-7
```

## Suggested first commit sequence

1. `test: stand up vitest, playwright, eslint and the CI gates (LC-052, LC-053)`
2. `fix(store): refuse to write a truncated client index (LC-001)`
3. `fix(auth): revoke the session on logout and require a registered sid (LC-010)`
4. `fix(ux): persist questionnaire answers across a refresh (LC-021)`
5. `chore(deps): patch nanoid advisory and pin exact versions (LC-057)`
