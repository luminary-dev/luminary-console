# Interaction and responsiveness findings

Audit date: 2026-08-27. Measured by the Playwright harness in
`tests/interaction/`, against a production build of the console, over HTTPS.
303 checks across 13 widths from 320 to 3440, a 640x360 landscape phone, a
WebKit touch project at iPhone 15 dimensions, a keyboard project, an axe
project and a perf project.

IDs use the `IX-` prefix so they do not collide with the 91 `LC-` findings from
the earlier correctness audit in `docs/audit/FINDINGS.md`. Where the two
overlap it is noted.

Every number below was measured, before and after. None is an estimate.

## Summary

| Measure | Before | After |
| --- | ---: | ---: |
| axe violations (WCAG 2.0/2.1/2.2 A and AA) | 486 nodes | **0** |
| Horizontal overflow, 234 route-and-viewport measurements | 1 | **0** |
| Keyboard stops with no visible focus ring | 37 | **0** |
| Unguarded `:hover` rules | 15 | **0** |
| Overlay focus-trap leaks, worst | 15 of 15 tabs | **0** |
| Overlays applying scroll lock | 0 of 6 | **6 of 6** |
| Overlays returning focus to `document.body` | 6 of 6 | **0 of 6** |
| Targets failing WCAG 2.5.8 | 242 | **91** |
| Targets under Apple's 44px | 665 | **261** |
| Worst CLS on load | 0.0000 | 0.0091 |
| Routes answering 200 with no error boundary | 234 of 234 | 234 of 234 |

Severity counts: Critical 0, High 4, Medium 6, Low 2. Twelve findings, eleven
fixed and one partially fixed.

---

### IX-001 — One accent token failed contrast on every surface, 480 times
Severity: High
Category: Colour and contrast
Location: `app/globals.css` (`--a-text`, `--muted`, light theme)
Devices: All, both themes measured
Evidence: axe reported 486 failing nodes across 17 routes. Three colour pairs
account for 483 of them, and two tokens account for all three:
`#5a9e08 on #ffffff = 3.31:1`, `#5a9e08 on #f4faea = 3.11:1`, and
`#6b7280 on #f0f0ee = 4.23:1`. AA requires 4.5:1.
The worst surface is not white. `--a-dim` composited over `--desk` is
`#e6eddb`, where the old accent managed **2.91:1**.
Reproduction: Load any console route in the light theme and run axe.
Impact: The accent text colour is used for every link, every active pill and
every positive status in the console, so a single token put most of the
product below AA. Dark theme was already fine (12.20:1 worst), which is
exactly why it survived review: whoever checked it was in dark mode.
Fix: `--a-text` is now `#3f7305` and `--muted` is `#636a75`, both solved
against the worst surface rather than against white. `--accent` is unchanged
at `#84cc16` for fills, borders and glyphs, where contrast rules do not apply.
Verified 4.77:1 at worst across `--bg`, `--off`, `--desk` and each of those
under the accent tint.
Resolution: **Fixed.** 486 axe nodes to 17 from this change alone.
Related: LC-040 fixed table-header contrast in the earlier audit and missed
this, because that pass checked the elements axe named rather than the token
behind them.

### IX-002 — Every text input lost its focus ring to a later `outline: none`
Severity: High
Category: Keyboard
Location: `app/globals.css:213`
Devices: All, keyboard users
Evidence: 37 of the measured tab stops had no visible focus indicator: 30 of
the 60 walked on the client questionnaire, plus at least one on `/login`,
`/publish`, `/`, `/clients/new`, `/clients/eco-mech`, `/github` and
`/c/eco-mech`. Every one was an `input`, `textarea` or `select`.
The `:focus-visible` block at line 47 sets `outline: 2px solid var(--accent)`
and looks correct. `.q-line:focus { outline: none }` at line 213 carries
identical specificity, one class plus one pseudo-class, and comes later, so it
wins. `.q-line:focus-visible` then set only `outline-offset`, offsetting an
outline that no longer existed.
Reproduction: Tab to any text field and look for a ring.
Impact: WCAG 2.4.7 fails outright. The only remaining focus signal was the
bottom border changing colour, which also fails 1.4.11 as a colour-only
indicator. The client questionnaire, 30 fields filled in by clients, had no
keyboard focus indicator at all.
Fix: the outline is restated after the rule that clears it, for
`.q-line`, `.q-box` and `select.q-line`. `outline: none` on plain `:focus`
stays, so a mouse click still draws nothing.
Resolution: **Fixed.** 37 to 0.

### IX-003 — Ten form controls had no accessible name
Severity: High
Category: Forms
Location: `app/login/page.tsx`, `app/clients/new/page.tsx`, `components/PublishStudio.tsx`
Devices: All, screen reader users
Evidence: axe rule `label`, impact critical, 10 nodes. The pattern was
`<div class="q-field"><span class="q-label">Email</span><input></div>`: the
label was a span in a div, associated with nothing.
Impact: A screen reader announces "edit text, blank" for the sign-in email and
password fields, and for six fields on new-client creation. Sign-in is the one
screen nobody can route around.
Fix: the wrapper is a `<label>`, so the association is implicit. Two wrappers
that also contain a hint block use `useId` with `htmlFor` and
`aria-describedby` instead, because an implicit label would have swallowed a
sixty-word hint into the accessible name.
Resolution: **Fixed.** 10 to 0.

### IX-004 — Focus escaped every overlay
Severity: High
Category: Overlays
Location: `components/ConfirmDialog.tsx`, `components/CommandPalette.tsx`
Devices: Chromium and WebKit, differently
Evidence: tabbing 15 times from inside an open overlay let focus reach the
background page. Command palette: 15 of 15 in Chromium, 10 of 15 in WebKit.
Both confirmations: 7 of 15 in WebKit, 0 in Chromium.
The split has a precise cause. The palette had no trap at all. The
confirmations had one that only intervened at the boundary and let the engine
choose the interior stop, and **WebKit does not put `<button>` in the default
tab order**, so from Cancel it skipped Confirm and left the dialog, and the
trap dragged it back. Alternating over 15 presses is exactly 7.
Impact: A trap that holds in the browser you develop in and leaks in the one
your clients use is worse than none, because it is invisible until someone
else reports it.
Fix: a shared `useOverlayBehaviour` hook. Tab is always cancelled and the next
stop chosen in JS rather than deferred to the engine, the focusable set is
recomputed on every Tab so a filtering palette list cannot go stale, and a
`focusin` guard catches any other escape route.
Resolution: **Fixed.** Worst case 15 to 0, in both engines.

### IX-005 — No overlay locked background scroll
Severity: Medium
Category: Overlays
Location: `components/ConfirmDialog.tsx`, `components/CommandPalette.tsx`, `app/globals.css`
Evidence: `scrollLockApplied` was false for all six measured overlay-and-engine
combinations. The page behind scrolled freely with a modal open.
Impact: Scrolling inside a dialog that reaches its end scrolls the page behind
it, so the dialog drifts away from the thing it is about.
Fix: refcounted scroll lock in the shared hook, so stacked overlays release
correctly. `scrollbar-gutter: stable` on `html` holds the gutter open
permanently, so locking cannot change the layout width. The measured
`layoutShiftFromScrollLock` stayed at 0 and did not regress.
Resolution: **Fixed.** 0 of 6 to 6 of 6.

### IX-006 — Focus returned to `document.body`, not the trigger
Severity: Medium
Category: Overlays
Location: `components/ConfirmDialog.tsx`, `components/CommandPalette.tsx`
Evidence: `focusReturnedToBody` was true for all six combinations.
The WebKit case has the same root cause as IX-004: Safari does not focus a
button on click, so `activeElement` inside the handler was already `<body>`,
the dialog stored the body as its trigger, and `body.focus()` on close did
nothing.
Impact: Closing a dialog drops a keyboard user back at the top of the
document, so they tab through the whole page to get back to where they were.
Fix: the trigger is recovered from a tracked pointer-down target when
`activeElement` is the body, with a fallback to `#main-content` and a polite
announcement when the trigger is gone.
Resolution: **Fixed.** 6 of 6 to 0 of 6.

### IX-007 — Every hover rule in the console was unguarded
Severity: Medium
Category: Touch
Location: `app/globals.css`, `components/github/github.css`, `components/github/github-views.css`
Devices: All touch
Evidence: 15 `:hover` rules, none behind a hover-capable media query. That is
every hover rule in the product.
Impact: A touch device applies the hover style on tap and leaves it applied
until something else is tapped, so a row a finger brushed past stays lit and
reads as selected.
Fix: each stylesheet has one `@media (hover: hover) and (pointer: fine)` block.
Rules combining hover with a persistent state, the sorted-column header and
the active tab bar item, are split so the persistent half still applies on
touch.
Resolution: **Fixed.** 15 to 0.
Note: no hover-*only* affordances were found. The row-action pattern section
3.3 warns about does not exist here.

### IX-008 — 242 targets failed the WCAG target size minimum
Severity: Medium
Category: Touch
Location: `app/globals.css`, plus `components/PublishStudio.tsx` and the questionnaire (see LC-091)
Evidence: measured on WebKit at iPhone 15 dimensions. 665 targets under
Apple's 44px, of which 242 failed WCAG 2.5.8's 24x24 including its spacing
exception. Worst offenders: sort buttons 16px tall, workflow links 10px wide,
document links 23x19.
Fix: a `@media (pointer: coarse)` block gives buttons, inline table controls,
stream links and portal actions a 44px minimum height and a 24px minimum
width. Desktop density is deliberately untouched: this console exists to be
dense, and the growth happens only where a finger is the input device.
`min-width` matters as much as height and is the half usually forgotten: a
workflow named "ci" renders a 10px-wide link, tall enough after the height
rule and still an impossible target.
Resolution: **Partially fixed.** 242 to 91.
Of the 91 remaining, **64 are the client questionnaire's checkboxes, already
fixed in the open pull request for LC-091** and absent from this branch. The
rest are dense table controls where growing the box further would change the
console's information density, and they are recorded here rather than forced:
they need a design decision, not a CSS rule.

### IX-009 — A git ref pushed the deployments page sideways at 320px
Severity: Low
Category: Layout
Location: `components/github/github-views.css` (`.gh-env-now`)
Evidence: the single horizontal overflow across 234 measurements.
`/github/deployments` scrolled 15px at 320px, caused by a 30-character
unbreakable ref rendered in a `<b>`.
Impact: the narrowest realistic phone, on one page.
Fix: `overflow-wrap: anywhere` on that element only. Targeted rather than
blanket, so ordinary branch names still break at their slashes.
Resolution: **Fixed.** 1 to 0.

### IX-010 — Delete buttons hardcoded the dark theme's red
Severity: Low
Category: Colour and contrast
Location: `components/BillingCard.tsx`, `components/DocActions.tsx`, `components/SiteCard.tsx`, `components/DeleteClient.tsx`
Evidence: `#ef4444` inline, 3.76:1 on white. That value is the dark theme's
`--danger`; light theme's is `#dc2626` at 4.83:1.
Impact: the two axe nodes left after IX-001, on the most destructive control
in the product.
Fix: `var(--danger)` and `color-mix` for the derived border and background, so
both themes resolve correctly.
Resolution: **Fixed.**

### IX-011 — A note beside a `<dd>` invalidated four definition lists
Severity: Low
Category: Semantics
Location: `components/github/InsightPanel.tsx`
Evidence: axe rule `definition-list`, 4 nodes on `/github/insights`. A `<dl>`
may contain only dt/dd groups, and axe applies the same restriction inside a
`<div>` child. The explanatory `<p>` sat beside the `<dd>` rather than inside
it.
Fix: the note moved inside the `<dd>`. Renders identically.
Resolution: **Fixed.**

### IX-012 — A portal link was distinguished by colour alone
Severity: Low
Category: Colour and contrast
Location: `components/PortalProgress.tsx`
Evidence: axe rule `link-in-text-block`, 1 node on the client portal. A
`mailto:` link inside a paragraph, with the global `a { text-decoration: none }`
removing its underline.
Fix: an explicit underline on that link.
Resolution: **Fixed.**

---

## Retracted: two findings that were the harness, not the console

Recorded because a false positive that is quietly deleted teaches nobody, and
both were caught only by checking rather than filing.

**"Skip link not visible on focus, 16 of 17 routes."** The skip link animates
in over 160ms. The probe measured at 0ms and caught it at `translateY(-75px)`.
Measured again at 200ms it sits correctly at `top: 12px` on every route. The
probe now settles after each Tab.

**"33 routes answered HTTP 500 at wide viewports."** This machine lost DNS to
the R2 endpoint midway through a sweep. The console was fine. The viewport
spec now inspects a 5xx body for a resolver error and declares the run invalid
rather than filing findings against innocent code.

## Not covered by this pass

Written down rather than implied. The harness does not yet exercise:
click-outside protection on dirty forms, overlay nesting, popover collision
near viewport edges, toast stacking and timers, virtual keyboard behaviour,
route change with an overlay open, browser zoom to 400 percent, text-only
scaling, `prefers-reduced-motion`, forced-colors mode, print, or Firefox.
Section 3.6's debounce, cancellation, optimistic rollback and race conditions
are also unmeasured: the perf project covers load-time and single-click
latency only, which came back healthy at 32ms worst against a 150ms budget.
