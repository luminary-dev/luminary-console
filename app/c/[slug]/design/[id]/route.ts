// Public serving for a design preview at <slug>.ROOT/design/<id> (the proxy
// rewrites the client host + path here). A published design serves its file to
// anyone; a draft (or unknown) shows a noindex holding page so guessing the
// path never leaks unpublished work.
import { fetchAsset, getClient } from "@/lib/store";

export const runtime = "nodejs";

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

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
  return new Response(body, { status: 200, headers: HTML_HEADERS });
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

  const res = await fetchAsset(design.htmlUrl);
  if (!res.ok) return holding();
  return new Response(await res.arrayBuffer(), { headers: HTML_HEADERS });
}
