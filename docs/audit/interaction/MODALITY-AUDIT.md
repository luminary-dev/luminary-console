# Modality audit

Generated 2026-08-27. Touch measurements come from WebKit at iPhone 15
dimensions, which is real Safari rather than Chromium pretending.

## Hover dependency (section 3.3)

Affordances revealed only by hover: **0**.

Unguarded `:hover` rules, which produce sticky hover on touch: **15**.
A touch device applies these on tap and leaves them applied until something
else is tapped, so a row stays lit after the finger has gone.

- `a:hover`
- `.btn:hover`
- `.th-sort:hover, th[aria-sort="ascending"] .th-sort, th[aria-sort="descending"] .th-sort`
- `.q-file-btn:hover:not(:disabled)`
- `.q-file-x:hover`
- `.btn-danger:hover:not(:disabled)`
- `.hist > summary:hover`
- `.task-x:hover`
- `.lang-btn:hover`
- `.app-tab.on, .app-tab:hover`
- `.gh-chip:hover:not(:disabled)`
- `.gh-row:hover`
- `.gh-row-link:hover`
- `.gh-linkbtn:hover`
- `.gh-nav-link:hover`

## Touch targets (section 3.2)

WCAG 2.2 AA 2.5.8 asks 24x24 CSS px, with an exception when neighbours are
far enough apart. Apple's HIG asks 44x44. Both are reported: `<24 AA` counts
only targets that fail the criterion including its spacing exception.

| Route | Targets | <44px | <24px AA | Neighbours under 8px |
| --- | ---: | ---: | ---: | ---: |
| `/github/activity` | 132 | 121 | 49 | 131 |
| `/clients/eco-mech` | 118 | 110 | 42 | 37 |
| `/c/eco-mech/questionnaire` | 131 | 105 | 64 | 2 |
| `/github` | 87 | 85 | 5 | 84 |
| `/github/ci` | 79 | 59 | 22 | 78 |
| `/github/repos` | 47 | 46 | 32 | 43 |
| `/c/eco-mech` | 28 | 21 | 11 | 7 |
| `/` | 25 | 19 | 4 | 8 |
| `/publish` | 17 | 14 | 1 | 0 |
| `/github/deployments` | 15 | 14 | 2 | 14 |
| `/github/luminary-dev/luminary-console/21` | 15 | 14 | 10 | 14 |
| `/github/releases` | 13 | 12 | 0 | 12 |
| `/github/security` | 13 | 12 | 0 | 12 |
| `/github/insights` | 13 | 12 | 0 | 12 |
| `/clients/new` | 12 | 11 | 0 | 0 |
| `/login` | 5 | 5 | 0 | 0 |
| `/activity` | 5 | 5 | 0 | 0 |

**Total: 665 targets under 44px, 242 failing WCAG 2.5.8 outright.**

## Keyboard (section 3.5)

| Route | Tab stops | Order jumps | Stops with no visible ring | Skip link visible on focus |
| --- | ---: | ---: | ---: | --- |
| `/login` | 2 | 0 | 1 | yes |
| `/` | 18 | 0 | 1 | **no** |
| `/clients/new` | 5 | 0 | 1 | **no** |
| `/clients/eco-mech` | 82 | 0 | 2 | **no** |
| `/activity` | 5 | 0 | 0 | **no** |
| `/publish` | 8 | 0 | 2 | **no** |
| `/github` | 33 | 0 | 1 | **no** |
| `/github/repos` | 46 | 0 | 0 | **no** |
| `/github/ci` | 78 | 0 | 0 | **no** |
| `/github/deployments` | 14 | 0 | 0 | **no** |
| `/github/releases` | 12 | 0 | 0 | **no** |
| `/github/security` | 12 | 0 | 0 | **no** |
| `/github/insights` | 12 | 0 | 0 | **no** |
| `/github/activity` | 107 | 0 | 0 | **no** |
| `/github/luminary-dev/luminary-console/21` | 14 | 0 | 0 | **no** |
| `/c/eco-mech` | 27 | 0 | 1 | **no** |
| `/c/eco-mech/questionnaire` | 120 | 0 | 46 | **no** |
