// Public serving for a design preview at <slug>.ROOT/design/<id> (the proxy
// rewrites the client host + path here). A published design serves its HTML so
// the client can view the concept live; a downloadable PDF of the same concept
// lives at /design/<id>/pdf. A draft (or unknown) shows a noindex holding page
// so guessing the path never leaks unpublished work.
//
// LC-016 — ISOLATION, and why it is an iframe and not a CSP or a sanitizer.
//
// A design is an arbitrary HTML file an operator uploaded. It used to be
// served straight back with `Content-Type: text/html` on the client
// subdomain, i.e. on the same origin as the portal and the portal's
// `lum_visit_<slug>` cookie, so anything in it ran with that origin's
// authority.
//
// Three options were on the table:
//   1. Sanitize the HTML. Rejected outright: these are design PROTOTYPES.
//      Their whole job is to demo interactions, so they legitimately carry
//      their own CSS, webfonts and inline script. A sanitizer that leaves
//      that intact removes nothing; one that removes it breaks the product.
//   2. A restrictive CSP on this subtree. Better, but it is still the client
//      origin: a CSP can constrain what the page reaches, and it can be
//      loosened by accident, but it does not stop the document reading
//      document.cookie or localStorage for the origin it is on.
//   3. What is implemented: this path now answers a minimal WRAPPER page, and
//      the uploaded file is loaded into a `sandbox`ed iframe inside it. With
//      no `allow-same-origin` the browser gives the framed document an OPAQUE
//      origin, so it cannot touch the portal's cookies, storage, or DOM
//      whatever it contains, while scripts, styles, fonts and forms inside it
//      keep working exactly as the designer built them.
//
// Chosen (3) because it is the only one that keeps the prototype whole and
// still removes the authority. It is enforced by the browser's sandbox rules
// rather than by a header we might mis-merge with the proxy's own CSP.
//
// Known cost, accepted: an opaque origin has no localStorage, so a prototype
// that persists state across a reload will throw where it used to work. That
// is a demo affordance; the alternative is arbitrary script on a live client
// origin.
//
// The raw bytes stay reachable at `?raw=1` because the iframe has to load
// them from somewhere. Two things stop that becoming the old hole: the
// response carries its own `sandbox` CSP (which applies to a direct hit as
// well as a framed one), and a TOP-LEVEL navigation to it is bounced back to
// the wrapper via Sec-Fetch-Dest, so the URL a person can actually land on is
// always the isolated one.
import { fetchAsset, getClient } from "@/lib/store";

export const runtime = "nodejs";

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

/** Sandbox flags shared by the iframe attribute and the CSP on the raw
 *  response. `allow-same-origin` is the one that must never appear: it is
 *  what hands the origin back. `allow-top-navigation` is omitted too, so a
 *  design cannot navigate the client's tab somewhere else. */
const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox";

const RAW_HEADERS = {
  ...HTML_HEADERS,
  // Applies even when the file is fetched directly rather than framed, so the
  // opaque origin is not conditional on the wrapper being used.
  "Content-Security-Policy": `sandbox ${SANDBOX}`,
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

/** The wrapper. `src="?raw=1"` is relative to the page's own URL, so the same
 *  markup works on the client subdomain (/design/2) and on the console's
 *  direct /c/<slug>/design/2 preview without either having to know its path. */
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

/** A top-level navigation to the raw file would put it back on the real
 *  origin, so it is answered with the wrapper instead (whose iframe then
 *  re-requests the same URL and gets the bytes). Sec-Fetch-Dest is "iframe"
 *  for the wrapper's own load and "document" only for a real navigation; a
 *  client that sends neither (curl, an old browser) is not a victim of
 *  anything and is served the bytes. */
function isTopLevelNavigation(req: Request): boolean {
  return req.headers.get("sec-fetch-dest") === "document";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const client = await getClient(slug);
  const design = client?.designs?.find((d) => d.id === id);
  if (!client || !design) return new Response("Not found", { status: 404 });
  if (design.status !== "published") return holding();

  const raw = new URL(req.url).searchParams.get("raw") === "1";
  if (!raw || isTopLevelNavigation(req)) return wrapper(design.title);

  const res = await fetchAsset(design.htmlUrl);
  if (!res.ok) return holding();
  return new Response(await res.arrayBuffer(), { headers: RAW_HEADERS });
}
