// Payments recorded against the project (usually settling an invoice) — the
// numbers behind per-invoice paid state and the outstanding-balance math
// (outstanding = published invoices − payments). Recording a payment
// auto-advances the lifecycle to "development" (the 30% design-approval
// payment is what starts the build).
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { advanceStage } from "@/lib/stage";
import { fmtLKR } from "@/lib/money";
import { logActivity } from "@/lib/activity";
import { currentOperator } from "@/lib/operator";
import { displayName } from "@/lib/admins";
import { billingLabel } from "@/lib/doclabels";
import { tgEsc } from "@/lib/telegram";
import { studioNotice } from "@/lib/notify";
import { clipText } from "@/lib/errors";
import type { Payment } from "@/lib/types";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "add");

  if (action === "add") {
    const amount = typeof body.amount === "number" ? body.amount : NaN;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      return NextResponse.json(
        { error: "Amount must be a positive number of rupees." },
        { status: 400 },
      );
    }
    const method =
      (typeof body.method === "string" && clipText(body.method.trim(), 60)) || "bank transfer";
    const note = typeof body.note === "string" ? clipText(body.note.trim(), 300) : "";
    const invoiceSlug = typeof body.invoiceSlug === "string" ? body.invoiceSlug.trim() : "";
    if (invoiceSlug && !(client.billing ?? []).some((b) => b.kind === "invoice" && b.slug === invoiceSlug)) {
      return NextResponse.json({ error: "No such invoice." }, { status: 400 });
    }
    const at =
      typeof body.at === "string" && Number.isFinite(Date.parse(body.at))
        ? new Date(body.at).toISOString()
        : new Date().toISOString();
    const payment: Payment = {
      at,
      amount: Math.round(amount * 100) / 100,
      method,
      ...(note ? { note } : {}),
      ...(invoiceSlug ? { invoiceSlug } : {}),
    };
    client.payments = [...(client.payments ?? []), payment];
    advanceStage(client, "development");
    await saveClient(client);

    // Attribute to the signed-in admin (not a generic "operator") and label the
    // invoice by its stage/kind ("30% design-approval invoice") where we can.
    const actor = await currentOperator();
    const invoice = invoiceSlug
      ? (client.billing ?? []).find((b) => b.slug === invoiceSlug)
      : undefined;
    const invoiceName = invoice ? billingLabel(invoice) : "";
    await logActivity(
      actor,
      "recorded payment",
      slug,
      `${fmtLKR(payment.amount)}${invoiceName ? ` · ${invoiceName}` : ""} (${method})`,
    );

    // Team awareness: ping the studio Telegram + the admins' phones so money
    // in is seen without opening the console. Best-effort — never blocks.
    await studioNotice({
      title: "Payment recorded",
      company: client.company,
      lines: [
        `${tgEsc(displayName(actor))} recorded ${tgEsc(fmtLKR(payment.amount))}${invoiceName ? ` for the ${tgEsc(invoiceName)}` : ""}`,
        `Method: ${tgEsc(method)}`,
      ],
      url: `https://${CONSOLE_HOST}/clients/${client.slug}`,
    });

    return NextResponse.json({ ok: true, payments: client.payments, stage: client.stage });
  }

  if (action === "remove") {
    const index = Number(body.index);
    const payments = client.payments ?? [];
    const gone = Number.isInteger(index) ? payments[index] : undefined;
    if (!gone) {
      return NextResponse.json({ error: "No such payment." }, { status: 404 });
    }
    payments.splice(index, 1);
    await saveClient(client);
    await logActivity(
      "operator",
      "removed payment",
      slug,
      `${fmtLKR(gone.amount)}${gone.invoiceSlug ? ` against ${gone.invoiceSlug}` : ""}`,
    );
    return NextResponse.json({ ok: true, payments: client.payments });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
