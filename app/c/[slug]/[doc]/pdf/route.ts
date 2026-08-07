import { fetchAsset, getClient } from "@/lib/store";
import type { DocType } from "@/lib/types";
import { DOC_LABELS } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; doc: string }> },
) {
  const { slug, doc } = await params;
  const client = await getClient(slug);
  const billing = client?.billing?.find((b) => b.slug === doc);
  const meta = client?.docs[doc as DocType] ?? billing;
  if (!client || !meta || meta.status !== "published") {
    return new Response("Not found", { status: 404 });
  }
  const res = await fetchAsset(meta.pdfUrl);
  const label = billing
    ? `${billing.stage === "advance" ? "Advance " : billing.stage === "final" ? "Final " : ""}${DOC_LABELS[billing.kind]}`
    : DOC_LABELS[doc as DocType];
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${label} - ${client.company} - ${meta.no}.pdf"`,
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
