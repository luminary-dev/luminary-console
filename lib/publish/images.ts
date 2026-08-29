// Image generation for the publish portal, OpenAI gpt-image-2, in the Luminary
// landing page's house illustration style: stills that read like frames from a
// modern 3D animated feature film. Expressive stylised characters, warm
// cinematic light, richly detailed environments, Sri Lankan settings and
// people.
//
// The one thing this must never be is photorealistic. Every other axis has
// room in it; that one does not.
//
// All landing-page artwork is 1536×1024 JPEG:
//   - blog covers        → public/blog/<slug>/cover.jpg
//   - project thumbnails → public/work/thumbs/<slug>-{light,dark}.jpg
//     (same scene twice: a daylight pass and a dusk/lantern-lit pass, so a
//     theme switch reads as day turning to night)

const API = "https://api.openai.com/v1/images/generations";
export const IMAGE_SIZE = "1536x1024";

const STYLE = `RENDERING STYLE, follow exactly: a still frame from a modern 3D animated feature film, the craft level of Pixar, Walt Disney Animation and DreamWorks. Appealing stylised characters with clear silhouettes and readable, expressive faces. Art-directed colour with a deliberate palette, sculpted forms, soft global illumination, subsurface scattering in skin, cinematic depth of field and rim light. Everything is designed rather than captured: cleaner, warmer and more intentional than a camera would ever produce.

NOT photorealistic. NOT live action. NOT a photograph, a film still of real actors, a render aiming at realism, or documentary imagery. If it could be mistaken for a photograph, the style is wrong. Faces and hands are stylised, not scanned. Skin, cloth and metal read as beautifully rendered animation surfaces, not as camera footage.

HOUSE PALETTE AND SUBJECT VOCABULARY: warm golden-hour or lantern-lit key light against cooler shadow; aged brass, copper, oiled steel and worn timber; one restrained accent of luminous green from a dial, gauge, filament or screen; intricate practical machinery with visible gears, pipes, rivets and linkages; richly detailed environments with honest wear. Sri Lankan setting and South Asian characters where people appear, dressed as working engineers and craftspeople.

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
