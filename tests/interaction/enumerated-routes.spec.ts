// The inventory must not drift from the application.
//
// Section 2.1 says routes registered but unreachable are themselves a finding.
// The inverse is worse: a route the app serves and the audit never visits is a
// screen nobody checked. This walks the filesystem router and fails when it
// finds a page the inventory does not cover, so the audit cannot quietly go
// stale as the console grows.
import { test, expect } from "@playwright/test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROUTES } from "./routes";

/** Every `page.tsx` under app/, as its route pattern. */
function filesystemRoutes(dir = "app", prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups (parentheses) and private folders (underscore) do not
      // contribute a path segment.
      const segment = entry.startsWith("(") || entry.startsWith("_") ? "" : `/${entry}`;
      out.push(...filesystemRoutes(full, prefix + segment));
    } else if (entry === "page.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

test("every page route appears in the audit inventory", () => {
  const onDisk = filesystemRoutes().sort();
  const covered = new Set(ROUTES.map((r) => r.pattern));

  // Map each filesystem route back to its page file for comparison.
  const missing: string[] = [];
  for (const route of onDisk) {
    const pattern = `app${route === "/" ? "" : route}/page.tsx`;
    if (!covered.has(pattern)) missing.push(pattern);
  }

  expect(
    missing,
    "These page routes exist but are not in tests/interaction/routes.ts, so nothing audits them. " +
      "Add them to the inventory (with the parameters filled in) or record why they are excluded.",
  ).toEqual([]);
});

test("every inventoried route points at a real file", () => {
  const onDisk = new Set(
    filesystemRoutes().map((r) => `app${r === "/" ? "" : r}/page.tsx`),
  );
  const dangling = ROUTES.filter((r) => r.pattern.endsWith("page.tsx") && !onDisk.has(r.pattern));

  expect(
    dangling.map((r) => r.pattern),
    "The inventory names page files that no longer exist. A stale inventory is worse than none: " +
      "it reports coverage the audit does not have.",
  ).toEqual([]);
});
