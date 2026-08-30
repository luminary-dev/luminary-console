// Encodes the WebP variants the comic actually displays.
//
//   npx tsx scripts/optimise-comic.mts
//
// Run after scripts/gen-comic.mts, and again whenever a panel is redrawn.
// Both the JPEG masters and these variants are committed: the masters are what
// this reads, so a panel can be re-encoded at a new size without paying to
// draw it again.
//
// This does the job next/image would normally do at runtime. It cannot, here:
// the comic lives behind the session gate, and the optimiser resolves a local
// image through an internal fetch that carries no session cookie, so every
// panel would come back as the login page. A plain <img> is fetched by the
// browser, which does send the cookie. Doing the resizing ahead of time keeps
// the panels private without shipping 1.4MB of JPEG to every hub visit.
import { existsSync, statSync } from "node:fs";
import sharp from "sharp";
import { PANELS, variantsFor } from "../lib/comic";

/** High enough that cel-shaded artwork shows no banding in the flat areas,
 *  low enough to be worth doing. Measured per panel below, so a bad change
 *  here is visible in the output rather than taken on trust. */
const QUALITY = 78;

async function main(): Promise<void> {
  let masters = 0;
  let encoded = 0;
  for (const panel of PANELS) {
    const src = `public/comic/${panel.file}`;
    if (!existsSync(src)) {
      throw new Error(`Missing master ${src}. Run scripts/gen-comic.mts first.`);
    }
    masters += statSync(src).size;
    for (const variant of variantsFor(panel)) {
      const out = `public${variant.url}`;
      await sharp(src)
        .resize({ width: variant.w, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(out);
      encoded += statSync(out).size;
      process.stdout.write(`${out.padEnd(44)} ${Math.round(statSync(out).size / 1024)}KB\n`);
    }
  }
  const kb = (n: number) => `${Math.round(n / 1024)}KB`;
  process.stdout.write(
    `\nmasters ${kb(masters)} in, variants ${kb(encoded)} out ` +
      `(the page loads at most one variant per panel, so the largest a reader ` +
      `ever fetches is well under the second figure)\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
