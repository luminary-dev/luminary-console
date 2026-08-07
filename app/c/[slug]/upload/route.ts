// Questionnaire-attachment uploads go browser → R2 directly, because routed-
// through-the-function bodies hit Vercel's 4.5 MB limit — a phone photo
// wouldn't fit. This route only mints a presigned PUT, pinned to a key inside
// THIS client's attachments folder; submit re-validates every ref against the
// same prefix (lib/attachments).
//
// The cap and the content type are enforced by SIGNING them: `contentType`
// and `contentLength` are part of the signature, so the browser has to send
// exactly what was validated here or R2 rejects the PUT. HTML-ish types are
// refused so nothing markup-shaped is ever stored under a client's name.
import { NextResponse } from "next/server";
import { getClient, signedUploadUrl } from "@/lib/store";
import { MAX_FILE_BYTES } from "@/lib/attachments";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Everything real-world (Office, PDF, images, zips) fits these; the form maps
// anything odd to octet-stream. Markup types stay excluded.
const ALLOWED_PREFIX = ["image/", "video/", "audio/", "font/", "application/"];
const ALLOWED_EXACT = ["text/plain", "text/csv", "text/markdown", "text/rtf"];
const NAME_RE = /^[\w.\- ()[\]]{1,120}$/;

function allowedType(type: string): boolean {
  if (/html|xml|javascript|svg/i.test(type)) return false;
  return ALLOWED_PREFIX.some((p) => type.startsWith(p)) || ALLOWED_EXACT.includes(type);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "upload");
  if (limited) return limited;

  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; contentType?: unknown; size?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const name = typeof body.name === "string" ? body.name : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.toLowerCase() : "";
  const size = typeof body.size === "number" ? Math.floor(body.size) : -1;

  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }
  if (!allowedType(contentType)) {
    return NextResponse.json({ error: "That file type isn't accepted." }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "That file is over 15 MB." }, { status: 400 });
  }

  // Key is built here, never taken from the request: slug comes from the
  // route, the suffix is ours, and the name is already charset-checked.
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const key = `console/clients/${slug}/attachments/${id}-${name}`;

  try {
    const url = await signedUploadUrl(key, contentType, size);
    return NextResponse.json({ url, key, contentType });
  } catch (e) {
    console.error("Upload signing failed:", e);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
