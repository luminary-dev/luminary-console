/**
 * Luminary Studio Console — illustration prompt manifest
 * -------------------------------------------------------
 * Prompts for OpenAI `gpt-image-2` (POST /v1/images/generations).
 * Every asset has a LIGHT ("Daylight / Paper") and DARK ("Workshop Night") variant.
 *
 * Lives at lib/illustrations/image-prompts.ts (this repo has no src/). The
 * generation script, scripts/generate-illustrations.ts, reads this, calls
 * gpt-image-2 per {asset × mode}, writes PNG masters to `out` under public/
 * and encodes the WebP variants the pages actually load (see
 * lib/illustrations/assets.ts). Text is NEVER baked into images: real HTML
 * text overlays them.
 *
 * The written files sit behind the session gate like the rest of the console
 * (docs/adr/0003-the-comic-is-private.md), with one exception: the auth hero
 * is needed before anyone has signed in, so proxy.ts lists it as public.
 *
 * IMPORTANT: original artwork only. Do not reproduce the panda "Thorny Problem"
 * concept art or any existing franchise/character. The recurring mascot defined
 * here (`mascot`) is an original lamp-headed repair-bot — generate it first, then
 * derive `empty-state` and `error-404` from it via /v1/images/edits for consistency.
 */

export type ThemeMode = "light" | "dark";

export interface IllustrationPrompt {
  /** stable key used by the component asset map */
  id: string;
  /** where it's used, for humans */
  usage: string;
  /** target output path, {mode} is substituted with light|dark */
  out: string;
  /** gpt-image-2 size; known-good: "1024x1024" | "1536x1024" | "1024x1536" | "auto" */
  size: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  /** transparent background (mascot / spot art). Omit for full-bleed scenes. */
  transparent?: boolean;
  /** the subject only — style + palette are appended by buildPrompt() */
  subject: string;
  /** optional: generate by editing another asset's output for character consistency */
  basedOn?: string;
}

/** Shared craft direction appended to every prompt. */
const SHARED =
  "cinematic anime concept-art illustration, painterly digital art with an editorial comic-book treatment, " +
  "clean confident linework, subtle film grain and paper texture, light halftone accents, volumetric light, " +
  "high detail, generous safe margins and clear negative space for UI, " +
  "no text, no lettering, no numbers, no logo, no watermark, no signature, " +
  "original artwork, not resembling any existing franchise, brand, or character";

/** Palette anchors so the set stays cohesive across generations. */
const PALETTE =
  "palette: bone cream #F3EEE2, warm ink #191612, lime green #7DB700, marigold amber #E8A317, " +
  "deep teal #1F6E69, coral #DA5A28";

const LIGHT_STYLE =
  "LIGHT MODE — sunlit daytime workshop, warm bone-paper background, soft natural daylight, " +
  "bright, airy and clean, spot-color print feel, gentle shadows";

const DARK_STYLE =
  "DARK MODE — night workshop, a single warm tungsten desk lamp glowing against deep teal-ink shadow, " +
  "atmospheric haze and soft light rays, dramatic chiaroscuro, amber and lime-green highlights on near-black";

/** Compose the final prompt string for a given asset + mode. */
export function buildPrompt(a: IllustrationPrompt, mode: ThemeMode): string {
  const style = mode === "light" ? LIGHT_STYLE : DARK_STYLE;
  const bg = a.transparent
    ? "isolated on a transparent background, no scene, no floor"
    : "full-bleed scene";
  return [a.subject, bg, style, PALETTE, SHARED].join(". ");
}

export const illustrations = [
  {
    id: "auth-hero",
    usage: "Login / auth page background (card floats over the empty side)",
    out: "public/illustrations/auth-hero.{mode}.png",
    size: "1536x1024",
    subject:
      "a cluttered-but-tidy inventor's repair workbench in a cosy small workshop — hand tools, coiled wires, " +
      "an articulated desk lamp, jars of parts, a few half-built gadgets and a big window; wide cinematic framing " +
      "with the workbench weighted to the RIGHT and calm open space on the LEFT for a login panel",
  },
  {
    id: "dashboard-hero",
    usage: "Optional wide banner behind the dashboard header",
    out: "public/illustrations/dashboard-hero.{mode}.png",
    size: "1536x1024",
    subject:
      "an establishing wide shot of the whole studio workshop — workbenches, pegboard walls, shelves of parts and " +
      "finished devices, warm and inviting; low visual density with plenty of empty space across the TOP band for a title",
  },
  {
    id: "card-clients",
    usage: "Dashboard 'Clients' panel header (documents, billing, handover)",
    out: "public/illustrations/card-clients.{mode}.png",
    size: "1536x1024",
    subject:
      "a handover moment on a desk — a neatly tied parcel, a portfolio folder, stamped paperwork and an invoice, " +
      "a small tray of finished work ready to deliver; tidy and warm",
  },
  {
    id: "card-engineering",
    usage: "Dashboard 'Engineering' panel header (PRs, CI, deploys, security)",
    out: "public/illustrations/card-engineering.{mode}.png",
    size: "1536x1024",
    subject:
      "an original small friendly repair-robot mid-service on a bench — open panel showing tidy circuit boards and " +
      "gears, a soldering iron with a wisp of smoke, calipers and a multimeter nearby; technical and characterful",
  },
  {
    id: "card-activity",
    usage: "Dashboard 'Activity' panel header (feed across clients/repos)",
    out: "public/illustrations/card-activity.{mode}.png",
    size: "1536x1024",
    subject:
      "a monitoring corner — a wall of small glowing indicator lights, analog gauges and dials, and a pegboard of " +
      "pinned notes and little tickets; a sense of many things happening at once, calm not chaotic",
  },
  {
    id: "card-publish",
    usage: "Dashboard 'Publish' panel header (articles + portfolio projects)",
    out: "public/illustrations/card-publish.{mode}.png",
    size: "1536x1024",
    subject:
      "a small drafting table and a miniature printing press mid-print — fresh paper sheets, ink rollers, a portfolio " +
      "of layouts and a mug of pens; creative and hands-on",
  },
  {
    id: "mascot",
    usage: "Brand character — empty states, onboarding, 404, avatars. GENERATE FIRST.",
    out: "public/illustrations/mascot.{mode}.png",
    size: "1024x1024",
    transparent: true,
    subject:
      "an ORIGINAL friendly repair-bot mascot — a small boxy tinkerer droid with a warm glowing light-bulb head, " +
      "round expressive eyes, stubby articulated arms holding a wrench, a little tool-belt; charming, approachable, " +
      "front three-quarter view, full body, clean silhouette",
  },
  {
    id: "empty-state",
    usage: "Generic 'nothing here yet' spot illustration",
    out: "public/illustrations/empty-state.{mode}.png",
    size: "1024x1024",
    transparent: true,
    basedOn: "mascot",
    subject:
      "the same original lamp-headed repair-bot mascot sitting on the edge of an empty workbench, looking around " +
      "patiently with nothing to do yet; gentle, a touch wistful, lots of empty space",
  },
  {
    id: "error-404",
    usage: "404 / error page spot illustration",
    out: "public/illustrations/error-404.{mode}.png",
    size: "1024x1024",
    transparent: true,
    basedOn: "mascot",
    subject:
      "the same original lamp-headed repair-bot mascot scratching its head beside a disassembled gadget with a spring " +
      "that has popped out and a couple of loose screws; comedic, harmless confusion",
  },
  {
    id: "texture-paper",
    usage:
      "OPTIONAL raster paper/grain overlay. Prefer SVG feTurbulence in-app; only generate if you want a photographic fiber.",
    out: "public/illustrations/texture-paper.{mode}.png",
    size: "1024x1024",
    subject:
      "a seamless, tileable, very low-contrast paper-fiber and fine film-grain texture, flat and even, no objects, " +
      "no focal point, suitable as a subtle full-screen overlay",
  },
] as const satisfies readonly IllustrationPrompt[];

/*
 * ── Example generation script sketch (scripts/generate-illustrations.ts) ──
 *
 * import OpenAI from "openai";
 * import { writeFile } from "node:fs/promises";
 * import { illustrations, buildPrompt, type ThemeMode } from "../public/illustrations/image-prompts";
 *
 * const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // never hard-code the key
 * const modes: ThemeMode[] = ["light", "dark"];
 *
 * for (const asset of illustrations) {
 *   for (const mode of modes) {
 *     const res = await openai.images.generate({
 *       model: "gpt-image-2",
 *       prompt: buildPrompt(asset, mode),
 *       size: asset.size,
 *       background: asset.transparent ? "transparent" : "opaque",
 *       // quality: "high",            // optional; check current OpenAI docs for allowed values
 *       // output_format: "png",
 *     });
 *     const b64 = res.data[0].b64_json!;
 *     const path = asset.out.replace("{mode}", mode);
 *     await writeFile(path, Buffer.from(b64, "base64"));
 *     console.log("wrote", path);
 *   }
 * }
 *
 * // For assets with `basedOn`, prefer openai.images.edit({ model: "gpt-image-2",
 * // image: <the generated mascot png for that mode>, prompt: buildPrompt(asset, mode) })
 * // so the character stays consistent. Verify exact size/quality/background enums
 * // against the current OpenAI Images API docs before a full run.
 */
