# Accessibility scan

Generated 2026-08-27. axe-core against WCAG 2.0/2.1/2.2 A and AA, on every
route at rest and on every overlay the harness could open.

| Rule | Impact | Nodes | Routes |
| --- | --- | ---: | ---: |
| `color-contrast` | serious | 471 | 17 |
| `label` | critical | 10 | 3 |
| `definition-list` | serious | 4 | 1 |
| `link-in-text-block` | serious | 1 | 1 |

**486 failing nodes across 4 distinct rules.**

## Per route

| Route | State | Nodes | Rules |
| --- | --- | ---: | --- |
| `/github` | at rest | 108 | color-contrast |
| `/github/activity` | at rest | 102 | color-contrast |
| `/github/ci` | at rest | 60 | color-contrast |
| `/clients/eco-mech` | at rest | 51 | color-contrast |
| `/github/repos` | at rest | 36 | color-contrast |
| `/github/deployments` | at rest | 23 | color-contrast |
| `/c/eco-mech` | at rest | 20 | color-contrast, link-in-text-block |
| `/github/luminary-dev/luminary-console/21` | at rest | 19 | color-contrast |
| `/c/eco-mech/questionnaire` | at rest | 17 | color-contrast |
| `/` | at rest | 8 | color-contrast |
| `/` | overlay open | 8 | color-contrast |
| `/` | overlay open | 8 | color-contrast |
| `/github/insights` | at rest | 7 | color-contrast, definition-list |
| `/clients/new` | at rest | 6 | color-contrast, label |
| `/publish` | at rest | 4 | color-contrast, label |
| `/github/releases` | at rest | 3 | color-contrast |
| `/github/security` | at rest | 3 | color-contrast |
| `/login` | at rest | 2 | label |
| `/activity` | at rest | 1 | color-contrast |
