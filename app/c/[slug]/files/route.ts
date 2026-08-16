// Public portal action: the client records a file they've just uploaded for us
// to receive (brand assets, signed contracts, photos, references). The bytes
// went browser → R2 directly via the presigned PUT from the sibling "upload"
// route; this only appends the ref to the record and emails the studio —
// same shape as the comment route. The ref is re-validated against THIS
// client's attachments prefix, so nothing outside their folder can be pinned.
import { NextResponse } from "next/server";
import { getClient, saveClient, signedAssetUrl } from "@/lib/store";
import { emailStudio } from "@/lib/email";
import { sendTelegram, tgEsc } from "@/lib/telegram";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { esc } from "@/lib/templates/shell";
import { isOwnAttachmentUrl, MAX_FILE_BYTES, fmtSize } from "@/lib/attachments";
import type { PortalUpload } from "@/lib/types";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
const STUDIO = process.env.STUDIO_EMAIL || "support@luminary-dev.xyz";

const MAX_NAME = 140;
const MAX_NOTE = 500;
/** Keeps unbounded growth off a record read on every portal load. */
const MAX_UPLOADS = 200;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "upload");
  if (limited) return limited;

  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot → pretend success (same convention as comment/accept).
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const url = typeof body.url === "string" ? body.url : "";
  // Only accept a ref that points inside THIS client's own attachments folder.
  if (!isOwnAttachmentUrl(url, slug)) {
    return NextResponse.json({ error: "That file reference isn't valid." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return NextResponse.json({ error: "Missing file name." }, { status: 400 });
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? Math.max(0, Math.floor(body.size)) : 0;
  if (size <= 0 || size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "That file is over 15 MB." }, { status: 400 });
  }
  const by = typeof body.by === "string" ? body.by.trim().slice(0, 120) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";

  const upload: PortalUpload = {
    at: new Date().toISOString(),
    name,
    url,
    size,
    ...(by ? { by } : {}),
    ...(note ? { note } : {}),
  };
  client.uploads = [...(client.uploads ?? []), upload].slice(-MAX_UPLOADS);
  await saveClient(client);
  await logActivity(by || "client", "uploaded a file", slug, name);

  // Files live in a PRIVATE bucket; the stored url is an authed app link that
  // is useless inside an email. Sign a direct link at send time (same as the
  // questionnaire attachment mail) — 7 days is SigV4's ceiling, and the file
  // stays reachable from the console after that.
  const href = await signedAssetUrl(url).catch(() => null);
  const linkLine = href
    ? `<p><a href="${esc(href)}">Download ${esc(name)}</a> — link expires in 7 days.</p>`
    : `<p>Open it from the console (the portal stores files in the private bucket).</p>`;

  await emailStudio(
    `File uploaded — ${client.company}`,
    `<p><strong>${esc(by || "The client")}</strong> uploaded a file from the ${esc(client.company)} client portal:</p>
<p><b>${esc(name)}</b> (${esc(fmtSize(size))})${note ? ` — ${esc(note)}` : ""}</p>
${linkLine}
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open ${esc(client.company)} in the console →</a></p>`,
    [],
    client.email || STUDIO,
  );

  await sendTelegram(
    `📎 <b>${tgEsc(client.company)}</b> — ${tgEsc(by || "Client")} uploaded a file: ${tgEsc(name)} (${tgEsc(fmtSize(size))})${note ? `\n"${tgEsc(note)}"` : ""}\n<a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open in console →</a>`,
  );

  return NextResponse.json({ ok: true, at: upload.at });
}
