// Console-only preview of any generated doc (draft or published) — the proxy
// auth gate covers this path on the console host.
import { fetchAsset, getClient } from "@/lib/store";
import type { DocType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; type: string }> },
) {
  const { slug, type } = await params;
  const client = await getClient(slug);
  // Core doc type ("invoice") or billing slug ("invoice-2").
  const meta = client?.docs[type as DocType] ?? client?.billing?.find((b) => b.slug === type);
  if (!client || !meta) return new Response("Not found", { status: 404 });
  const res = await fetchAsset(meta.pdfUrl && type === "pdf" ? meta.pdfUrl : meta.htmlUrl);
  return new Response(await res.arrayBuffer(), {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}
