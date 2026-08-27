// Image generation for the publish portal — OpenAI gpt-image-2, in the
// Luminary landing page's house illustration style: stills that read like
// frames from a 3D animated feature film (the Adventures-of-Tintin motion
// capture look) — stylised-realistic characters, warm cinematic light,
// richly detailed environments, Sri Lankan settings and people.
//
// All landing-page artwork is 1536×1024 JPEG:
//   - blog covers        → public/blog/<slug>/cover.jpg
//   - project thumbnails → public/work/thumbs/<slug>-{light,dark}.jpg
//     (same scene twice: a daylight pass and a dusk/lantern-lit pass, so a
//     theme switch reads as day turning to night)

const API = "https://api.openai.com/v1/images/generations";
export const IMAGE_SIZE = "1536x1024";

const STYLE = `RENDERING STYLE, follow exactly: a still frame from a 3D animated feature film in the style of Steven Spielberg's "The Adventures of Tintin" (2011), Weta Digital motion-capture. Characters have REALISTIC HUMAN PROPORTIONS and naturalistic anatomy: normal-sized eyes, real skin texture with pores and subtle imperfection, individually rendered hair, understated facial expression. Cinematic camera work: shallow depth of field with real bokeh, motivated practical lighting, volumetric haze.

It is an ANIMATED film frame, not a photograph. Forms are subtly sculpted and slightly heightened, colour is art-directed rather than accidental, and everything is a shade cleaner and more deliberate than a camera would catch. Aim for the exact midpoint between photorealism and caricature: if it could pass for a stock photograph it has gone too far one way, and if the faces look cute it has gone too far the other.

NOT Pixar, NOT Disney, NOT DreamWorks. No oversized glossy eyes, no rounded caricature faces, no smooth plastic skin, no bright saturated toy colours, no wide cartoon smiles. If the faces look cute or the surfaces look like moulded plastic, the style is wrong.

HOUSE PALETTE AND SUBJECT VOCABULARY: warm golden-hour or lantern-lit key light against cooler shadow; aged brass, copper, oiled steel and worn timber; one restrained accent of luminous green from a dial, gauge, filament or screen; intricate practical machinery with visible gears, pipes, rivets and linkages; richly detailed environments with real wear. Sri Lankan setting and South Asian characters where people appear, dressed as working engineers and craftspeople.

No text, no lettering, no numerals, no logos, no watermarks, no user interfaces, no screenshots. Wide 3:2 editorial composition with one unmistakable focal subject.`;

export function coverPrompt(brief: string): string {
  return `Editorial cover illustration for a Luminary engineering blog post.

SCENE: ${brief}

The scene must be a PHYSICAL METAPHOR for the article's argument, built from real objects a person could touch, so a reader who has not read the piece can still guess what it is about. Workshops, harbours, foundries, signal boxes, printing presses, clockwork, cargo and weather are all in the house vocabulary. Never draw the technology literally: no computers, no code, no dashboards, no server racks, no abstract glowing networks.

${STYLE}`;
}

export function inlinePrompt(scene: string): string {
  return `In-article editorial illustration for a Luminary engineering blog post, sitting mid-read between paragraphs.

SCENE: ${scene}

Quieter and more focused than a cover: one clear subject, calm composition, fewer characters, shallower stage. It sits beside body text, so it must read at a glance and never compete with the cover.

${STYLE}`;
}

export function thumbPrompts(scene: string): { light: string; dark: string } {
  const base = `Portfolio thumbnail artwork for a Luminary project. Scene: ${scene}. ${STYLE}`;
  return {
    light: `${base} Lighting: bright tropical daylight, blue sky, sunlit colour palette.`,
    dark: `${base} Lighting: the exact same scene at dusk turning to night. Lantern and lamp light, deep blue-violet sky, warm golden highlights.`,
  };
}

/** Generate one image; returns JPEG bytes. Throws with a readable message. */
export async function generateImage(prompt: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

  const call = async (withFormat: boolean) =>
    fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        size: IMAGE_SIZE,
        ...(withFormat ? { output_format: "jpeg" } : {}),
      }),
    });

  let res = await call(true);
  // Older/other image models reject output_format — retry bare once.
  if (res.status === 400) {
    const err = await res.clone().json().catch(() => null);
    const msg: string = err?.error?.message || "";
    if (msg.includes("output_format")) res = await call(false);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Image generation failed (${res.status}): ${data?.error?.message || "unknown error"}`);
  }
  const d = data?.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d?.url) {
    const img = await fetch(d.url);
    if (!img.ok) throw new Error(`Image download failed (${img.status}).`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("Image generation returned no image data.");
}
