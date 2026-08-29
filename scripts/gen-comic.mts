// Draws the console's comic into public/comic/.
//
//   OPENAI_API_KEY=... npx tsx scripts/gen-comic.mts
//   OPENAI_API_KEY=... npx tsx scripts/gen-comic.mts 03-define-tiny.jpg
//
// Run once, commit the output. The panels are static assets, so the console
// never calls OpenAI at render time and the comic costs nothing to show.
//
// Panels and dialogue live in lib/comic.ts, which the page also renders from.
// This file is only the drawing half: it turns each panel's `scene` into a JPEG.
// Panels are drawn WORDLESS on purpose and lettered in HTML afterwards; the
// note at the top of lib/comic.ts explains why.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { PANELS } from "../lib/comic";
import { generateImage, type ImageSize } from "../lib/publish/images";

/** The comic's own look, deliberately not the house blog style. That one is
 *  built around a specific place and its people; a comic set in a named city
 *  would read as being about the city rather than about the work. */
const STYLE = `ART STYLE, follow exactly: a still frame from a modern 3D animated feature film, at the craft level of Pixar, DreamWorks and Illumination. Appealing stylised characters with clear silhouettes, slightly exaggerated cartoon proportions and big readable expressions. Art-directed colour, soft global illumination, subsurface scattering in skin, cinematic rim light, shallow depth of field. Comedic timing carried by pose and expression.

NOT photorealistic. NOT live action. NOT a photograph, and not a render aiming at realism. If it could be mistaken for a photograph, the style is wrong.

SETTING: a bright contemporary design and software studio in an unspecified modern city. Exposed brick, pale timber, tall industrial windows, trailing plants, monitors, mugs, sticky notes, cables. The cast is young, international and ethnically mixed, in ordinary casual modern clothes. No national or cultural markers of any kind: no flags, no traditional dress, no regional decor.

THE CONSOLE: a wonderfully absurd retro-futuristic machine filling one wall, built from brass, cream enamel and chunky plastic, with gauges, levers, pneumatic tubes, a paper feed and one enormous glowing lime-green dial. Lovable rather than menacing, and with more personality than the rest of the furniture put together.

PALETTE: warm daylight and amber lamplight against cool shadow, with the machine's lime green as the single accent.

ABSOLUTELY NO TEXT of any kind: no speech balloons, no captions, no signs, no labels, no numerals, no logos, no watermarks, no readable interface text. The panel carries its beat through composition, expression and action alone.`;

const SIZE: Record<string, ImageSize> = {
  wide: "1536x1024",
  square: "1024x1024",
};

async function main(): Promise<void> {
  mkdirSync("public/comic", { recursive: true });
  const only = process.argv[2]; // optional: redraw one panel by filename
  if (only && !PANELS.some((p) => p.file === only)) {
    throw new Error(`No panel named ${only}. Known: ${PANELS.map((p) => p.file).join(", ")}`);
  }
  for (const panel of PANELS) {
    if (only && panel.file !== only) continue;
    const out = `public/comic/${panel.file}`;
    // Skip what is already drawn. Each panel is a paid generation, and a rerun
    // after a network blip should not spend nine times over to replace eight
    // good images. Name a panel as an argument, or set COMIC_FORCE, to redraw.
    if (existsSync(out) && !process.env.COMIC_FORCE && !only) {
      process.stdout.write(`${panel.file} exists, skipping\n`);
      continue;
    }
    process.stdout.write(`drawing ${panel.file} (${panel.size}) ... `);
    const bytes = await generateImage(`${panel.scene}\n\n${STYLE}`, SIZE[panel.size]!);
    writeFileSync(out, bytes);
    process.stdout.write(`${Math.round(bytes.length / 1024)}KB\n`);
  }
  process.stdout.write("done\n");
}

main().catch((e: unknown) => {
  process.stderr.write(`failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
