// Client-visible document page: <slug>.luminary-dev.xyz/<doc>.
// Only published documents are served.
import { fetchAsset, getClient } from "@/lib/store";
import { markDocView } from "@/lib/receipts";
import type { DocType } from "@/lib/types";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; doc: string }> },
) {
  const { slug, doc } = await params;
  const client = await getClient(slug);
  const meta =
    client?.docs[doc as DocType] ??
    client?.billing?.find((b) => b.slug === doc);
  if (!client || !meta || meta.status !== "published") {
    return new Response("Not found", { status: 404 });
  }
  // Read-receipt: only the CLIENT'S own view counts, not the operator preview
  // on the console host. Best-effort, throttled — never blocks the response.
  const host = ((req.headers.get("host") || "").split(":")[0] ?? "").toLowerCase();
  if (host !== CONSOLE_HOST) await markDocView(slug, doc);
  const res = await fetchAsset(meta.htmlUrl);
  // A published document whose stored render has gone missing must 404, not
  // serve an empty 200 — fetchAsset answers a missing key with a null body.
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
