# Modality audit

Generated 2026-08-27. Touch measurements come from WebKit at iPhone 15
dimensions, which is real Safari rather than Chromium pretending.

## Hover dependency (section 3.3)

Affordances revealed only by hover: **0**.

Unguarded `:hover` rules, which produce sticky hover on touch: **0**.
A touch device applies these on tap and leaves them applied until something
else is tapped, so a row stays lit after the finger has gone.


## Touch targets (section 3.2)

WCAG 2.2 AA 2.5.8 asks 24x24 CSS px, with an exception when neighbours are
far enough apart. Apple's HIG asks 44x44. Both are reported: `<24 AA` counts
only targets that fail the criterion including its spacing exception.

| Route | Targets | <44px | <24px AA | Neighbours under 8px |
| --- | ---: | ---: | ---: | ---: |
| `/clients/eco-mech` | 117 | 29 | 0 | 40 |
| `/github/ci` | 78 | 28 | 0 | 78 |
| `/github/activity` | 131 | 28 | 0 | 131 |
| `/c/eco-mech/questionnaire` | 129 | 28 | 3 | 2 |
| `/github` | 86 | 16 | 0 | 84 |
| `/c/eco-mech` | 26 | 3 | 0 | 7 |
| `/` | 25 | 1 | 0 | 8 |
| `/github/repos` | 46 | 1 | 0 | 43 |
| `/github/deployments` | 14 | 1 | 0 | 14 |
| `/github/releases` | 12 | 1 | 0 | 12 |
| `/github/security` | 12 | 1 | 0 | 12 |
| `/github/insights` | 12 | 1 | 0 | 12 |
| `/github/luminary-dev/luminary-console/21` | 14 | 1 | 0 | 14 |
| `/login` | 4 | 0 | 0 | 0 |
| `/clients/new` | 11 | 0 | 0 | 0 |
| `/activity` | 4 | 0 | 0 | 0 |
| `/publish` | 16 | 0 | 0 | 0 |

**Total: 139 targets under 44px, 3 failing WCAG 2.5.8 outright.**

## Keyboard (section 3.5)

| Route | Tab stops | Order jumps | Stops with no visible ring | Skip link visible on focus |
| --- | ---: | ---: | ---: | --- |
| `/login` | 2 | 0 | 0 | yes |
| `/` | 19 | 0 | 0 | yes |
| `/clients/new` | 12 | 0 | 0 | yes |
| `/clients/eco-mech` | 60 | 0 | 0 | yes |
| `/activity` | 5 | 0 | 0 | yes |
| `/publish` | 16 | 0 | 0 | yes |
| `/github` | 33 | 0 | 0 | yes |
| `/github/repos` | 46 | 0 | 0 | yes |
| `/github/ci` | 60 | 0 | 0 | yes |
| `/github/deployments` | 14 | 0 | 0 | yes |
| `/github/releases` | 12 | 0 | 0 | yes |
| `/github/security` | 12 | 0 | 0 | yes |
| `/github/insights` | 12 | 0 | 0 | yes |
| `/github/activity` | 60 | 0 | 0 | yes |
| `/github/luminary-dev/luminary-console/21` | 14 | 0 | 0 | yes |
| `/c/eco-mech` | 27 | 0 | 0 | yes |
| `/c/eco-mech/questionnaire` | 60 | 0 | 0 | yes |
