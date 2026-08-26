# Performance findings — Luminary Console (2026-08-26)

Baseline (production build, authed dashboard): Lighthouse performance 98,
FCP 0.8s, LCP 2.3s, TBT 20ms, CLS 0.016, total JS 144KB transferred. Details in
`BASELINE.md`. The app is fast today because it is small; the findings are about
what stops it staying fast, and where latency already shows.

## Findings

| ID | Severity | Summary |
| --- | --- | --- |
| LC-030 | Medium | Every list surface (dashboard, search, CSV, backup, digest) reads every full client record; no pagination or table virtualization. O(N) per page load, unbounded growth. |
| LC-031 | Medium | The proxy refreshes the revoked-sid list from R2 inline on a user request once a minute per instance; measured 855ms of proxy time on the baseline dashboard load. |
| LC-032 | Medium | Every PDF render launches a fresh headless Chromium; stage-2 launches three sequentially. Dominates client-create and re-draft latency. |
| LC-033 | Low | `fetchAsset` buffers whole objects; email paths buffer all attachments concurrently. |

## Additional observations (below finding threshold)

- **PDF render waits are partly unbounded.** The A4 path awaits
  `document.fonts.ready` with no timeout (`lib/pdf.ts:211`); a hung font fetch
  holds the render until the 120s protocol timeout. The laptop path bounds its
  waits; the A4 path should too.
- **Cascade regenerate is up to four sequential Claude calls** inside one
  300s-capped route (`app/api/clients/[slug]/docs/[type]/route.ts:96-114`). A slow
  pass times the route out with the record un-saved (assets written, pointer
  updates lost). Belongs on a queue (LC-024).
- **Ops-via-Actions adds 30-60s runner spin-up** to every business mutation when
  enabled (`lib/ops-fetch.ts` doc). This is a deliberate receipt-for-every-action
  trade; worth an ADR when the flag is on by default.
- **The 5s per-instance store cache** collapses same-render read bursts well; it
  is the right shape until a real database lands.
- **No bundle budget or Lighthouse CI** enforce the section-10 targets (LC-053).
  Current first-load JS (144KB transferred) is inside the 200KB budget.
- **Polling:** the console pages poll `/api/ping` every 5 minutes per tab
  (SessionGuard) — negligible. There is no data polling; freshness relies on
  `router.refresh()` after actions and full navigations (relevant to the
  section-6.5 real-time build, LC-063).

## Against the section-10 budgets

| Metric | Target | Today |
| --- | --- | --- |
| First load, main route | < 1.5s warm | FCP 0.8s / LCP 2.3s (LCP over; driven by server render + record reads, LC-030/031) |
| Route transition | < 200ms | Sub-200ms observed on warm dev for cached routes; unmeasured in CI |
| INP | < 150ms | TBT 20ms suggests healthy; unmeasured field data |
| 1,000-row list at 60fps | virtualized | Not virtualized (LC-030) |
| API p95 | < 200ms | Reads 200-560ms cold (R2 round trips); no measurement infrastructure (LC-054) |
| Initial JS gzipped | < 200KB | ~144KB transferred |
| Lighthouse perf | ≥ 90 | 98 |
| Lighthouse a11y | 100 | 96 (LC-040) |
