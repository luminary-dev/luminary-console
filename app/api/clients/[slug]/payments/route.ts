// Payments recorded against the project (usually settling an invoice) — the
// numbers behind per-invoice paid state and the outstanding-balance math
// (outstanding = published invoices − payments). Recording a payment
// auto-advances the lifecycle to "development" (the advance is what starts
// the build).
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { advanceStage } from "@/lib/stage";
import { fmtLKR } from "@/lib/money";
import { logActivity } from "@/lib/activity";
import type { Payment } from "@/lib/types";

export const runtime = "nodejs";

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
      (typeof body.method === "string" && body.method.trim().slice(0, 60)) || "bank transfer";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
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
    await logActivity(
      "operator",
      "recorded payment",
      slug,
      `${fmtLKR(payment.amount)}${invoiceSlug ? ` against ${invoiceSlug}` : ""} (${method})`,
    );
    return NextResponse.json({ ok: true, payments: client.payments, stage: client.stage });
  }

  if (action === "remove") {
    const index = Number(body.index);
    if (!Number.isInteger(index) || !client.payments?.[index]) {
      return NextResponse.json({ error: "No such payment." }, { status: 404 });
    }
    const [gone] = client.payments.splice(index, 1);
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
