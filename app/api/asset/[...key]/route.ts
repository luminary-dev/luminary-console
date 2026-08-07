// Streams a private R2 object to the operator. The bucket is not public, so
// every console-side link to a stored asset (answers PDFs, archived renders,
// client-uploaded attachments) points here.
//
// Authorization is the console proxy's session gate: this path is not on its
// public allowlist, and on a client subdomain every path is rewritten under
// /c/<slug>/, so a client host can never reach it. Email bodies can't carry a
// session — those links are presigned R2 URLs instead (see signedAssetUrl).
//
// Two hardening details matter here. Attachments are CLIENT-supplied bytes
// and would otherwise render on the console's own origin, so responses carry
// a locked-down CSP, nosniff, and `attachment` disposition for everything
// that isn't a plainly inert type. And the key is re-validated against the
// store prefix (assetKey rejects traversal) — the route parameter is not
// trusted to stay inside our tree.
import { assetStream } from "@/lib/store";
import { STORE_PREFIX } from "@/lib/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Types safe to render in a tab. HTML and SVG are deliberately absent. */
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The four things `putAsset` actually writes. The store prefix alone also
 *  covered console/index.json, console/counter.json, every client's
 *  record.json (PII plus the operator's private notes) and console/state/*
 *  — including the session registry — none of which is an "asset" and none
 *  of which has any business being downloadable through this route. */
const ASSET_SUBTREE = /^console\/clients\/[^/]+\/(docs|billing|attachments)\/|^console\/clients\/[^/]+\/answers[.-]/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const ref = (key ?? []).join("/");
  if (!ref.startsWith(STORE_PREFIX) || !ASSET_SUBTREE.test(ref)) {
    return new Response("Not found", { status: 404 });
  }

  const object = await assetStream(ref).catch(() => null);
  if (!object) return new Response("Not found", { status: 404 });

  const type = object.contentType.split(";")[0].trim().toLowerCase();
  const inline = INLINE.has(type);
  const name = (object.key.split("/").pop() || "file").replace(/["\\\r\n]/g, "_");

  const headers = new Headers({
    "Content-Type": object.contentType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
    "Content-Security-Policy": inline ? "default-src 'none'" : "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
  });
  if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));

  return new Response(object.body, { headers });
}
