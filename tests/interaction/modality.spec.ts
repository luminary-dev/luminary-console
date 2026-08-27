// Touch modality: the pass that catches what a mouse never reveals.
//
// Runs under the "touch" project (iPhone 15, hasTouch). Records hover-only
// affordances, sticky-hover rules, tap target sizes and anything focusable but
// invisible. Section 3.3's specific warning is the row-hover action cluster,
// which simply does not exist for a finger.
import { test } from "@playwright/test";
import { ROUTES } from "./routes";
import { hoverDependencyProbe, stickyHoverProbe, targetProbe } from "./probes";
import { appendRow, settle } from "./report";

test("hover dependencies and unguarded hover rules, application-wide", async ({ page }) => {
  // Stylesheets are global, so one representative route loads them all that
  // the console ships; the github page pulls in both extra stylesheets.
  const seen = new Map<string, { rule: string; focusable: boolean }>();
  const sticky = new Set<string>();

  for (const route of ["/", "/github", "/github/ci", `/c/eco-mech`]) {
    await page.goto(route, { waitUntil: "load" });
    await settle(page, 600);
    for (const h of await page.evaluate(hoverDependencyProbe)) {
      seen.set(h.selector, { rule: h.rule, focusable: h.focusable });
    }
    for (const s of await page.evaluate(stickyHoverProbe)) sticky.add(s);
  }

  appendRow("raw/modality.json", {
    check: "hover dependency",
    hoverRevealed: [...seen.entries()].map(([selector, v]) => ({
      selector,
      alsoOnFocus: v.focusable,
      rule: v.rule,
    })),
    unguardedHoverRules: [...sticky],
    unguardedCount: sticky.size,
  });
});

for (const route of ROUTES) {
  test(`touch targets: ${route.path}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "load" });
    await settle(page);

    const targets = await page.evaluate(targetProbe);
    const under44 = targets.filter((t) => !t.disabled && (t.width < 44 || t.height < 44));
    const underAA = under44.filter((t) => (t.width < 24 || t.height < 24) && (t.nearestGap ?? 99) < 24);
    const crowded = targets.filter((t) => (t.nearestGap ?? 99) < 8);

    appendRow("raw/modality.json", {
      check: "touch targets",
      path: route.path,
      name: route.name,
      total: targets.length,
      under44: under44.length,
      underAA24: underAA.length,
      crowdedUnder8px: crowded.length,
      worst: under44
        .sort((a, b) => a.width * a.height - b.width * b.height)
        .slice(0, 10)
        .map((t) => ({ name: t.name || t.tag, w: t.width, h: t.height, gap: t.nearestGap, cls: t.cls })),
    });
  });
}
