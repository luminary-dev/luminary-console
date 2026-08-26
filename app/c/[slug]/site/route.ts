// Client-facing finalized-site entry at <slug>.luminary-dev.xyz/site. Once the
// site is PUBLISHED and its build is READY this redirects to the live site;
// otherwise (a repo is deployed but not yet published/ready) it shows a branded
// "under maintenance" page so the path is always safe for a client to visit.
// Unknown/no-site → 404.
import { getClient } from "@/lib/store";

export const runtime = "nodejs";

function maintenance(company: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Coming soon</title>
<style>html,body{height:100%}body{margin:0;display:grid;place-items:center;background:#0b0b0d;color:#f4f4f5;
font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.b{text-align:center;padding:2rem;max-width:34rem}
.mark{font-weight:800;letter-spacing:-.04em;font-size:22px}.mark span{color:#a3e635}
h1{font-size:1.4rem;margin:22px 0 .5rem;letter-spacing:-.02em}
p{margin:0;color:#8a8a92;font-size:1rem;line-height:1.65}
.tag{display:inline-block;margin-top:20px;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.16em;
text-transform:uppercase;color:#8a8a92;border:1px solid rgba(255,255,255,.16);border-radius:100px;padding:6px 14px}</style></head>
<body><div class="b"><div class="mark">Luminary<span>.</span></div>
<h1>Your website is being prepared</h1>
<p>${esc(company)}'s new site is almost ready. We're putting the finishing touches in place. Please check back shortly.</p>
<div class="tag">Under maintenance</div></div></body></html>`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client || !client.site) return new Response("Not found", { status: 404 });

  const s = client.site;
  if (s.status === "published" && s.state === "READY" && s.url) {
    return Response.redirect(s.url, 307);
  }
  return maintenance(client.company);
}
