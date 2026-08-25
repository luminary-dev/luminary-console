// One design slot: authed raw preview (GET), publish/unpublish (POST), and
// delete (DELETE). All behind the console session gate via proxy.ts. Designs
// are served as paths under the client subdomain, so there is no per-design DNS
// to tear down here.
import { NextResponse } from "next/server";
import { getClient, saveClient, fetchAsset, putAsset, deleteAssets } from "@/lib/store";
import { renderPdf } from "@/lib/pdf";
import { logger } from "@/lib/logger";
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

// LC-016: the console preview is the SAME untrusted operator-uploaded HTML the
// client subdomain serves, and here it was being served on the console origin
// itself — the origin that holds the session cookie, so strictly worse than
// the client-subdomain exposure. It gets the identical treatment: a minimal
// wrapper page whose sandboxed iframe (no `allow-same-origin`, so an opaque
// origin) loads the file from `?raw=1`. See the long note in
// app/c/[slug]/design/[id]/route.ts for why isolation beats sanitizing: these
// are prototypes and their own CSS/fonts/inline script have to keep working.
//
// proxy.ts gives a GET on this path the "document" CSP surface for the same
// reason; the strict console policy would block the wrapper's iframe outright.
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `src="?raw=1"` is relative to this page's own URL, so the wrapper needs to
 *  know nothing about the route it is serving. */
function wrapper(title: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style>
</head><body>
<iframe src="?raw=1" sandbox="${SANDBOX}" title="${esc(title)}"></iframe>
</body></html>`;
  return new Response(body, { status: 200, headers: HTML_HEADERS });
}

/** Authed preview of the real file, whatever its status — this is how the team
 *  reviews a draft before publishing (the public path shows a holding page
 *  until then). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const hit = await find(slug, id);
  if (!hit) return new Response("Not found", { status: 404 });

  // A top-level navigation to ?raw=1 would put the file back on the console
  // origin, so it is answered with the wrapper; the iframe inside it
  // re-requests the same URL as an iframe and gets the bytes.
  const raw = new URL(req.url).searchParams.get("raw") === "1";
  if (!raw || req.headers.get("sec-fetch-dest") === "document") return wrapper(hit.design.title);

  const res = await fetchAsset(hit.design.htmlUrl);
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(await res.arrayBuffer(), {
    headers: {
      ...HTML_HEADERS,
      // Applies to a direct hit as well as a framed one, so the opaque origin
      // does not depend on the wrapper being the way in.
      "Content-Security-Policy": `sandbox ${SANDBOX}`,
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
    design.status = "published";
    // Best-effort PDF caching: render a laptop-width PDF now so client
    // downloads are instant. Publishing must NOT depend on it — if the render
    // or upload fails, the design still goes live and the public download route
    // renders on the fly (the proven fallback). Drop any prior/stale PDF so we
    // never serve an out-of-date cache.
    const old = design.pdfUrl;
    delete design.pdfUrl;
    try {
      const res = await fetchAsset(design.htmlUrl);
      if (!res.ok) throw new Error(`design HTML asset not readable (status ${res.status})`);
      const pdf = await renderPdf(await res.text(), { laptop: true });
      design.pdfUrl = await putAsset(`clients/${slug}/designs/design-${id}.pdf`, pdf, "application/pdf");
    } catch (e) {
      // Logged so we can still diagnose the cache path; the client is
      // unaffected. Through lib/logger because the thrown value here is
      // typically an S3 error carrying a presigned URL (LC-017).
      logger.error("design PDF cache failed, serving on the fly", { slug, designId: id, err: e });
    }
    if (old && old !== design.pdfUrl) await deleteAssets([old]).catch(() => {});
  } else if (action === "unpublish") {
    // Drop the cached PDF — the public route falls back to the holding page.
    if (design.pdfUrl) await deleteAssets([design.pdfUrl]);
    delete design.pdfUrl;
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
