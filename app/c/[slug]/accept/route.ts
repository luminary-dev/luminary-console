// Public portal action: the client accepts the published quotation by typing
// their full name (the form lives inside the rendered quotation page).
// Stores the acceptance, re-renders the quotation so the acceptance line is
// stamped into the web page + PDF + console preview, advances the lifecycle
// stage, emails the studio, and logs activity. Idempotent: a second accept
// answers ok/already instead of erroring.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { saveDoc } from "@/lib/pipeline";
import { emailStudio } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { advanceStage } from "@/lib/stage";
import { esc } from "@/lib/templates/shell";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "accept");
  if (limited) return limited;

  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot → pretend success (same convention as the questionnaire).
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const quotation = client.docs.quotation;
  if (!quotation || quotation.status !== "published") {
    return NextResponse.json(
      { error: "There's no published quotation to accept." },
      { status: 404 },
    );
  }

  // Already accepted → friendly, idempotent.
  if (client.acceptance) {
    return NextResponse.json({
      ok: true,
      already: true,
      name: client.acceptance.name,
      at: client.acceptance.at,
    });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) {
    return NextResponse.json(
      { error: "Please type your full name to accept." },
      { status: 400 },
    );
  }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  client.acceptance = { name, at: new Date().toISOString(), ...(ip ? { ip } : {}) };
  advanceStage(client, "accepted");

  // Re-render so the acceptance stamp shows everywhere the quotation renders.
  // Keep the original issue date (the last render/publish time) — acceptance
  // must not re-date the document.
  try {
    const issuedMs = Date.parse(quotation.updatedAt);
    const issued = Number.isFinite(issuedMs)
      ? new Date(issuedMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Colombo" })
      : undefined;
    await saveDoc(client, "quotation", quotation.data, "published", issued);
  } catch (e) {
    // The acceptance itself must survive a render hiccup — the stamp appears
    // on the next re-render instead.
    console.error("Quotation re-render after acceptance failed:", e);
  }
  await saveClient(client);
  await logActivity(name, "accepted quotation", slug, quotation.no);

  await emailStudio(
    `Quotation accepted — ${client.company} (${quotation.no})`,
    `<p><strong>${esc(name)}</strong> accepted the ${esc(client.company)} quotation <b>${esc(quotation.no)}</b> from the client portal.</p>
<p>The acceptance is stamped on the quotation and the client is now at stage <b>accepted</b>.</p>
<p>Next step: generate and publish the <b>advance invoice</b>:</p>
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open ${esc(client.company)} in the console →</a></p>`,
  );

  return NextResponse.json({ ok: true, name, at: client.acceptance.at });
}
