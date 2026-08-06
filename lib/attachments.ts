// Questionnaire file attachments. Uploaded files live in Blob under
// clients/<slug>/attachments/ (so client deletion sweeps them too); inside
// the Answers map each upload-field value is a string[] of JSON-encoded refs
// ({n: name, u: url, s: bytes}) so the existing Answers type, storage and
// sanitization keep working unchanged. Shared by the form (client) and the
// submit/upload routes (server) — keep this module isomorphic.
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

/** Only accept refs that point at OUR blob store, inside THIS client's
 *  attachments folder — submitted answers are rendered into documents the
 *  studio opens, so arbitrary URLs must not survive. */
export function isOwnAttachmentUrl(url: string, slug: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".public.blob.vercel-storage.com") &&
      u.pathname.startsWith(`/console/clients/${slug}/attachments/`)
    );
  } catch {
    return false;
  }
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
