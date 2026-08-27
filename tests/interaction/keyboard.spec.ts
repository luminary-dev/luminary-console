// Keyboard modality: tab order, reachability, focus visibility, skip link.
//
// Walks the real tab sequence rather than reading the DOM, because the tab
// order a browser produces and the order the markup implies are different
// things, and the difference is the finding.
import { test } from "@playwright/test";
import { ROUTES } from "./routes";
import { appendRow, settle } from "./report";

const MAX_STOPS = 60;

for (const route of ROUTES) {
  test(`keyboard walk: ${route.path}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "load" });
    await settle(page);

    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      el?.blur?.();
    });

    const stops: {
      i: number;
      tag: string;
      name: string;
      visible: boolean;
      inViewport: boolean;
      hasRing: boolean;
      opacityZero: boolean;
      y: number;
    }[] = [];

    const seen = new Set<string>();
    let wrapped = false;

    for (let i = 0; i < MAX_STOPS; i++) {
      await page.keyboard.press("Tab");
      // Let the focus transition finish before measuring. The skip link
      // animates in over 160ms; measuring at zero caught it at
      // translateY(-75px) and reported it as invisible on 16 of 17 routes,
      // which was a bug in this probe rather than in the console. Focus
      // rings can transition too, so the same wait protects both numbers.
      await page.waitForTimeout(220);
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);

        // Focus ring: any of outline, box-shadow or a ring custom property.
        // Reading the computed style of the FOCUSED element is the only way
        // to know whether :focus-visible actually produced something.
        const outline =
          s.outlineStyle !== "none" && parseFloat(s.outlineWidth || "0") > 0;
        const shadow = s.boxShadow !== "none" && s.boxShadow !== "";
        let opacityZero = false;
        let node: HTMLElement | null = el;
        while (node) {
          if (Number(getComputedStyle(node).opacity) === 0) {
            opacityZero = true;
            break;
          }
          node = node.parentElement;
        }

        const label =
          el.getAttribute("aria-label") ||
          (el as HTMLInputElement).labels?.[0]?.textContent ||
          el.textContent ||
          "";

        return {
          tag: el.tagName,
          name: label.trim().slice(0, 44),
          key: `${el.tagName}:${label.trim().slice(0, 30)}:${Math.round(r.top)}`,
          visible: r.width > 0 && r.height > 0 && s.visibility !== "hidden",
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
          hasRing: outline || shadow,
          opacityZero,
          y: Math.round(r.top + window.scrollY),
        };
      });

      if (!stop) break;
      if (seen.has(stop.key)) {
        wrapped = true;
        break;
      }
      seen.add(stop.key);
      stops.push({ i, ...stop });
    }

    // Tab order should follow visual order. Count how often it goes backwards
    // up the page, which is what a jumbled order feels like.
    let regressions = 0;
    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1];
      const cur = stops[i];
      if (prev && cur && cur.y < prev.y - 40) regressions++;
    }

    const noRing = stops.filter((s) => !s.hasRing);
    const invisible = stops.filter((s) => s.opacityZero || !s.visible);

    // Skip link: first Tab from the top should reach it and it must become
    // visible, not merely exist.
    await page.goto(route.path, { waitUntil: "load" });
    await settle(page, 500);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(220);
    const skip = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim().slice(0, 40),
        href: el.getAttribute("href") || "",
        visibleOnFocus: r.width > 0 && r.height > 0 && r.bottom > 0,
      };
    });

    appendRow("raw/keyboard.json", {
      path: route.path,
      name: route.name,
      stops: stops.length,
      reachedEnd: wrapped || stops.length < MAX_STOPS,
      tabOrderRegressions: regressions,
      stopsWithoutVisibleRing: noRing.length,
      noRingSample: noRing.slice(0, 8).map((s) => `${s.tag} "${s.name}"`),
      focusableButInvisible: invisible.map((s) => `${s.tag} "${s.name}"`),
      firstTab: skip,
    });
  });
}
