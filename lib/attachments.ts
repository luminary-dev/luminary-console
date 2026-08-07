// Questionnaire file attachments. Uploaded files live in R2 under
// console/clients/<slug>/attachments/ (so client deletion sweeps the whole
// prefix with them); inside the Answers map each upload-field value is a
// string[] of JSON-encoded refs ({n: name, u: asset URL, s: bytes}) so the
// existing Answers type, storage and sanitization keep working unchanged.
// Shared by the form (client) and the submit/upload routes (server) — keep
// this module isomorphic (no S3 SDK; see lib/assets.ts).
import { ASSET_ROUTE, assetKey, STORE_PREFIX } from "./assets";

export type AttachmentRef = { n: string; u: string; s: number };

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_FILES_PER_FIELD = 12;

export function parseAttachment(raw: unknown): AttachmentRef | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.n !== "string" || typeof v?.u !== "string" || typeof v?.s !== "number") return null;
    const name = v.n.trim().slice(0, 140);
    if (!name) return null;
    return { n: name, u: v.u, s: Math.max(0, Math.floor(v.s)) };
  } catch {
    return null;
  }
}

/** The only key shape the upload route ever hands out: a flat
 *  "<16 hex>-<sanitised name>" directly inside one client's folder. */
const ATTACHMENT_KEY = /^console\/clients\/[a-z0-9-]+\/attachments\/[\w.\- ()[\]]{1,180}$/;

/** Only accept refs that point at OUR store, inside THIS client's attachments
 *  folder — submitted answers are rendered into documents the studio opens,
 *  and the attachment links are served back from the console origin, so
 *  arbitrary references must not survive. ONLY the app-relative form is
 *  accepted — an absolute "https://evil.example/api/asset/console/…" resolves
 *  to a legitimate-looking key but would send a clicking operator off-site,
 *  and legacy public Blob links are dead anyway. `assetKey` refuses traversal
 *  on top of that. */
export function isOwnAttachmentUrl(url: string, slug: string): boolean {
  if (typeof url !== "string" || !url.startsWith(ASSET_ROUTE)) return false;
  const key = assetKey(url);
  if (!key) return false;
  return ATTACHMENT_KEY.test(key) && key.startsWith(`${STORE_PREFIX}clients/${slug}/attachments/`);
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
