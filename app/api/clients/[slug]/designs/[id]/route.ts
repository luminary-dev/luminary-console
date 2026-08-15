// One design slot: authed raw preview (GET), publish/unpublish (POST), and
// delete (DELETE). All behind the console session gate via proxy.ts. Designs
// are served as paths under the client subdomain, so there is no per-design DNS
// to tear down here.
import { NextResponse } from "next/server";
import { getClient, saveClient, fetchAsset, putAsset, deleteAssets } from "@/lib/store";
import { renderPdf } from "@/lib/pdf";
import type { ClientRecord, DesignEntry } from "@/lib/types";

export const runtime = "nodejs";
// Publishing renders the HTML to PDF (headless Chromium) — match the doc routes.
export const maxDuration = 300;

async function find(slug: string, id: string): Promise<{ client: ClientRecord; design: DesignEntry } | null> {
  const client = await getClient(slug);
  const design = client?.designs?.find((d) => d.id === id);
  if (!client || !design) return null;
  return { client, design };
}

/** Authed preview of the real file, whatever its status — this is how the team
 *  reviews a draft before publishing (the public path shows a holding page
 *  until then). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const hit = await find(slug, id);
  if (!hit) return new Response("Not found", { status: 404 });
  const res = await fetchAsset(hit.design.htmlUrl);
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const hit = await find(slug, id);
  if (!hit) return NextResponse.json({ error: "No such design." }, { status: 404 });
  const { client, design } = hit;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "publish") {
    // Render the concept to PDF once, now, so the public route serves a stored
    // file instead of launching Chromium on every client click. A stale PDF
    // from a previous publish is replaced.
    const res = await fetchAsset(design.htmlUrl);
    if (!res.ok) return NextResponse.json({ error: "The design file is missing." }, { status: 409 });
    let pdfUrl: string;
    try {
      const pdf = await renderPdf(await res.text(), { laptop: true });
      pdfUrl = await putAsset(`clients/${slug}/designs/design-${id}.pdf`, pdf, "application/pdf");
    } catch (e) {
      console.error(`[designs] PDF render failed for ${slug}/design-${id}:`, e);
      return NextResponse.json({ error: "Could not render the PDF. Try again." }, { status: 502 });
    }
    if (design.pdfUrl) await deleteAssets([design.pdfUrl]);
    design.pdfUrl = pdfUrl;
    design.status = "published";
  } else if (action === "unpublish") {
    // Drop the cached PDF — the public route falls back to the holding page.
    if (design.pdfUrl) await deleteAssets([design.pdfUrl]);
    design.pdfUrl = undefined;
    design.status = "draft";
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  design.updatedAt = new Date().toISOString();
  await saveClient(client);
  return NextResponse.json({ ok: true, designs: client.designs });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const design = client.designs?.find((d) => d.id === id);
  // Idempotent: deleting an already-gone slot is a success.
  if (design) {
    await deleteAssets([design.htmlUrl, ...(design.pdfUrl ? [design.pdfUrl] : [])]);
    client.designs = (client.designs ?? []).filter((d) => d.id !== id);
    await saveClient(client);
  }
  return NextResponse.json({ ok: true, designs: client.designs ?? [] });
}
