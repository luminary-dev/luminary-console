// The comic's layout invariants.
//
// The hub renders the comic as horizontal stripes using a single CSS grid,
// `grid-template-columns: 1.5fr 1fr 1fr`, with no per-row markup. That is exact
// rather than approximate: a 3:2 panel in a 1.5-unit column and a 1:1 panel in
// a 1-unit column resolve to the same height, so every panel in a row lines up
// with no cropping and no fixed row height to maintain.
//
// It only holds while the panels stay in the order wide, square, square. There
// is nothing in the CSS that can notice a reordering; the stripes would simply
// stop lining up and the page would look subtly wrong in a way that is easy to
// miss and hard to attribute. So the order is asserted here instead.
import { describe, expect, it } from "vitest";
import { PANELS, PANEL_PX, VARIANT_WIDTHS, variantsFor } from "@/lib/comic";

const COLUMNS = 3;

describe("comic layout invariants", () => {
  it("fills whole rows", () => {
    expect(
      PANELS.length % COLUMNS,
      `The grid is ${COLUMNS} across, so a panel count that is not a multiple of ` +
        `${COLUMNS} leaves a ragged last row. There are ${PANELS.length} panels.`,
    ).toBe(0);
  });

  it("repeats wide, square, square so every stripe lines up", () => {
    const expected = PANELS.map((_, i) => (i % COLUMNS === 0 ? "wide" : "square"));
    expect(
      PANELS.map((p) => p.size),
      "The first panel of each row must be the wide one. See the note above " +
        "grid-template-columns in app/globals.css.",
    ).toEqual(expected);
  });

  it("gives every panel in a row the same height", () => {
    // The check the CSS is actually relying on, done in numbers rather than
    // trusted: column width divided by aspect ratio must be constant per row.
    const track = (size: (typeof PANELS)[number]["size"]) => (size === "wide" ? 1.5 : 1);
    for (let start = 0; start < PANELS.length; start += COLUMNS) {
      const heights = PANELS.slice(start, start + COLUMNS).map((p) => {
        const px = PANEL_PX[p.size];
        return track(p.size) / (px.w / px.h);
      });
      expect(new Set(heights.map((h) => h.toFixed(6))).size, `row starting at panel ${start + 1}`).toBe(1);
    }
  });
});

describe("comic assets", () => {
  it("names a variant for every panel at every declared width", () => {
    for (const panel of PANELS) {
      const widths = VARIANT_WIDTHS[panel.size];
      const variants = variantsFor(panel);
      expect(variants.map((v) => v.w)).toEqual([...widths]);
      for (const variant of variants) {
        // scripts/optimise-comic.mts writes exactly this path. A mismatch is
        // the silent blank-panel failure of IX-013, so it is pinned.
        expect(variant.url).toBe(`/comic/${panel.file.replace(/\.jpg$/, `-${variant.w}.webp`)}`);
      }
    }
  });

  it("orders variants smallest first, so the last is the srcSet fallback", () => {
    for (const panel of PANELS) {
      const widths = variantsFor(panel).map((v) => v.w);
      expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    }
  });

  it("gives every panel alt text and every balloon a speaker", () => {
    for (const panel of PANELS) {
      expect(panel.alt.length, `${panel.file} needs alt text`).toBeGreaterThan(20);
      // The drawings carry no lettering, so a balloon with no `who` would be
      // read out as a disembodied line with nothing to attribute it to.
      for (const bubble of panel.bubbles) {
        expect(bubble.who, `a balloon in ${panel.file} has no speaker`).toBeTruthy();
        expect(bubble.text.length, `a balloon in ${panel.file} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every balloon inside its panel", () => {
    for (const panel of PANELS) {
      for (const bubble of panel.bubbles) {
        expect(bubble.x + bubble.w, `${panel.file}: "${bubble.text}" runs off the right edge`).toBeLessThanOrEqual(100);
        expect(bubble.y, `${panel.file}: "${bubble.text}" starts below the panel`).toBeLessThan(100);
      }
    }
  });
});
