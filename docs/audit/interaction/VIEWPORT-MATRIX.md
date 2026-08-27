# Viewport matrix

Generated 2026-08-27. Every route at every width in section 5.1, plus a
640x360 landscape phone. `OK` means: HTTP under 400, no error boundary, no
horizontal scroll, no console error.

Screenshots are under `screens/<project>/<route>.png`.

| Route | 320 | 360 | 390 | 430 | 640 | 768 | 834 | 1024 | 1280 | 1440 | 1920 | 2560 | 3440 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/login` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/` | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err | 1 err |
| `/clients/new` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/clients/eco-mech` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/activity` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/publish` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/repos` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/ci` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/deployments` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/releases` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/security` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/insights` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/activity` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/github/luminary-dev/luminary-console/21` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/c/eco-mech` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/c/eco-mech/questionnaire` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/c/eco-mech/quotation` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |

**Horizontal overflow: 0 of 234 measurements.**
None.

## Layout shift

Worst CLS across all routes and widths: 0.0091.
The budget in section 5 is 0.02 on interaction.
