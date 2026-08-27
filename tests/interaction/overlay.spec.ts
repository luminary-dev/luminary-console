// Overlay behaviour: focus trap, focus return, Escape, scroll lock.
//
// Section 3.4's checks, driven against the real overlays. Every result is
// recorded rather than asserted during the audit phase, including "the
// harness could not open this", which is itself information: an overlay no
// automated trigger can reach is either dead or its trigger is broken.
import { test } from "@playwright/test";
import { appendRow, settle } from "./report";

type OverlaySpec = {
  route: string;
  name: string;
  /** How to open it. Returns true when the overlay is believed open. */
  open: (page: import("@playwright/test").Page) => Promise<boolean>;
  /** Selector proving it is open. */
  proof: string;
  /** Whether dismissing it could discard typed input. */
  destructive?: boolean;
};

const OVERLAYS: OverlaySpec[] = [
  {
    route: "/",
    name: "Command palette",
    proof: '[role="dialog"], [cmdk-root], [role="combobox"]',
    open: async (page) => {
      await page.keyboard.press("Meta+k");
      await page.waitForTimeout(350);
      if ((await page.locator('[role="dialog"], [cmdk-root], [role="combobox"]').count()) > 0) return true;
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(350);
      return (await page.locator('[role="dialog"], [cmdk-root], [role="combobox"]').count()) > 0;
    },
  },
  {
    route: "/",
    name: "Sign out everywhere confirmation",
    proof: '[role="alertdialog"], [role="dialog"]',
    destructive: true,
    open: async (page) => {
      const t = page.locator('button:has-text("Sign out everywhere")').first();
      if ((await t.count()) === 0) return false;
      await t.click().catch(() => undefined);
      await page.waitForTimeout(350);
      return (await page.locator('[role="alertdialog"], [role="dialog"]').count()) > 0;
    },
  },
  {
    route: "/clients/eco-mech",
    name: "Delete confirmation",
    proof: '[role="alertdialog"], [role="dialog"]',
    destructive: true,
    open: async (page) => {
      const t = page.locator('button:has-text("Delete")').first();
      if ((await t.count()) === 0) return false;
      await t.click().catch(() => undefined);
      await page.waitForTimeout(350);
      return (await page.locator('[role="alertdialog"], [role="dialog"]').count()) > 0;
    },
  },
];

for (const o of OVERLAYS) {
  test(`overlay: ${o.name}`, async ({ page }) => {
    await page.goto(o.route, { waitUntil: "load" });
    await settle(page);

    const before = await page.evaluate(() => ({
      scrollY: window.scrollY,
      bodyOverflow: getComputedStyle(document.body).overflow,
      docWidth: document.documentElement.clientWidth,
      active: document.activeElement?.tagName ?? null,
    }));

    const opened = await o.open(page);
    if (!opened) {
      appendRow("raw/overlay.json", {
        name: o.name,
        route: o.route,
        opened: false,
        note: "The harness could not open this overlay with its documented trigger.",
      });
      return;
    }

    const onOpen = await page.evaluate((proof) => {
      const overlay = document.querySelector(proof) as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      const focusInside = !!(overlay && active && overlay.contains(active));
      const focusables = overlay
        ? overlay.querySelectorAll(
            'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
          ).length
        : 0;
      return {
        role: overlay?.getAttribute("role") ?? null,
        ariaModal: overlay?.getAttribute("aria-modal") ?? null,
        accessibleName:
          overlay?.getAttribute("aria-label") ||
          (overlay?.getAttribute("aria-labelledby")
            ? document.getElementById(overlay.getAttribute("aria-labelledby") as string)?.textContent?.trim()
            : "") ||
          "",
        focusMovedIn: focusInside,
        focusedElement: active ? `${active.tagName} ${(active.textContent || "").trim().slice(0, 30)}` : null,
        focusableCount: focusables,
        bodyOverflow: getComputedStyle(document.body).overflow,
        docWidth: document.documentElement.clientWidth,
        portalledToBody: overlay ? overlay.parentElement === document.body : null,
      };
    }, o.proof);

    // Focus trap: tab around and see whether focus ever leaves.
    let escapes = 0;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate((proof) => {
        const overlay = document.querySelector(proof);
        const a = document.activeElement;
        return !!(overlay && a && overlay.contains(a));
      }, o.proof);
      if (!inside) escapes++;
    }

    // Escape closes.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    const closed = (await page.locator(o.proof).count()) === 0;

    const after = await page.evaluate(() => ({
      scrollY: window.scrollY,
      bodyOverflow: getComputedStyle(document.body).overflow,
      docWidth: document.documentElement.clientWidth,
      active: document.activeElement?.tagName ?? null,
      activeIsBody: document.activeElement === document.body,
    }));

    appendRow("raw/overlay.json", {
      name: o.name,
      route: o.route,
      opened: true,
      destructive: !!o.destructive,
      role: onOpen.role,
      ariaModal: onOpen.ariaModal,
      accessibleName: onOpen.accessibleName,
      focusMovedIn: onOpen.focusMovedIn,
      focusedOnOpen: onOpen.focusedElement,
      focusableCount: onOpen.focusableCount,
      focusEscapedDuring15Tabs: escapes,
      portalledToBody: onOpen.portalledToBody,
      scrollLockApplied: onOpen.bodyOverflow === "hidden",
      // A scrollbar disappearing when the body locks shifts the whole page.
      layoutShiftFromScrollLock: onOpen.docWidth - before.docWidth,
      escapeClosed: closed,
      focusReturnedToBody: after.activeIsBody,
      scrollPreserved: after.scrollY === before.scrollY,
    });
  });
}
