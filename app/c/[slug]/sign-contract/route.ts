// Public portal action: the client e-signs the published Services Agreement by
// typing their full name (the form lives inside the rendered contract page).
// Stores the signature, re-renders the contract so the signature is stamped
// into the web page + PDF + console preview, advances the lifecycle stage,
// emails + Telegrams the studio, and logs it. Idempotent: a second sign
// answers ok/already. Electronic signatures are valid under Sri Lanka's
// Electronic Transactions Act No. 19 of 2006.
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
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const contract = client.docs.contract;
  if (!contract || contract.status !== "published") {
    return NextResponse.json({ error: "There's no published agreement to sign." }, { status: 404 });
  }

  if (client.contractSignature) {
    return NextResponse.json({ ok: true, already: true, name: client.contractSignature.name, at: client.contractSignature.at });
  }

  const name = typeof body.name === "string" ? clipText(body.name.trim(), 120) : "";
  if (!name) return NextResponse.json({ error: "Please type your full name to sign." }, { status: 400 });

  // SEC-01: gate the e-signature behind a one-time code emailed to the client's
  // on-file address (same two-phase flow as accept). Email-less clients fall
  // through to name-only; an old published contract's one-step form gets
  // { needsCode } with no `ok` and shows an error until republished.
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (client.email) {
    if (!code) {
      const sent = await requestPortalCode(slug, "sign", client.email, "agreement");
      return NextResponse.json({
        needsCode: true,
        ...(sent === "throttled" ? { note: "A code was sent moments ago. Check your email." } : {}),
      });
    }
    const result = await verifyPortalCode(slug, "sign", code);
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
  const signature = { name, at: new Date().toISOString(), ...(ip ? { ip } : {}) };

  // Re-render once (Chromium is expensive) so the signature stamp shows
  // everywhere the contract renders, keeping the original issue date so signing
  // doesn't re-date the document. The stamped meta is applied by the CAS below.
  let rendered: Awaited<ReturnType<typeof saveDoc>> | null = null;
  try {
    const issuedMs = Date.parse(contract.updatedAt);
    const issued = Number.isFinite(issuedMs)
      ? new Date(issuedMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Colombo" })
      : undefined;
    rendered = await saveDoc(client, "contract", contract.data, "published", issued);
  } catch (e) {
    logger.error("Contract re-render after signing failed", { err: e });
  }

  // Compare-and-swap the binding signature (AUDIT.md API-02; SEC-01 covers the
  // missing capability check) so it can't clobber a concurrent record edit and
  // two racing signs can't both win.
  let raced: { name: string; at: string } | null = null;
  let updated;
  try {
    updated = await updateClient(slug, (c) => {
      if (c.contractSignature) {
        raced = { name: c.contractSignature.name, at: c.contractSignature.at };
        return;
      }
      c.contractSignature = signature;
      advanceStage(c, "accepted");
      if (rendered) c.docs.contract = rendered;
    });
  } catch (e) {
    if (e instanceof StoreConflictError) {
      return NextResponse.json({ error: "Please try again in a moment." }, { status: 409 });
    }
    throw e;
  }
  if (!updated) return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  if (raced) return NextResponse.json({ ok: true, already: true, ...(raced as { name: string; at: string }) });

  await logActivity(name, "signed the contract", slug, contract.no);

  await emailStudio(
    `Agreement signed · ${client.company} (${contract.no})`,
    `<p><strong>${esc(name)}</strong> e-signed the ${esc(client.company)} Services Agreement <b>${esc(contract.no)}</b> from the client portal.</p>
<p>The signature is stamped on the agreement and the client is at stage <b>accepted</b>.</p>
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open ${esc(client.company)} in the console →</a></p>`,
  );
  await studioNotice({
    title: "Agreement signed",
    company: client.company,
    lines: [`${tgEsc(name)} signed ${tgEsc(contract.no)}`],
    url: `https://${CONSOLE_HOST}/clients/${client.slug}`,
  });

  return NextResponse.json({ ok: true, name, at: signature.at });
}
