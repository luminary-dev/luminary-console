// Downloadable PDF of a published design preview at
// <slug>.ROOT/design/<id>/pdf. Serves the PDF rendered and stored at publish
// time (laptop-width, full page — see lib/pdf.ts); records published before
// caching, or a missing cache file, fall back to rendering on the fly. Drafts
// and unknown slots yield the same noindex holding page the HTML route shows,
// so guessing a path never renders unpublished work.
import { fetchAsset, getClient } from "@/lib/store";
import { renderPdf } from "@/lib/pdf";

export const runtime = "nodejs";
// The fallback render launches headless Chromium — match the doc PDF routes.
export const maxDuration = 300;

function holding(): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Preview not published</title>
<style>html,body{height:100%}body{margin:0;display:grid;place-items:center;background:#0f110f;color:#ececec;
font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.b{text-align:center;padding:2rem;max-width:32rem}h1{font-size:1.25rem;margin:0 0 .5rem}
p{margin:0;color:#9aa096;font-size:.95rem;line-height:1.6}</style></head>
<body><div class="b"><h1>This preview is not published yet</h1>
<p>The design is still being prepared. Please check back once it has been shared with you.</p></div></body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const client = await getClient(slug);
  const design = client?.designs?.find((d) => d.id === id);
  if (!client || !design) return new Response("Not found", { status: 404 });
  if (design.status !== "published") return holding();

  const filename = `${slug}-design-${id}.pdf`;
  const headers = {
    "Content-Type": "application/pdf",
    // attachment: this is the explicit "Download PDF" action.
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
  };

  // Fast path: the PDF rendered and stored at publish time.
  if (design.pdfUrl) {
    const cached = await fetchAsset(design.pdfUrl);
    if (cached.ok) return new Response(await cached.arrayBuffer(), { headers });
  }

  // Fallback: no cached PDF (published before caching, or the file went
  // missing) — render from the HTML at laptop width on the fly.
  const res = await fetchAsset(design.htmlUrl);
  if (!res.ok) return holding();
  const pdf = await renderPdf(await res.text(), { laptop: true });
  return new Response(pdf as unknown as BodyInit, { headers });
}
