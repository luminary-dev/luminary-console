import { NextResponse } from "next/server";
import { getIndex, getClient } from "@/lib/store";
import { runStage1 } from "@/lib/pipeline";
import { logOperatorActivity } from "@/lib/operator";

export const runtime = "nodejs";
export const maxDuration = 300;

// Subdomains that already mean something (or ever could): a client slug
// becomes <slug>.luminary-dev.xyz, and client DELETION removes that CNAME —
// a client named "console" or "dev" would tear down real infrastructure.
const RESERVED_SLUGS = new Set([
  "console", "dev", "www", "api", "app", "admin", "mail", "smtp", "imap",
  "pop", "mx", "webmail", "autodiscover", "autoconfig", "dmarc", "ns1", "ns2",
  "ftp", "cdn", "assets", "static", "status", "blog", "docs", "support",
  "help", "staging", "test", "preview", "vercel", "luminary",
]);

export async function GET() {
  return NextResponse.json(await getIndex());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const company = String(body.company || "").trim();
  const brief = String(body.brief || "").trim();
  let slug = String(body.slug || "").trim().toLowerCase();
  if (!company || !brief) {
    return NextResponse.json({ error: "Company name and brief are required." }, { status: 400 });
  }
  if (!slug) {
    slug = company
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 2)
      .join("-");
  }
  // A slug becomes a DNS label, so it may not END in a hyphen either —
  // Cloudflare rejects "acme-" and the client would be created with a
  // subdomain that can never be provisioned.
  if (!/^[a-z0-9][a-z0-9-]{0,39}[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ error: "Slug must be lowercase letters, digits and dashes." }, { status: 400 });
  }
  if (RESERVED_SLUGS.has(slug) || slug.startsWith("_")) {
    return NextResponse.json({ error: `"${slug}" is a reserved subdomain — pick another slug.` }, { status: 400 });
  }
  if (await getClient(slug)) {
    return NextResponse.json({ error: `Client "${slug}" already exists.` }, { status: 409 });
  }

  // Reg no left blank? Pull it out of the brief automatically if it's there
  // (operators often paste the client's letterhead details into the brief).
  let reg = str(body.reg);
  if (!reg) {
    const m =
      brief.match(/\breg(?:istration)?\.?\s*no\.?\s*:?\s*([A-Z]{1,3}\s?\d{4,8})/i) ||
      brief.match(/\b(P[VBQ]\s?\d{5,8})\b/i);
    // Uppercase it: the regexes are case-insensitive, so a brief that says
    // "reg no pv110496" would otherwise print lowercase on the letterhead of
    // every document this client ever gets.
    if (m) reg = m[1].replace(/\s+/g, "").toUpperCase();
  }

  try {
    const client = await runStage1({
      slug,
      company,
      brief,
      reg,
      address: str(body.address),
      email: str(body.email),
      phone: str(body.phone),
      contactName: str(body.contactName),
    });
    await logOperatorActivity("created client", client.slug, company);
    return NextResponse.json({ ok: true, slug: client.slug });
  } catch (e) {
    console.error("Client creation failed:", e);
    return NextResponse.json({ error: `Creation failed: ${String(e)}` }, { status: 500 });
  }
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}
