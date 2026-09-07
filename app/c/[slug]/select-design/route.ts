// Public portal action: the client picks which design concept they want us to
// build. Records the choice on the record, emails the studio and pings the
// Telegram group, and logs it. Same shape as the accept/comment routes —
// honeypot, rate limit, append-only, best-effort notifications. Only a
// PUBLISHED design on this client can be chosen.
import { NextResponse } from "next/server";
import { updateClient, StoreConflictError } from "@/lib/store";
import { emailStudio } from "@/lib/email";
import { tgEsc } from "@/lib/telegram";
import { studioNotice } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { esc } from "@/lib/templates/shell";
import { clipText } from "@/lib/errors";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
const STUDIO = process.env.STUDIO_EMAIL || "support@luminary-dev.xyz";

/** State-dependent failure raised from inside the compare-and-swap closure. */
class Reject {
  constructor(
    readonly status: number,
    readonly message: string,
  ) {}
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "comment");
  if (limited) return limited;

  const { slug } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  // Honeypot → pretend success (same convention as the other portal actions).
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const by = typeof body.by === "string" ? clipText(body.by.trim(), 120) : "";
  const at = new Date().toISOString();

  // The design must be published (visible to the client) — checked against the
  // FRESH record inside the compare-and-swap so the choice can't clobber a
  // concurrent edit and a design just unpublished can't be selected (API-02).
  let title = "";
  const client = await updateClient(slug, (c) => {
    const design = c.designs?.find((d) => d.id === id);
    if (!design || design.status !== "published") {
      throw new Reject(400, "Please pick one of your design previews.");
    }
    title = design.title;
    c.selectedDesign = { id: design.id, title: design.title, ...(by ? { by } : {}), at };
  }).catch((e: unknown) => {
    if (e instanceof Reject) return e;
    if (e instanceof StoreConflictError) return new Reject(409, "Please try again in a moment.");
    throw e;
  });
  if (client instanceof Reject) {
    return NextResponse.json({ error: client.message }, { status: client.status });
  }
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  await logActivity(by || "client", "selected a design", slug, title);

  const consoleUrl = `https://${CONSOLE_HOST}/clients/${client.slug}`;
  await emailStudio(
    `Design selected · ${client.company}`,
    `<p><strong>${esc(by || "The client")}</strong> selected a design concept from the ${esc(client.company)} client portal:</p>
<p><b>${esc(title)}</b> (concept ${esc(id)})</p>
<p>Proceed with this direction for development.</p>
<p><a href="${consoleUrl}">Open ${esc(client.company)} in the console →</a></p>`,
    [],
    client.email || STUDIO,
  );
  await studioNotice({
    title: "Design selected",
    company: client.company,
    lines: [`${tgEsc(by || "Client")} chose ${tgEsc(title)}`],
    url: consoleUrl,
  });

  return NextResponse.json({ ok: true, at });
}
