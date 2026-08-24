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

const STYLE = `Rendered as a still frame from a modern 3D animated feature film in the style of "The Adventures of Tintin" (2011) motion-capture animation: stylised-realistic characters with expressive faces, cinematic depth of field, warm practical lighting, richly detailed textured environments, painterly volumetric atmosphere. Sri Lankan setting and characters where people appear. No text, no logos, no watermarks, no UI. Composition works as a wide 3:2 editorial image with clear focal subject.`;

export function coverPrompt(brief: string): string {
  return `Editorial cover illustration for a Luminary engineering blog post. Scene: ${brief}. Favour a clever visual metaphor over literal screenshots — whimsical machinery, workshops, skies, harbours and streets are all in the house vocabulary. ${STYLE}`;
}

export function inlinePrompt(scene: string): string {
  return `In-article editorial illustration for a Luminary engineering blog post, sitting mid-read between paragraphs. Scene: ${scene}. Quieter and more focused than a cover — one clear subject, calm composition. ${STYLE}`;
}

export function thumbPrompts(scene: string): { light: string; dark: string } {
  const base = `Portfolio thumbnail artwork for a Luminary project. Scene: ${scene}. ${STYLE}`;
  return {
    light: `${base} Lighting: bright tropical daylight, blue sky, sunlit colour palette.`,
    dark: `${base} Lighting: the exact same scene at dusk turning to night — lantern and lamp light, deep blue-violet sky, warm golden highlights.`,
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
