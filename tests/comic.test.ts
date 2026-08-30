// The comic's layout invariants.
//
// The hub renders the comic as two rows, four panels then five, every panel
// displayed at 3:2 whatever it was drawn at. A row is `repeat(N, 1fr)` taken
// from its own length, so the only thing deciding the layout is ROWS in
// lib/comic.ts.
//
// Nothing in the CSS can notice a panel that ROWS forgets to name: it would
// simply never render, on a page nobody reads closely because it is a comic.
// So the mapping is asserted here, along with the height budget that is the
// entire reason for the 3:2 crop.
import { describe, expect, it } from "vitest";
import { PANELS, ROWS, VARIANT_WIDTHS, rowsOfPanels, variantsFor } from "@/lib/comic";

describe("comic layout invariants", () => {
  it("puts every panel in exactly one row", () => {
    const named = ROWS.flat();
    expect(
      [...named].sort(),
      "ROWS in lib/comic.ts is what the page renders from. A panel missing from " +
        "it is a panel nobody sees, and a panel named twice renders twice.",
    ).toEqual(PANELS.map((p) => p.file).sort());
    expect(new Set(named).size, "a file is named in ROWS more than once").toBe(named.length);
  });

  it("names only panels that exist", () => {
    // rowsOfPanels throws on an unknown filename; this is the assertion that
    // the throw is never reached in the shipped data.
    expect(() => rowsOfPanels()).not.toThrow();
    expect(rowsOfPanels().flat().length).toBe(PANELS.length);
  });

  it("keeps the rows short enough not to be a scroll", () => {
    // The reason the layout is shaped this way, checked rather than trusted.
    // Row height is the page width divided by the number of panels in it,
    // times the 3:2 display shape.
    const WIDTH = 1440;
    const total = rowsOfPanels().reduce((h, row) => h + (WIDTH / row.length) * (2 / 3), 0);
    expect(Math.round(total), `${Math.round(total)}px of comic at a ${WIDTH}px window`).toBeLessThan(600);
  });

  it("reads in story order across the row break", () => {
    expect(ROWS.flat()).toEqual(PANELS.map((p) => p.file));
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
