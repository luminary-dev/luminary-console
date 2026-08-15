// Public serving for a design preview at <slug>.ROOT/design/<id> (the proxy
// rewrites the client host + path here). The design source is an HTML
// prototype, but a client may only ever take away a flat PDF of it — never the
// HTML itself — so a *published* slot serves the PDF that was rendered and
// stored at publish time (see the publish action). Records published before
// caching, or a missing cache file, fall back to rendering on the fly. A draft
// (or unknown) shows a noindex holding page so guessing the path never leaks
// unpublished work, and the HTML source is never exposed on the client host.
// The team still reviews the real HTML through the authed console preview
// (/api/clients/<slug>/designs/<id>).
import { fetchAsset, getClient } from "@/lib/store";
import { renderPdf } from "@/lib/pdf";

export const runtime = "nodejs";
// Rendering launches headless Chromium — match the doc PDF routes' ceiling.
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
    // inline: opens in the browser's PDF viewer (and is saveable from there);
    // the client gets the design as a PDF and nothing else.
    "Content-Disposition": `inline; filename="${filename}"`,
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
  };

  // Fast path: serve the PDF rendered and stored at publish time.
  if (design.pdfUrl) {
    const cached = await fetchAsset(design.pdfUrl);
    if (cached.ok) return new Response(await cached.arrayBuffer(), { headers });
  }

  // Fallback: no cached PDF (published before caching, or the file went
  // missing) — render from the HTML on the fly.
  const res = await fetchAsset(design.htmlUrl);
  if (!res.ok) return holding();
  const pdf = await renderPdf(await res.text());
  return new Response(pdf as unknown as BodyInit, { headers });
}
