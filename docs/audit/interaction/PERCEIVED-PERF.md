# Perceived performance

Generated 2026-08-29. Latency is the browser's own `event` timing entry, not
wall-clock around an await, so it measures the interaction rather than
Playwright's round trip. Budget from section 3.6: 150ms, with anything over
200ms a finding.

| Route | Interaction | Clicked | Worst event | Within 150ms | Long tasks over 50ms |
| --- | --- | --- | ---: | --- | ---: |

## Layout shift

Worst CLS observed on load, across every route and width: **0.0672**.

## Coverage gap

These are load-time and single-click measurements. Section 3.6 also asks for
debounce and cancellation behaviour, optimistic rollback, race conditions on
rapid filter switching, and Slow 3G. None of those is covered yet.
