// Draws the console's illustrations into public/illustrations/.
//
//   OPENAI_API_KEY=... npx tsx scripts/generate-illustrations.ts
//   OPENAI_API_KEY=... npx tsx scripts/generate-illustrations.ts --only card-clients
//   OPENAI_API_KEY=... npx tsx scripts/generate-illustrations.ts --force
//   npx tsx scripts/generate-illustrations.ts --encode-only
//
// Run once, commit the output. The pictures are static assets, so the console
// never calls OpenAI at render time and the artwork costs nothing to show.
//
// What gets drawn lives in lib/illustrations/image-prompts.ts, which is the
// manifest the brief shipped with: one subject per asset, a light and a dark
// treatment appended by buildPrompt(). This file is only the drawing half. For
// each {asset × mode} it:
//
//   1. skips the asset if its PNG master already exists (unless --force, or the
//      asset is named with --only), because every picture is a paid generation
//      and a rerun after a network blip should not spend eighteen times over;
//   2. calls POST /v1/images/generations, or POST /v1/images/edits with the
//      already-drawn mascot as the reference image for assets that declare
//      `basedOn`, so the character stays the same character across the set;
//   3. writes the PNG master to the manifest's `out` path;
//   4. encodes the WebP variants named in lib/illustrations/assets.ts, which
//      are what the pages actually load. --encode-only does step 4 alone, for
//      re-encoding at a new width without redrawing.
//
// The key is read from the environment and nowhere else. gitleaks runs over
// every commit in CI, so a key pasted into a file would fail the build as well
// as leak.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import { buildPrompt, type IllustrationPrompt, type ThemeMode } from "../lib/illustrations/image-prompts";
import { DEFAULT_ASSETS, illustration, masterPath, variantsFor, type IllustrationId } from "../lib/illustrations/assets";

const GENERATIONS = "https://api.openai.com/v1/images/generations";
const EDITS = "https://api.openai.com/v1/images/edits";
const MODES: ThemeMode[] = ["light", "dark"];

/** WebP quality. Painterly artwork with grain tolerates this well; the flat
 *  bone-paper areas in the light set are where banding would show first, and
 *  they were checked at this figure. */
const QUALITY = 80;

type Flags = { force: boolean; encodeOnly: boolean; only: string | null; concurrency: number };

function flags(argv: string[]): Flags {
  const f: Flags = { force: false, encodeOnly: false, only: null, concurrency: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--force") f.force = true;
    else if (a === "--encode-only") f.encodeOnly = true;
    else if (a === "--only") f.only = argv[++i] ?? null;
    else if (a === "--concurrency") f.concurrency = Math.max(1, Number(argv[++i] ?? 3));
    else throw new Error(`Unknown argument ${a}`);
  }
  return f;
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set. It is read from the environment only.");
  return key;
}

const model = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

/** Pull the PNG bytes out of an images API response, or throw with the API's
 *  own message so a rejected prompt says why. */
async function bytesFrom(res: Response): Promise<Buffer> {
  const data = (await res.json().catch(() => null)) as
    | { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } }
    | null;
  if (!res.ok) {
    throw new Error(`Image API ${res.status}: ${data?.error?.message ?? "unknown error"}`);
  }
  const d = data?.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d?.url) {
    const img = await fetch(d.url);
    if (!img.ok) throw new Error(`Image download failed (${img.status}).`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("Image API returned no image data.");
}

/** Whether a 400 is the API rejecting one of the optional parameters, in which
 *  case the call is retried without it. Different image models accept
 *  different option sets and this keeps the script working across them. */
function rejectsParam(msg: string, param: string): boolean {
  return msg.toLowerCase().includes(param.toLowerCase());
}

async function generate(a: IllustrationPrompt, mode: ThemeMode): Promise<Buffer> {
  const prompt = buildPrompt(a, mode);
  const body: Record<string, unknown> = {
    model: model(),
    prompt,
    size: a.size,
    output_format: "png",
    ...(a.transparent ? { background: "transparent" } : {}),
  };
  for (;;) {
    const res = await fetch(GENERATIONS, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 400) {
      const err = (await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
      const msg = err?.error?.message ?? "";
      const optional = ["output_format", "background"].find((p) => p in body && rejectsParam(msg, p));
      if (optional) {
        delete body[optional];
        continue;
      }
    }
    return bytesFrom(res);
  }
}

/** Edit from a reference picture so a derived asset keeps the same character.
 *  Multipart, because the edits endpoint takes the image as a file. */
async function edit(a: IllustrationPrompt, mode: ThemeMode, reference: string): Promise<Buffer> {
  const form = new FormData();
  form.set("model", model());
  form.set("prompt", buildPrompt(a, mode));
  form.set("size", a.size);
  form.set("output_format", "png");
  if (a.transparent) form.set("background", "transparent");
  form.set("image", new Blob([readFileSync(reference)], { type: "image/png" }), "reference.png");
  for (;;) {
    const res = await fetch(EDITS, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });
    if (res.status === 400) {
      const err = (await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
      const msg = err?.error?.message ?? "";
      const optional = ["output_format", "background"].find((p) => form.has(p) && rejectsParam(msg, p));
      if (optional) {
        form.delete(optional);
        continue;
      }
    }
    return bytesFrom(res);
  }
}

async function encode(a: IllustrationPrompt, mode: ThemeMode): Promise<number> {
  const src = masterPath(a, mode);
  if (!existsSync(src)) throw new Error(`Missing master ${src}; draw it first.`);
  let total = 0;
  for (const v of variantsFor(a, mode)) {
    const info = await sharp(src)
      .resize({ width: v.w, withoutEnlargement: true })
      .webp({ quality: QUALITY, alphaQuality: 90 })
      .toFile(v.path);
    total += info.size;
    process.stdout.write(`  ${v.path.padEnd(58)} ${Math.round(info.size / 1024)}KB\n`);
  }
  return total;
}

/** Run `jobs` with at most `n` in flight. Plain promises; no dependency. */
async function pool<T>(n: number, jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(n, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      const job = jobs[i];
      if (!job) return;
      out[i] = await job();
    }
  });
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  const f = flags(process.argv.slice(2));
  if (f.only && !DEFAULT_ASSETS.some((a) => a.id === f.only)) {
    throw new Error(`No asset named ${f.only}. Known: ${DEFAULT_ASSETS.map((a) => a.id).join(", ")}`);
  }
  const wanted = DEFAULT_ASSETS.filter((a) => !f.only || a.id === f.only);
  mkdirSync("public/illustrations", { recursive: true });

  if (f.encodeOnly) {
    for (const a of wanted) for (const m of MODES) await encode(a, m);
    process.stdout.write("done\n");
    return;
  }

  // Assets with a reference come after the asset they reference, so the
  // mascot exists on disk before the two edits that need it. Everything else
  // runs in parallel up to the concurrency limit.
  const roots = wanted.filter((a) => !a.basedOn);
  const derived = wanted.filter((a) => a.basedOn);

  const draw = (a: IllustrationPrompt, mode: ThemeMode) => async () => {
    const out = masterPath(a, mode);
    mkdirSync(dirname(out), { recursive: true });
    const redraw = f.force || f.only === a.id;
    if (existsSync(out) && !redraw) {
      process.stdout.write(`${out} exists, skipping\n`);
    } else {
      process.stdout.write(`drawing ${a.id} (${mode}, ${a.size}${a.transparent ? ", transparent" : ""}) ...\n`);
      const started = Date.now();
      const bytes = a.basedOn
        ? await edit(a, mode, masterPath(illustration(a.basedOn as IllustrationId), mode))
        : await generate(a, mode);
      writeFileSync(out, bytes);
      process.stdout.write(
        `wrote ${out} ${Math.round(bytes.length / 1024)}KB in ${Math.round((Date.now() - started) / 1000)}s\n`,
      );
    }
    await encode(a, mode);
  };

  await pool(f.concurrency, roots.flatMap((a) => MODES.map((m) => draw(a, m))));
  await pool(f.concurrency, derived.flatMap((a) => MODES.map((m) => draw(a, m))));
  process.stdout.write("done\n");
}

main().catch((e: unknown) => {
  process.stderr.write(`failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
