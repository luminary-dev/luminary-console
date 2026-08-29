# Overlay audit

Generated 2026-08-29. Each overlay is opened by its real trigger and driven
through the section 3.4 checks. Rows appear twice where an overlay was
measured in both Chromium and WebKit, and the two disagreeing is itself a
finding.

| Overlay | Opened | role | aria-modal | Focus moves in | Escape closes | Focus leaks in 15 tabs | Scroll lock | Shift from lock | Focus returned to body |
| --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- |
| Command palette | true | dialog | true | true | true | 0 | true | 0 | false |
| Sign out everywhere confirmation | false | - | - | - | - | - | - | - | - |
| Delete confirmation | true | dialog | true | true | true | 0 | true | 0 | false |
| Command palette | true | dialog | true | true | true | 0 | true | 0 | false |
| Sign out everywhere confirmation | false | - | - | - | - | - | - | - | - |
| Delete confirmation | true | dialog | true | true | true | 0 | true | 0 | false |

Checks in section 3.4 this harness does not yet cover, recorded rather than
implied: click-outside protection on dirty forms, nesting, positioning and
collision near viewport edges, toast stacking and timers, virtual keyboard
behaviour, and route change with an overlay open.
