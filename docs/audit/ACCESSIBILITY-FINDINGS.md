# Accessibility findings — Luminary Console (2026-08-26)

Floor per the mandate: WCAG 2.2 AA, zero axe violations as a merge gate.
Baseline: Lighthouse accessibility 96 on the authed dashboard (production
build). No axe tooling exists in the repo (LC-052/053), so this pass combines
the Lighthouse run with a manual read of every component.

## Findings

| ID | Severity | Summary |
| --- | --- | --- |
| LC-040 | Medium | Table headers, `.k` labels, and meta labels use `--subtle` for small text: ~1.9:1 in light, well under AA in dark. This is the Lighthouse color-contrast failure. |
| LC-041 | Medium | Sortable column headers are bare `<th onClick>` — not focusable, no `aria-sort`, unusable by keyboard or screen reader. |
| LC-042 | Medium | No skip link and no `:focus-visible` styles in the console (the landing page has both); focus is browser-default and inconsistent. |
| LC-043 | Low | No live regions for async state (saves, answers, busy states); several controls labelled by adjacent spans rather than associated labels. |
| LC-059 | Low | Sinhala questionnaire keeps `<html lang="en">`; only `<main>` carries `lang="si"`. Failure-path strings remain English. |

## Component-level notes

- **ConfirmDialog** (`components/ConfirmDialog.tsx`): has `role="dialog"`,
  `aria-modal`, Escape-to-close, and autofocus — good — but no focus trap (Tab
  walks out of the dialog into the page) and focus is not returned to the
  trigger on close.
- **CommandPalette** (`components/CommandPalette.tsx`): no dialog semantics
  (no `role`, no `aria-modal`), no `aria-activedescendant`/listbox pattern for
  the results, and keyboard selection covers only the name results, not the
  content-search results below them.
- **AppTabBar / QuestionnaireSheet / PortalProgress**: good — `aria-current`,
  `aria-pressed`, `role="group"`, `aria-label`, and screen-reader step state
  (`.pstep-sr`) are all present.
- **Status pills rely on text plus a colored dot** — not hue alone — which
  satisfies the colorblind-safe rule; keep that pattern in the rebuild.
- **Icon-only controls** (`.task-x`, `.q-file-x`) carry `aria-label`s — good.
- **Reduced motion**: the modal animation and theme wipe honor
  `prefers-reduced-motion`; the button hover transforms do not, but are under
  the threshold where it matters.
- **`<a>` styled as buttons and buttons styled as links** are mixed in
  PortalDesigns (`Select this ✓` is a button-as-link — acceptable) and
  BillingCard (`HTML ↓` download link) — semantics are mostly right.
- **Heading order** is generally `h3`-in-cards without an `h1`/`h2` on console
  pages (the brand div is not a heading); a proper landmark/heading structure
  is part of the Phase 2 shell work.
- **Zoom/viewport**: no horizontal overflow at 360px in the baseline
  screenshots; inputs bump to 16px under 820px to prevent iOS zoom — good.

## Merge-gate work (Phase 1/2)

1. Fix token contrast for small text (LC-040) and re-run Lighthouse to 100.
2. Keyboard-operable sorting with `aria-sort` (LC-041).
3. Skip link + focus-visible ring ported from the landing page (LC-042).
4. Live regions for async status; associate all labels (LC-043).
5. Add axe to unit tests and Playwright as the merge gate (with LC-052/053).
6. Focus trap + focus return in ConfirmDialog; dialog semantics and
   activedescendant pattern in the palette.
