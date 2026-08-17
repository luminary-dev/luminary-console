// Public portal action: the client e-signs the published Services Agreement by
// typing their full name (the form lives inside the rendered contract page).
// Stores the signature, re-renders the contract so the signature is stamped
// into the web page + PDF + console preview, advances the lifecycle stage,
// emails + Telegrams the studio, and logs it. Idempotent: a second sign
// answers ok/already. Electronic signatures are valid under Sri Lanka's
// Electronic Transactions Act No. 19 of 2006.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { saveDoc } from "@/lib/pipeline";
import { emailStudio } from "@/lib/email";
import { sendTelegram, tgEsc, tgNotice } from "@/lib/telegram";
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

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Please type your full name to sign." }, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  client.contractSignature = { name, at: new Date().toISOString(), ...(ip ? { ip } : {}) };
  advanceStage(client, "accepted");

  // Re-render so the signature stamp shows everywhere the contract renders,
  // keeping the original issue date so signing doesn't re-date the document.
  try {
    const issuedMs = Date.parse(contract.updatedAt);
    const issued = Number.isFinite(issuedMs)
      ? new Date(issuedMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Colombo" })
      : undefined;
    await saveDoc(client, "contract", contract.data, "published", issued);
  } catch (e) {
    console.error("Contract re-render after signing failed:", e);
  }
  await saveClient(client);
  await logActivity(name, "signed the contract", slug, contract.no);

  await emailStudio(
    `Agreement signed — ${client.company} (${contract.no})`,
    `<p><strong>${esc(name)}</strong> e-signed the ${esc(client.company)} Services Agreement <b>${esc(contract.no)}</b> from the client portal.</p>
<p>The signature is stamped on the agreement and the client is at stage <b>accepted</b>.</p>
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open ${esc(client.company)} in the console →</a></p>`,
  );
  await sendTelegram(
    tgNotice({
      emoji: "🖊️",
      title: "Agreement signed",
      company: client.company,
      lines: [`${tgEsc(name)} signed ${tgEsc(contract.no)}`],
      url: `https://${CONSOLE_HOST}/clients/${client.slug}`,
    }),
  );

  return NextResponse.json({ ok: true, name, at: client.contractSignature.at });
}
