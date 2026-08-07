// Client-visible document page: <slug>.luminary-dev.xyz/<doc>.
// Only published documents are served.
import { fetchAsset, getClient } from "@/lib/store";
import type { DocType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
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
  const res = await fetchAsset(meta.htmlUrl);
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
