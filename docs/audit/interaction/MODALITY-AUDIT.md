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
| `/c/eco-mech/questionnaire` | 129 | 99 | 64 | 2 |
| `/clients/eco-mech` | 117 | 41 | 12 | 41 |
| `/github/activity` | 131 | 35 | 0 | 131 |
| `/github/ci` | 78 | 31 | 0 | 78 |
| `/github` | 86 | 16 | 0 | 84 |
| `/github/luminary-dev/luminary-console/21` | 14 | 10 | 10 | 14 |
| `/publish` | 16 | 7 | 1 | 0 |
| `/clients/new` | 11 | 6 | 0 | 0 |
| `/c/eco-mech` | 26 | 4 | 0 | 7 |
| `/` | 25 | 3 | 2 | 8 |
| `/github/deployments` | 14 | 3 | 2 | 14 |
| `/login` | 4 | 2 | 0 | 0 |
| `/github/repos` | 46 | 1 | 0 | 43 |
| `/github/releases` | 12 | 1 | 0 | 12 |
| `/github/security` | 12 | 1 | 0 | 12 |
| `/github/insights` | 12 | 1 | 0 | 12 |
| `/activity` | 4 | 0 | 0 | 0 |

**Total: 261 targets under 44px, 91 failing WCAG 2.5.8 outright.**

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
