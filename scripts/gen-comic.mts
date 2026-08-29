// Generates the console's comic strip into public/comic/.
//
// Run once, commit the output. The images are static assets, so the console
// never calls OpenAI at render time and the strip costs nothing to show:
//
//   npx tsx --env-file=.env.local scripts/gen-comic.mts
//
// The prompts live here rather than in a chat log so the strip can be
// regenerated, extended or re-styled by someone who was not there. Panels are
// deliberately WORDLESS: image models render lettering as convincing gibberish,
// and a speech bubble full of nonsense is worse than none. The captions are
// real HTML text in components/ComicStrip.tsx, which also makes them readable
// by a screen reader and translatable.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generateImage } from "../lib/publish/images";

/** Webtoon, not the house 3D-animation look: this is a different artefact. */
const STYLE = `ART STYLE, follow exactly: a panel from a modern Korean manhwa webtoon. Clean confident digital linework with varied line weight, flat cel shading with soft gradient lighting, subtle halftone screentone texture in the shadows, expressive exaggerated faces and body language, dynamic camera angle. Bold and readable at a glance.

Palette: warm muted earth tones, aged brass and copper, worn timber, deep teal shadow, with ONE luminous lime-green accent used sparingly for the machine's glow.

Setting: a cluttered, characterful engineering workshop in Colombo, Sri Lanka. South Asian characters. Ceiling fans, tropical light through shutters, tea glasses, rolled drawings, brass instruments.

The recurring machine is "the Console": an absurd, lovable brass-and-timber contraption filling one wall, with gauges, levers, pneumatic tubes, a paper feed and one big glowing green dial.

ABSOLUTELY NO TEXT of any kind: no speech bubbles, no signs, no labels, no numerals, no logos, no watermarks, no captions. The panel must carry its beat through composition, expression and action alone.

Wide horizontal panel, cinematic 3:2 composition, one unmistakable focal subject.`;

/** Four beats. Each caption is rendered as real text beside the panel. */
const PANELS = [
  {
    file: "01-the-ask.jpg",
    alt: "A client bursts into the workshop at closing time while three engineers freeze over their tea.",
    scene:
      "Late afternoon, golden light through shutters. A cheerful client in a bright shirt bursts through the workshop door mid-stride, one finger raised, mouth open, radiating the confidence of someone about to say something small. Three engineers freeze at a workbench, tea glasses halfway to their mouths, eyes wide. The great brass Console machine looms dark and dormant along the back wall.",
  },
  {
    file: "02-the-look.jpg",
    alt: "The senior engineer smiles and reaches for a large glowing green dial.",
    scene:
      "Tight low-angle close-up. The eldest engineer, unbothered, sets her tea down with great deliberation and reaches one hand toward an enormous brass dial that is beginning to glow lime green. A slow, knowing half-smile. Behind her the other two lean back out of frame, bracing. Dust motes in the light.",
  },
  {
    file: "03-the-machine.jpg",
    alt: "The machine erupts: documents fly, pneumatic tubes fire, a tiny subdomain sprouts from a pot.",
    scene:
      "Explosive wide shot of joyful mechanical chaos. The Console erupts into motion: gears spinning, pneumatic tubes firing capsules across the ceiling, a blizzard of freshly printed documents fanning through the air, an invoice folding itself mid-flight, a small green seedling shaped like a signpost sprouting from a clay pot on top of the machine. The three engineers duck, delighted. Paper everywhere.",
  },
  {
    file: "04-still-hot.jpg",
    alt: "Silence. Everything is finished, neatly stacked, and the tea is still steaming.",
    scene:
      "Sudden stillness. One sheet of paper drifts down to land on a neat, perfectly squared stack of finished documents. The machine sits innocent, its green dial dimming. The client stands blinking, finger still raised, having not finished the sentence. The eldest engineer picks her tea back up: it is still steaming. The other two are already back on their stools.",
  },
] as const;

async function main(): Promise<void> {
  mkdirSync("public/comic", { recursive: true });
  for (const panel of PANELS) {
    const out = `public/comic/${panel.file}`;
    // Skip what is already there. Each panel is a paid generation, and a
    // rerun after a network blip should not spend four times to replace three
    // good images. Delete a file to force it to be redrawn.
    if (existsSync(out) && !process.env.COMIC_FORCE) {
      process.stdout.write(`${panel.file} exists, skipping\n`);
      continue;
    }
    process.stdout.write(`generating ${panel.file} ... `);
    const bytes = await generateImage(`${panel.scene}\n\n${STYLE}`);
    writeFileSync(out, bytes);
    process.stdout.write(`${Math.round(bytes.length / 1024)}KB\n`);
  }
  process.stdout.write("done\n");
}

main().catch((e: unknown) => {
  process.stderr.write(`failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
