// Public portal action: the client accepts the published quotation by typing
// their full name (the form lives inside the rendered quotation page).
// Stores the acceptance, re-renders the quotation so the acceptance line is
// stamped into the web page + PDF + console preview, advances the lifecycle
// stage, emails the studio, and logs activity. Idempotent: a second accept
// answers ok/already instead of erroring.
import { NextResponse } from "next/server";
import { getClient, updateClient, StoreConflictError } from "@/lib/store";
import { saveDoc } from "@/lib/pipeline";
import { logger } from "@/lib/logger";
import { emailStudio } from "@/lib/email";
import { tgEsc } from "@/lib/telegram";
import { studioNotice } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { rateLimitShared, clientIp } from "@/lib/ratelimit";
import { requestPortalCode, verifyPortalCode } from "@/lib/portal-otp";
import { advanceStage } from "@/lib/stage";
import { esc } from "@/lib/templates/shell";
import { clipText } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = await rateLimitShared(req, "accept");
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

  const name = typeof body.name === "string" ? clipText(body.name.trim(), 120) : "";
  if (!name) {
    return NextResponse.json(
      { error: "Please type your full name to accept." },
      { status: 400 },
    );
  }

  // SEC-01: gate this binding action behind a one-time code emailed to the
  // client's on-file address. Phase 1 (no code): send a code and ask for it.
  // Phase 2 (code present): verify before recording. A client with no email on
  // file falls through to name-only (documented fallback). An OLD published
  // quotation's one-step form sends no code and gets { needsCode } with no
  // `ok`, so it shows an error rather than a false "accepted" — republish it to
  // get the code field.
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (client.email) {
    if (!code) {
      const sent = await requestPortalCode(slug, "accept", client.email, "quotation");
      return NextResponse.json({
        needsCode: true,
        ...(sent === "throttled" ? { note: "A code was sent moments ago. Check your email." } : {}),
      });
    }
    const result = await verifyPortalCode(slug, "accept", code);
    if (result !== "ok") {
      const error =
        result === "expired"
          ? "That code has expired. Request a new one."
          : result === "locked"
            ? "Too many attempts. Please request a new code shortly."
            : "That code isn't right. Please check your email and try again.";
      return NextResponse.json({ needsCode: true, error }, { status: 400 });
    }
  }

  const rawIp = clientIp(req);
  const ip = rawIp === "unknown" ? "" : rawIp;
  const acceptance = { name, at: new Date().toISOString(), ...(ip ? { ip } : {}) };

  // Re-render so the acceptance stamp shows everywhere the quotation renders.
  // Done ONCE here (Chromium is expensive) rather than inside the CAS retry;
  // it writes to the quotation's fixed asset keys and returns the stamped meta,
  // which the compare-and-swap below applies. Keep the original issue date (the
  // last render/publish time) — acceptance must not re-date the document.
  let rendered: Awaited<ReturnType<typeof saveDoc>> | null = null;
  try {
    const issuedMs = Date.parse(quotation.updatedAt);
    const issued = Number.isFinite(issuedMs)
      ? new Date(issuedMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Colombo" })
      : undefined;
    rendered = await saveDoc(client, "quotation", quotation.data, "published", issued);
  } catch (e) {
    // The acceptance itself must survive a render hiccup — the stamp appears
    // on the next re-render instead.
    logger.error("Quotation re-render after acceptance failed", { err: e });
  }

  // Compare-and-swap the binding write so a portal accept can't clobber a
  // concurrent operator edit of the same record, and two racing accepts can't
  // both win (AUDIT.md API-02; the missing capability check is SEC-01).
  let raced: { name: string; at: string } | null = null;
  let updated;
  try {
    updated = await updateClient(slug, (c) => {
      if (c.acceptance) {
        raced = { name: c.acceptance.name, at: c.acceptance.at };
        return;
      }
      c.acceptance = acceptance;
      advanceStage(c, "accepted");
      if (rendered) c.docs.quotation = rendered;
    });
  } catch (e) {
    if (e instanceof StoreConflictError) {
      return NextResponse.json({ error: "Please try again in a moment." }, { status: 409 });
    }
    throw e;
  }
  if (!updated) return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  if (raced) return NextResponse.json({ ok: true, already: true, ...(raced as { name: string; at: string }) });

  await logActivity(name, "accepted quotation", slug, quotation.no);

  await emailStudio(
    `Quotation accepted · ${client.company} (${quotation.no})`,
    `<p><strong>${esc(name)}</strong> accepted the ${esc(client.company)} quotation <b>${esc(quotation.no)}</b> from the client portal.</p>
<p>The acceptance is stamped on the quotation and the client is now at stage <b>accepted</b>.</p>
<p>Next step: move into the design stage; the <b>30% design-approval invoice</b> follows once the client approves the design:</p>
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open ${esc(client.company)} in the console →</a></p>`,
  );

  await studioNotice({
    title: "Quotation accepted",
    company: client.company,
    lines: [`${tgEsc(name)} accepted ${tgEsc(quotation.no)}`],
    url: `https://${CONSOLE_HOST}/clients/${client.slug}`,
  });

  return NextResponse.json({ ok: true, name, at: acceptance.at });
}
