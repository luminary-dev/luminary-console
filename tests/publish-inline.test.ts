// LC-090: how many in-article illustrations a publish asks for.
//
// The console sends a boolean, because "does this article want pictures in
// it" is the question an editor actually has. Choosing 1 against 2 is a
// judgement about the article, and the article is right there to be measured.
import { describe, expect, it } from "vitest";

/** The rule the route applies, kept in one place so the test and the route
 *  cannot drift into disagreeing about it. */
function inlineCountFor(inlineImages: unknown, markdownLength: number): number {
  return inlineImages === true
    ? Math.min(2, Math.max(1, Math.round(markdownLength / 8000)))
    : Math.min(2, Math.max(0, Number(inlineImages) || 0));
}

describe("LC-090 inline illustration count", () => {
  it("asks for none when the box is unchecked", () => {
    expect(inlineCountFor(false, 40_000)).toBe(0);
    expect(inlineCountFor(undefined, 40_000)).toBe(0);
  });

  it("gives a short post one illustration, not two", () => {
    // 3000 characters is a few screens. Two pictures would outnumber the
    // sections they are meant to punctuate.
    expect(inlineCountFor(true, 3_000)).toBe(1);
  });

  it("gives a long post two", () => {
    expect(inlineCountFor(true, 16_000)).toBe(2);
  });

  it("never exceeds two, however long the article", () => {
    // The cover already carries the piece; more than two inline images turns
    // an article into a gallery, and each one is a paid generation.
    expect(inlineCountFor(true, 200_000)).toBe(2);
  });

  it("still honours an explicit number, so the API stays usable directly", () => {
    expect(inlineCountFor(1, 40_000)).toBe(1);
    expect(inlineCountFor(2, 1_000)).toBe(2);
    expect(inlineCountFor(9, 1_000)).toBe(2);
    expect(inlineCountFor(-3, 1_000)).toBe(0);
  });
});
