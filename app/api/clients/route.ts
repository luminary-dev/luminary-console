import { NextResponse } from "next/server";
import { getIndex, getClient, claimClientSlug, releaseClientSlug } from "@/lib/store";
import { runStage1 } from "@/lib/pipeline";
import { logOperatorActivity } from "@/lib/operator";
import { problemResponse } from "@/lib/errors";

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
    return NextResponse.json({ error: `"${slug}" is a reserved subdomain. Pick another slug.` }, { status: 400 });
  }
  if (await getClient(slug)) {
    return NextResponse.json({ error: `Client "${slug}" already exists.` }, { status: 409 });
  }
  // Atomically claim the slug for the duration of stage 1 (AUDIT.md API-06).
  // The check above is racy (LC-002 class), and stage 1 is expensive and
  // partly irreversible (Claude drafting, PDF render, DNS, a studio email), so
  // a fast double-submit or a retry-on-slow-response must not run it twice.
  if (!(await claimClientSlug(slug))) {
    return NextResponse.json(
      { error: `Client "${slug}" is already being created. Check the dashboard in a moment.` },
      { status: 409 },
    );
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
    const found = m?.[1];
    if (found) reg = found.replace(/\s+/g, "").toUpperCase();
  }

  const address = str(body.address);
  const email = str(body.email);
  const phone = str(body.phone);
  const contactName = str(body.contactName);

  try {
    const client = await runStage1({
      slug,
      company,
      brief,
      ...(reg ? { reg } : {}),
      ...(address ? { address } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(contactName ? { contactName } : {}),
    });
    await logOperatorActivity("created client", client.slug, company);
    return NextResponse.json({ ok: true, slug: client.slug });
  } catch (e) {
    // The whole stage-1 pipeline (drafting, rendering, DNS, mail) runs inside
    // this request, so `e` can be anything from a provider payload to an R2
    // key. None of it belongs in the browser (LC-005).
    // The record may be half-written, so the copy says "check", not "nothing
    // happened": stage 1 writes the client before it drafts and renders.
    const detail =
      "Creating the client did not complete. Check the dashboard before retrying, and quote the reference below if you report it.";
    const { body, status } = problemResponse(e, `client creation for ${slug}`);
    return NextResponse.json({ ...body, detail, error: detail }, { status });
  } finally {
    // Release the claim once stage 1 finishes either way: a successful create
    // is now guarded by the record's own existence (the getClient check), and
    // a failed one should be retryable after the operator checks/cleans up.
    await releaseClientSlug(slug);
  }
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}
