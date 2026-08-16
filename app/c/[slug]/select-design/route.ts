// Public portal action: the client picks which design concept they want us to
// build. Records the choice on the record, emails the studio and pings the
// Telegram group, and logs it. Same shape as the accept/comment routes —
// honeypot, rate limit, append-only, best-effort notifications. Only a
// PUBLISHED design on this client can be chosen.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { emailStudio } from "@/lib/email";
import { sendTelegram, tgEsc } from "@/lib/telegram";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { esc } from "@/lib/templates/shell";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
const STUDIO = process.env.STUDIO_EMAIL || "support@luminary-dev.xyz";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "comment");
  if (limited) return limited;

  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  // Honeypot → pretend success (same convention as the other portal actions).
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const design = client.designs?.find((d) => d.id === id);
  // Only a design that is actually published (i.e. visible to the client) can
  // be selected — naming a draft is a probe.
  if (!design || design.status !== "published") {
    return NextResponse.json({ error: "Please pick one of your design previews." }, { status: 400 });
  }
  const by = typeof body.by === "string" ? body.by.trim().slice(0, 120) : "";

  client.selectedDesign = { id: design.id, title: design.title, ...(by ? { by } : {}), at: new Date().toISOString() };
  await saveClient(client);
  await logActivity(by || "client", "selected a design", slug, design.title);

  const consoleUrl = `https://${CONSOLE_HOST}/clients/${client.slug}`;
  await emailStudio(
    `Design selected — ${client.company}`,
    `<p><strong>${esc(by || "The client")}</strong> selected a design concept from the ${esc(client.company)} client portal:</p>
<p><b>${esc(design.title)}</b> (concept ${esc(design.id)})</p>
<p>Proceed with this direction for development.</p>
<p><a href="${consoleUrl}">Open ${esc(client.company)} in the console →</a></p>`,
    [],
    client.email || STUDIO,
  );
  await sendTelegram(
    `🎨 <b>${tgEsc(client.company)}</b> — ${tgEsc(by || "Client")} selected a design: ${tgEsc(design.title)}\n<a href="${consoleUrl}">Open in console →</a>`,
  );

  return NextResponse.json({ ok: true, at: client.selectedDesign.at });
}
