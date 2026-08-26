// A static guard over the stylesheets for one layout invariant that no unit
// test can catch, because jsdom performs no layout: horizontal scroll
// containers must establish a containing block.
//
// The bug this exists to prevent was real and user visible. Every dense table
// carries a min-width so its columns stay readable, and each one sits in a
// scroller with overflow-x: auto. That looked correct and measured correct:
// the scroller box itself was 326px wide inside a 360px viewport, and it
// scrolled its content internally.
//
// It still broke the page. CSS overflow only clips a descendant whose
// containing block lies inside the scrolling box. The .sr-only table captions
// and per-cell labels are position: absolute, and on a position: static
// scroller they resolve against the initial containing block instead. They
// escaped the clip and stretched the document to the full width of the table:
// 1096px of document in a 360px viewport on /github/ci, with the header
// scrolled off screen and no way to reach it.
//
// So the accessibility affordance is what broke the mobile layout, which is
// exactly the kind of interaction that survives review. Adding
// position: relative to the scroller makes it the containing block for those
// absolute descendants, and the clip applies to them like everything else.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHEETS = ["app/globals.css", "components/github/github.css", "components/github/github-views.css"];

/** Every `selector { ... }` rule in `css`, media-query wrappers stripped. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  // Drop comments first so a commented-out declaration cannot register.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    const body = match[2] ?? "";
    // `@media (...)` and friends wrap other rules; the inner rules are matched
    // separately by this same pass, so skipping the wrapper loses nothing.
    if (selector.startsWith("@")) continue;
    out.push({ selector, body });
  }
  return out;
}

function declares(body: string, property: string, value: RegExp): boolean {
  const found = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i"));
  return found ? value.test((found[1] ?? "").trim()) : false;
}

describe("horizontal scrollers establish a containing block", () => {
  const scrollers = SHEETS.flatMap((file) =>
    rules(readFileSync(new URL(file, `file://${ROOT}`), "utf8"))
      .filter((r) => declares(r.body, "overflow-x", /^(auto|scroll)$/) || declares(r.body, "overflow", /^(auto|scroll)$/))
      .map((r) => ({ ...r, file })),
  );

  it("finds the scrollers it is meant to be guarding", () => {
    // If a refactor renames or removes these, this test should fail loudly
    // rather than silently guarding an empty set.
    const selectors = scrollers.map((s) => s.selector);
    expect(selectors).toContain(".table-scroll");
    expect(selectors).toContain(".gh-scroll");
  });

  it.each(scrollers.map((s) => [s.file, s.selector, s.body] as const))(
    "%s: %s is positioned, so absolute descendants are clipped",
    (_file, _selector, body) => {
      expect(declares(body, "position", /^(relative|absolute|sticky|fixed)$/)).toBe(true);
    },
  );
});

describe("the .sr-only pattern that made this matter", () => {
  const globals = readFileSync(new URL("app/globals.css", `file://${ROOT}`), "utf8");
  const srOnly = rules(globals).find((r) => r.selector === ".sr-only");

  it("is absolutely positioned, which is why the rule above is required", () => {
    // Documents the dependency between the two rules. If .sr-only ever stops
    // being absolute, the invariant above becomes belt-and-braces rather than
    // load-bearing, and this test says where to look.
    expect(srOnly).toBeDefined();
    expect(declares(srOnly?.body ?? "", "position", /^absolute$/)).toBe(true);
  });

  it("hides content without moving it off-screen by a large offset", () => {
    // An older sr-only idiom used `left: -9999px`, which would push the
    // document width out on its own, independently of any scroller.
    const body = srOnly?.body ?? "";
    expect(declares(body, "left", /-\d{3,}px/)).toBe(false);
    expect(declares(body, "text-indent", /-\d{3,}px/)).toBe(false);
  });
});
