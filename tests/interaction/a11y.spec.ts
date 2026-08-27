// axe-core on every route, and critically on every OPEN OVERLAY.
//
// A route-level scan never opens a dialog, and most accessibility bugs in a
// console live inside dialogs and menus. So this drives the overlays open
// before scanning, and records which overlays it managed to reach: an overlay
// the harness could not open is itself recorded, because an unreachable
// overlay is either dead UI or a trigger that does not work.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ROUTES } from "./routes";
import { appendRow, settle } from "./report";

type Violation = {
  id: string;
  impact: string;
  help: string;
  nodes: number;
  targets: string[];
};

const summarise = (violations: { id: string; impact?: string | null; help: string; nodes: { target: unknown[] }[] }[]): Violation[] =>
  violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? "unknown",
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 4).map((n) => String(n.target[0] ?? "")),
  }));

for (const route of ROUTES) {
  test(`axe: ${route.path}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "load" });
    await settle(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const violations = summarise(results.violations);
    appendRow("raw/axe.json", {
      path: route.path,
      name: route.name,
      state: "at rest",
      violations,
      total: violations.reduce((n, v) => n + v.nodes, 0),
    });

    // Recorded, not enforced, during the audit phase. The register decides
    // severity; a failing sweep would stop collecting.
    expect(results.violations.length).toBeGreaterThanOrEqual(0);
  });
}

/**
 * Overlays, opened by their real trigger.
 *
 * Each entry names the route, a selector for the trigger and a selector that
 * proves the overlay is open. When the prover never appears the row records
 * `opened: false` rather than passing quietly.
 */
const OVERLAYS: { route: string; name: string; trigger: string; open: string }[] = [
  {
    route: "/",
    name: "Sign out confirmation",
    trigger: 'button:has-text("Sign out everywhere")',
    open: '[role="dialog"], [role="alertdialog"]',
  },
  {
    route: "/",
    name: "Command palette",
    trigger: "body",
    open: '[role="dialog"] input, [role="combobox"]',
  },
];

for (const o of OVERLAYS) {
  test(`axe: ${o.route} with "${o.name}" open`, async ({ page }) => {
    await page.goto(o.route, { waitUntil: "load" });
    await settle(page);

    let opened = false;
    if (o.name === "Command palette") {
      await page.keyboard.press("Meta+k");
      await page.waitForTimeout(400);
      opened = (await page.locator(o.open).count()) > 0;
      if (!opened) {
        await page.keyboard.press("Control+k");
        await page.waitForTimeout(400);
        opened = (await page.locator(o.open).count()) > 0;
      }
    } else {
      const trigger = page.locator(o.trigger).first();
      if ((await trigger.count()) > 0) {
        await trigger.click().catch(() => undefined);
        await page.waitForTimeout(400);
        opened = (await page.locator(o.open).count()) > 0;
      }
    }

    let violations: Violation[] = [];
    if (opened) {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      violations = summarise(results.violations);
    }

    appendRow("raw/axe.json", {
      path: o.route,
      name: o.name,
      state: opened ? "overlay open" : "overlay could NOT be opened by the harness",
      opened,
      violations,
      total: violations.reduce((n, v) => n + v.nodes, 0),
    });
  });
}
