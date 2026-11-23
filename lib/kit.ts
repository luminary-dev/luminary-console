// The social kit, as the console sees it.
//
// The kit (every Instagram and Facebook post, its caption and its pictures) is
// drawn in the Shopfront repository and published as a small site with a
// manifest, kit.json, beside it. The console does not copy any of that into
// this repository or the bucket. It reads the manifest when the page is
// opened, and it hands pictures through its own origin (app/api/sales/kit/file)
// because the console's content security policy only allows images from
// itself, and because a download link only works same-origin.
//
// What the console adds, and stores, is the one thing the kit site cannot
// know: which posts are already up, on which platform, and who put them there.
import { z } from "zod";
import { readState, updateState } from "./store";

/** Where the kit site lives. Overridable for a preview deployment. */
export const kitOrigin = (): string =>
  (process.env.KIT_ORIGIN || "https://kit.shopfront.luminary-dev.xyz").replace(/\/+$/, "");

/** Sent when the kit site is behind Vercel's deployment protection: the
 *  project's "Protection Bypass for Automation" secret. Unset while the kit
 *  site is public. */
const bypassHeaders = (): Record<string, string> => {
  const secret = process.env.KIT_BYPASS_SECRET;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
};

/** A picture's path inside the kit's out/ folder. Lowercase names, forward
 *  slashes, an image extension, and no way to climb out of the folder: this is
 *  the whole reason the file route is not an open proxy. */
export const KIT_FILE = /^(?!.*\.\.)[a-z0-9][a-z0-9/_-]{0,150}\.(jpg|jpeg|png|webp)$/;
export const isKitFile = (path: string): boolean => KIT_FILE.test(path) && !path.includes("//");

const file = z.string().refine(isKitFile, "not a kit picture path");
const str = (max: number) => z.string().max(max);

const PostSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  label: str(8),
  title: str(120),
  day: z.number().int().min(1).max(999),
  files: z.array(file).min(1).max(12),
  caption: str(4000),
  alt: str(600),
});

export const KitSchema = z.object({
  generatedAt: str(40),
  profile: z.object({ name: str(120), handle: str(60), url: str(200), category: str(60), bio: str(300) }),
  facebook: z.object({ name: str(120), category: str(60), bio: str(300), about: str(1200) }),
  posts: z.array(PostSchema).min(1).max(400),
  highlights: z.array(z.object({ key: str(30), name: str(60), cover: file, stories: z.array(file).max(60) })).max(20),
  extras: z.array(z.object({ label: str(80), file })).max(20),
});
export type Kit = z.infer<typeof KitSchema>;
export type KitPost = Kit["posts"][number];

export type KitResult = { ok: true; kit: Kit } | { ok: false; reason: string };

/** Read and validate the manifest. Never throws: the page shows the reason. */
export async function fetchKit(): Promise<KitResult> {
  const url = `${kitOrigin()}/kit.json`;
  let res: Response;
  try {
    res = await fetch(url, { headers: bypassHeaders(), cache: "no-store", redirect: "manual" });
  } catch {
    return { ok: false, reason: "The kit site could not be reached." };
  }
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, reason: "The kit site asked for a login. It is private; set KIT_BYPASS_SECRET so the console can read it." };
  }
  if (!res.ok) return { ok: false, reason: `The kit site answered ${res.status} for kit.json.` };
  const parsed = KitSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, reason: "kit.json is not in the shape the console expects. Rebuild the kit." };
  return { ok: true, kit: parsed.data };
}

/** Fetch one picture from the kit site. The caller has already checked the
 *  path with isKitFile. */
export function fetchKitFile(path: string): Promise<Response> {
  return fetch(`${kitOrigin()}/out/${path}`, { headers: bypassHeaders(), cache: "no-store", redirect: "manual" });
}

/** The console address a picture is shown from or downloaded through. */
export const kitFileHref = (path: string, download = false): string =>
  `/api/sales/kit/file?path=${encodeURIComponent(path)}${download ? "&dl=1" : ""}`;

// ——— what has been posted ———

export const CHANNELS = ["instagram", "facebook"] as const;
export type KitChannel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<KitChannel, string> = { instagram: "Instagram", facebook: "Facebook" };

export type PostedMark = { at: string; by: string };
export type PostedMap = Record<string, Partial<Record<KitChannel, PostedMark>>>;

const POSTED_PATH = "sales/posted.json";

export async function getPosted(): Promise<PostedMap> {
  const map = await readState<PostedMap>(POSTED_PATH);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

/** Tick or untick one post on one platform. Returns that post's marks. */
export async function setPosted(
  id: string,
  channel: KitChannel,
  posted: boolean,
  by: string,
): Promise<Partial<Record<KitChannel, PostedMark>>> {
  const map = await updateState<PostedMap>(POSTED_PATH, (current) => {
    const all = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    const { [channel]: _removed, ...others } = all[id] ?? {};
    const next = posted ? { ...others, [channel]: { at: new Date().toISOString(), by } } : others;
    return { ...all, [id]: next };
  });
  return map[id] ?? {};
}
