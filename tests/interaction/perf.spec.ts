// Interaction latency: INP-style event timing and long tasks.
//
// Section 3.6 sets the budget at 150ms per interaction, with anything over
// 200ms a finding. Measuring beats guessing, so this clicks real controls and
// records the browser's own `event` timing entries rather than wall-clock
// around an await, which would measure Playwright's round trip as well.
import { test } from "@playwright/test";
import { appendRow, settle } from "./report";

type Interaction = { route: string; label: string; selector: string };

const INTERACTIONS: Interaction[] = [
  { route: "/github", label: "saved view: failing CI", selector: 'button:has-text("Failing CI")' },
  { route: "/github", label: "saved view: everything", selector: 'button:has-text("Everything")' },
  { route: "/github", label: "sort by author", selector: 'th button:has-text("Author")' },
  { route: "/github/ci", label: "first tab or filter", selector: "button" },
  { route: "/", label: "pipeline filter chip", selector: ".pill, .chip, button" },
  { route: "/activity", label: "first control", selector: "button, a[href]" },
];

test.describe("interaction latency", () => {
  for (const i of INTERACTIONS) {
    test(`INP: ${i.route} ${i.label}`, async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __ixEvents: unknown[]; __ixLong: unknown[] };
        w.__ixEvents = [];
        w.__ixLong = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const ev = e as PerformanceEntry & { duration: number; processingStart: number; name: string };
            w.__ixEvents.push({
              name: ev.name,
              duration: Math.round(ev.duration),
              delay: Math.round(ev.processingStart - ev.startTime),
            });
          }
          // durationThreshold 16 catches everything worth seeing; the default
          // of 104 hides exactly the range the 150ms budget lives in.
        }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__ixLong.push({ duration: Math.round(e.duration), at: Math.round(e.startTime) });
          }
        }).observe({ type: "longtask", buffered: true });
      });

      await page.goto(i.route, { waitUntil: "load" });
      await settle(page);

      const target = page.locator(i.selector).first();
      const present = (await target.count()) > 0;
      let clicked = false;
      if (present) {
        // Clear anything recorded during load, so the numbers are the
        // interaction's own.
        await page.evaluate(() => {
          const w = window as unknown as { __ixEvents: unknown[]; __ixLong: unknown[] };
          w.__ixEvents = [];
          w.__ixLong = [];
        });
        await target.click({ timeout: 5000 }).then(
          () => {
            clicked = true;
          },
          () => undefined,
        );
        await page.waitForTimeout(600);
      }

      const { events, long } = await page.evaluate(() => {
        const w = window as unknown as {
          __ixEvents: { name: string; duration: number; delay: number }[];
          __ixLong: { duration: number }[];
        };
        return { events: w.__ixEvents, long: w.__ixLong };
      });

      const worst = events.reduce((m, e) => (e.duration > m ? e.duration : m), 0);
      appendRow("raw/perf.json", {
        route: i.route,
        label: i.label,
        selector: i.selector,
        present,
        clicked,
        worstEventMs: worst,
        events: events.slice(0, 8),
        longTasks: long.filter((l) => l.duration > 50).slice(0, 5),
        budget150: worst > 0 ? worst <= 150 : null,
      });
    });
  }
});
