import { fetchAsset, getClient } from "@/lib/store";
import { billingLabel } from "@/lib/doclabels";
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
  if (!res.ok) return new Response("Not found", { status: 404 });
  const label = billing ? billingLabel(billing) : DOC_LABELS[doc as DocType];
  // Header values are ByteStrings: a company name with a quote breaks the
  // quoting and one non-Latin-1 character (a Sinhala or Tamil trading name)
  // makes the Response constructor throw, turning a PDF into a 500. Send an
  // ASCII-safe fallback plus the real UTF-8 name per RFC 5987.
  const filename = `${label} - ${client.company} - ${meta.no}.pdf`;
  const ascii = filename.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_");
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
