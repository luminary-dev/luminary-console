# Dependency audit — Luminary Console (2026-08-26)

Resolved with `npm ls` / `npm outdated` / `npm audit` on the installed tree.
Versions are what is installed; "latest" is the registry latest on the audit
date. A pinned `DEPENDENCY-MANIFEST.md` with per-package resolution dates is
Phase 1 work (section 1.6); this is the audit snapshot.

## Runtime dependencies

| Package | Installed | Latest | Used in | Notes |
| --- | --- | --- | --- | --- |
| next | 16.3.0 | 16.3.3 | whole app | Patch behind; upgrade is low-risk. |
| react / react-dom | 19.2.8 | 19.2.8 | whole app | Current. |
| @anthropic-ai/sdk | ^0.115.0 | 0.120.0 | `lib/generate.ts`, `lib/publish/draft.ts`, assist route | Behind; uses the `beta.messages.stream` + `output_config` + server-side-fallback beta. Pin exactly and track the beta header. |
| @aws-sdk/client-s3 | ^3.1105.0 | 3.1118.0 | `lib/r2.ts`, `lib/store.ts` | R2 over S3. Behind by patch train. |
| @aws-sdk/s3-request-presigner | ^3.1105.0 | 3.1118.0 | `lib/store.ts` | Presigned GET/PUT. |
| @sparticuz/chromium | ^149.0.0 | (149 line) | `lib/pdf.ts` | Serverless Chromium; must stay version-matched to puppeteer-core. |
| puppeteer-core | ^25.5.0 | 25.9.0 | `lib/pdf.ts` | Behind; keep aligned with @sparticuz/chromium's Chrome revision. |
| resend | ^6.18.1 | 6.22.1 | `lib/email.ts` | Behind. |
| web-push | ^3.6.7 | (3.6 line) | `lib/push.ts` | Pulls in `nanoid` (see advisory). |

## Dev dependencies

| Package | Installed | Latest | Notes |
| --- | --- | --- | --- |
| typescript | ^6.0.3 | 7.0.2 | Major behind. TS 7 upgrade is a deliberate, tested step. |
| tsx | ^4.19.0 | 4.23.12 | Runs scripts + the live QA suites. |
| @types/node | ^26 | 26.3.0 | |
| @types/react / @types/react-dom | ^19 | 19.2.x | |
| @types/web-push | ^3.6.4 | current | |
| dotenv | ^17.0.0 | current | Scripts only. |

## Vulnerabilities

- **1 high (transitive):** `nanoid <3.3.18` — GHSA-2v37-7h3g-55p8 (custom
  generators can loop indefinitely when size is zero). Reaches the tree via
  `web-push`. `npm audit fix` resolves it; verify web-push still functions.
  (LC-057.)

## Usage / footprint observations

- **Every runtime dependency is actually used** (grep-confirmed): no dead
  runtime deps. `BLOB_READ_WRITE_TOKEN` remains in `.env.local` but
  `@vercel/blob` is already removed — the env var is dead and can go.
- **The ZIP writer is hand-rolled** (`lib/zip.ts`) rather than depending on a
  library — a deliberate "20 lines of our own code" choice the mandate endorses.
- **The tar extractor is hand-rolled** (`lib/deploy.ts`) for the same reason;
  worth a unit test given it parses untrusted archives.
- **No lockfile-integrity or supply-chain tooling** (Renovate, Gitleaks, Trivy,
  SBOM, Cosign, provenance) — all absent (LC-057). `package-lock.json` is
  committed.
- **License review**: all listed packages are MIT/Apache-2.0/BSD (permissive);
  no copyleft or unusual licenses in the direct set. A generated SBOM should
  confirm transitively.
- **Version ranges use `^`** across the board; the mandate wants exact pins with
  a committed lockfile and a recorded resolution date. Pin in Phase 1.

## Recommended actions (Phase 1)

1. `npm audit fix` for the `nanoid` advisory; re-run the ops QA suite.
2. Bump next, @anthropic-ai/sdk, aws-sdk pair, resend, puppeteer-core (+ matched
   chromium) to latest; verify build + PDF render + a drafting call.
3. Pin exact versions, commit the lockfile, write `docs/DEPENDENCY-MANIFEST.md`
   with resolution dates.
4. Add Renovate, Gitleaks + push protection, Trivy, CycloneDX SBOM per build.
5. Remove the dead `BLOB_READ_WRITE_TOKEN` from env docs.
