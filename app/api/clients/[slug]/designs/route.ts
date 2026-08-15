// Design previews for a client: add (or replace) a single self-contained HTML
// file into a slot (up to MAX_DESIGNS). Each is served at a path under the
// client's existing subdomain (<slug>.ROOT/design/<id>) — no per-design DNS.
// A design stays a draft (holding page in public, previewable from the console)
// until it is published.
import { NextResponse } from "next/server";
import { getClient, saveClient, putAsset, deleteAssets } from "@/lib/store";
import { MAX_DESIGNS, DESIGN_HTML_MAX_BYTES } from "@/lib/designs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const html = typeof body.html === "string" ? body.html : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";

  if (!html.trim()) return NextResponse.json({ error: "Upload an HTML file." }, { status: 400 });
  if (Buffer.byteLength(html, "utf8") > DESIGN_HTML_MAX_BYTES) {
    return NextResponse.json({ error: "That file is over 3 MB. Inline or shrink its assets." }, { status: 400 });
  }
  if (!/<!doctype html|<html|<body/i.test(html)) {
    return NextResponse.json({ error: "That does not look like an HTML page." }, { status: 400 });
  }

  const designs = client.designs ?? [];

  // Pick the slot: an explicit id replaces that slot (re-upload); otherwise the
  // lowest free slot 1..MAX_DESIGNS.
  let id = typeof body.id === "string" && /^[1-9]\d*$/.test(body.id) ? body.id : "";
  const existing = id ? designs.find((d) => d.id === id) : undefined;
  if (!id) {
    for (let n = 1; n <= MAX_DESIGNS; n++) {
      if (!designs.some((d) => d.id === String(n))) { id = String(n); break; }
    }
    if (!id) {
      return NextResponse.json(
        { error: `You can add up to ${MAX_DESIGNS} designs. Delete one first.` },
        { status: 400 },
      );
    }
  }

  const htmlUrl = await putAsset(`clients/${slug}/designs/design-${id}.html`, html, "text/html; charset=utf-8");
  const now = new Date().toISOString();

  if (existing) {
    // Re-upload: swap the file, reset to draft, keep the slot. The old cached
    // PDF is now stale — drop it; re-publishing renders a fresh one.
    await deleteAssets([existing.htmlUrl, ...(existing.pdfUrl ? [existing.pdfUrl] : [])]);
    existing.htmlUrl = htmlUrl;
    existing.pdfUrl = undefined;
    existing.status = "draft";
    existing.updatedAt = now;
    if (title) existing.title = title;
  } else {
    designs.push({ id, title: title || `Design ${id}`, status: "draft", htmlUrl, updatedAt: now });
    designs.sort((a, b) => Number(a.id) - Number(b.id));
  }
  client.designs = designs;
  await saveClient(client);
  return NextResponse.json({ ok: true, designs: client.designs });
}
