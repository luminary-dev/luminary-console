// Shared helpers for writing audit data to disk.
//
// Every spec appends rows to a JSON file rather than printing them, because
// the deliverables in section 7 are documents and a document assembled from
// scrollback is a document nobody can regenerate.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "@playwright/test";

export const OUT = "docs/audit/interaction";

export function writeJson(path: string, data: unknown): void {
  const full = `${OUT}/${path}`;
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Append one row to a JSON array file, creating it when absent. */
export function appendRow(path: string, row: unknown): void {
  const full = `${OUT}/${path}`;
  mkdirSync(dirname(full), { recursive: true });
  let rows: unknown[] = [];
  if (existsSync(full)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(full, "utf8"));
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      // A corrupt partial file must not lose the run in progress; start over
      // rather than throwing halfway through a sweep.
      rows = [];
    }
  }
  rows.push(row);
  writeFileSync(full, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

/**
 * Wait until the page has genuinely stopped moving.
 *
 * This exists because of a specific mistake worth not repeating: an earlier
 * pass measured horizontal overflow before the scroll containers had mounted,
 * concluded there was none, and missed five real failures. Fonts, hydration
 * and the first paint after hydration all have to land before a measurement
 * means anything.
 */
export async function settle(page: Page, extraMs = 1200): Promise<void> {
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    // Two frames: one for hydration's commit, one for the layout it causes.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  });
  await page.waitForTimeout(extraMs);
}

/** A filesystem-safe fragment of a route path. */
export function slugFor(path: string): string {
  const s = path.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return s || "root";
}
