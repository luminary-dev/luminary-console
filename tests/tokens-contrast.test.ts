// The palette's contrast floor, computed from the stylesheet rather than
// asserted from memory.
//
// Every text token in app/globals.css has to clear WCAG AA (4.5:1) on every
// surface it can land on, in both palettes. The redesign deepened several of
// the brief's values to get there (the note at the top of the stylesheet
// records which), and this is what stops a later tweak drifting one of them
// back under the floor: the interaction audit found 480 of its 486 axe
// violations came from a single accent value that had been "adjusted".
//
// The tint cases matter. A brand-tinted notice sits on a card, so its text is
// read against the brand colour at 10 percent over the card surface, which is
// slightly darker than the card alone. The composite is computed here the way
// the browser would blend it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

type Rgb = [number, number, number];

/** The custom properties declared in one rule block, hex and rgba only. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block for ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function hex(v: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`not a hex colour: ${v}`);
  const n = parseInt(m[1]!, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function rgba(v: string): { rgb: Rgb; a: number } {
  const m = /^rgba\((\d+),(\d+),(\d+),([.\d]+)\)$/.exec(v.replace(/\s/g, ""));
  if (!m) throw new Error(`not an rgba colour: ${v}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}
function over(top: { rgb: Rgb; a: number }, base: Rgb): Rgb {
  return base.map((b, i) => Math.round(top.rgb[i]! * top.a + b * (1 - top.a))) as Rgb;
}
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ["--ink", "--ink-soft", "--muted", "--a-text", "--danger", "--amber-text", "--teal"];
const SURFACES = ["--bg", "--surface", "--surface-2"];
/** Tinted surfaces and the text that actually sits on them. A brand-tinted
 *  notice carries body text and brand text; an amber tint carries the amber
 *  label; a coral tint carries the danger label. Nothing puts coral text on an
 *  amber tint, so that pair is not asserted. */
const TINTS: { tint: string; base: string; text: string[] }[] = [
  { tint: "--a-dim", base: "--surface", text: ["--ink", "--ink-soft", "--muted", "--a-text"] },
  { tint: "--a-dim", base: "--bg", text: ["--ink", "--ink-soft", "--muted", "--a-text"] },
  { tint: "--amber-dim", base: "--surface", text: ["--ink", "--amber-text"] },
  { tint: "--danger-dim", base: "--surface", text: ["--ink", "--danger"] },
];

describe.each([
  ["Daylight / Paper", ":root"],
  ["Workshop Night", 'html[data-theme="dark"]'],
])("%s palette", (_name, selector) => {
  const t = tokens(selector);
  const pairs: [string, string, Rgb][] = [];
  for (const text of TEXT) for (const s of SURFACES) pairs.push([text, s, hex(t[s]!)]);
  for (const { tint, base, text } of TINTS) {
    const composite = over(rgba(t[tint]!), hex(t[base]!));
    for (const tx of text) pairs.push([tx, `${tint} over ${base}`, composite]);
  }

  it.each(pairs)("%s on %s clears AA", (text, _sname, srgb) => {
    expect(ratio(hex(t[text]!), srgb)).toBeGreaterThanOrEqual(4.5);
  });

  it("text on the brand sticker clears AA", () => {
    expect(ratio(hex(t["--brand-ink"]!), hex(t["--brand"]!))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the legacy names pointing at the new ones", () => {
    // Components still say var(--text) and var(--muted). If either alias is
    // dropped the whole console silently falls back to the browser default.
    for (const alias of ["--text", "--desk", "--off", "--border", "--border-hi", "--accent"]) {
      expect(tokens(":root")[alias], `${alias} must remain an alias`).toMatch(/^var\(--/);
    }
  });
});

describe("no stray colours in components", () => {
  it("the panel border and focus ring are tokens in both palettes", () => {
    for (const sel of [":root", 'html[data-theme="dark"]']) {
      const t = tokens(sel);
      expect(t["--panel-line"]).toMatch(/^#/);
      expect(t["--focus"]).toMatch(/^#/);
    }
  });
});
