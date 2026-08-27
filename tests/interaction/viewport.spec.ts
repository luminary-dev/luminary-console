// The viewport sweep: every route at every width in the section 5.1 matrix.
//
// Measures overflow, tap targets and layout shift, screenshots the result, and
// appends a row per route per viewport to raw/viewport.json. It asserts only
// the one thing that is never acceptable, horizontal overflow; everything else
// is recorded for the findings register rather than failed here, because a
// failing audit run stops collecting data and the point of this pass is data.
import { test, expect } from "@playwright/test";
import { ALL_HTML_ROUTES } from "./routes";
import { overflowProbe, targetProbe } from "./probes";
import { appendRow, settle, slugFor, OUT } from "./report";

// Overflow is enforced. Everything else is observed.
const ENFORCE_OVERFLOW = process.env.IX_ENFORCE_OVERFLOW !== "0";

for (const route of ALL_HTML_ROUTES) {
  test(`${route.path} renders without horizontal overflow`, async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 0;
    const project = testInfo.project.name;

    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 160)}`));

    // Record layout shifts from first paint, attributed to their source.
    await page.addInitScript(() => {
      (window as unknown as { __ixShifts: unknown[] }).__ixShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources?: { node?: Element }[];
          };
          if (e.hadRecentInput) continue;
          (window as unknown as { __ixShifts: unknown[] }).__ixShifts.push({
            value: e.value,
            at: Math.round(e.startTime),
            sources: (e.sources ?? [])
              .map((s) => {
                const n = s.node as HTMLElement | undefined;
                if (!n?.tagName) return "?";
                const cls = typeof n.className === "string" ? n.className.slice(0, 40) : "";
                return `${n.tagName}.${cls}`;
              })
              .slice(0, 3),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    const response = await page.goto(route.path, { waitUntil: "load" });
    await settle(page);

    const status = response?.status() ?? 0;
    const overflow = await page.evaluate(overflowProbe);
    const targets = route.nonHtml ? [] : await page.evaluate(targetProbe);
    const shifts = await page.evaluate(
      () => (window as unknown as { __ixShifts: { value: number }[] }).__ixShifts,
    );
    const cls = shifts.reduce((sum, s) => sum + s.value, 0);

    const errorBoundary = await page.evaluate(() =>
      document.body.innerText.includes("Something went wrong"),
    );

    // WCAG 2.2 AA 2.5.8: 24x24 CSS px, with a spacing exception. Apple asks
    // 44x44 on touch. Both are recorded; the finding decides which applies.
    const undersized = targets.filter(
      (t) => !t.disabled && (t.width < 24 || t.height < 24) && (t.nearestGap ?? 99) < 24,
    );
    const underTouch = targets.filter((t) => !t.disabled && (t.width < 44 || t.height < 44));
    const focusableInvisible = targets.filter((t) => t.focusable && t.invisible);

    const shot = `${OUT}/screens/${project}/${slugFor(route.path)}.png`;
    await page.screenshot({ path: shot, fullPage: false });

    appendRow("raw/viewport.json", {
      project,
      width,
      path: route.path,
      name: route.name,
      status,
      errorBoundary,
      consoleErrors,
      scrollableBy: overflow.scrollableBy,
      documentScrollWidth: overflow.documentScrollWidth,
      overflowHits: overflow.hits,
      cls: Number(cls.toFixed(4)),
      shifts: shifts.slice(0, 5),
      targetCount: targets.length,
      undersizedAA: undersized.map((t) => ({ n: t.name, w: t.width, h: t.height, gap: t.nearestGap })),
      underTouch44: underTouch.length,
      focusableInvisible: focusableInvisible.map((t) => t.name),
      screenshot: shot,
    });

    // A 5xx here is ambiguous, and the ambiguity has already cost one run.
    // Midway through the first HTTPS sweep this machine lost DNS to the R2
    // endpoint, every store read failed, and 33 rows recorded HTTP 500 as
    // though the console had a bug at wide viewports. It did not; the network
    // did. So the harness names the difference instead of leaving it to
    // whoever reads the register.
    if (status >= 500) {
      const environmental = await page
        .evaluate(() => document.body.innerText.slice(0, 400))
        .then((t) => /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(t))
        .catch(() => false);
      expect(
        environmental,
        `${route.path} answered ${status} at ${width}px. If this is a DNS or network failure ` +
          `reaching the object store, the run is invalid rather than the console being broken: ` +
          `check that the R2 endpoint resolves and re-run. Otherwise it is a real fault.`,
      ).toBe(false);
    }

    expect(status, `${route.path} should answer 200`).toBeLessThan(400);
    expect(errorBoundary, `${route.path} should not render an error boundary`).toBe(false);

    if (ENFORCE_OVERFLOW) {
      expect(
        overflow.scrollableBy,
        `${route.path} scrolls sideways by ${overflow.scrollableBy}px at ${width}px. ` +
          `Widest offenders: ${overflow.hits
            .slice(0, 3)
            .map((h) => `${h.tag}.${h.cls} (${h.width}px)`)
            .join(", ")}`,
      ).toBe(0);
    }
  });
}
