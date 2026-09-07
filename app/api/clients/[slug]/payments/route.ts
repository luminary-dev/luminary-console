// Payments recorded against the project (usually settling an invoice) — the
// numbers behind per-invoice paid state and the outstanding-balance math
// (outstanding = published invoices − payments). Recording a payment
// auto-advances the lifecycle to "development" (the 30% design-approval
// payment is what starts the build).
import { NextResponse } from "next/server";
import { updateClient, StoreConflictError } from "@/lib/store";
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

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "add");

  // State-dependent validation lives inside the compare-and-swap closure and
  // signals failure with this sentinel, so it re-checks the FRESH record on
  // every retry rather than a copy read before the race (AUDIT.md API-02).
  class Reject {
    constructor(
      readonly status: number,
      readonly message: string,
    ) {}
  }

  try {
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

      const updated = await updateClient(slug, (client) => {
        if (
          invoiceSlug &&
          !(client.billing ?? []).some((b) => b.kind === "invoice" && b.slug === invoiceSlug)
        ) {
          throw new Reject(400, "No such invoice.");
        }
        client.payments = [...(client.payments ?? []), payment];
        advanceStage(client, "development");
      });
      if (!updated) return NextResponse.json({ error: "Client not found" }, { status: 404 });

      // Side effects run AFTER the write lands, using the persisted record —
      // the mutate closure above may re-run and must stay pure.
      const actor = await currentOperator();
      const invoice = invoiceSlug
        ? (updated.billing ?? []).find((b) => b.slug === invoiceSlug)
        : undefined;
      const invoiceName = invoice ? billingLabel(invoice) : "";
      await logActivity(
        actor,
        "recorded payment",
        slug,
        `${fmtLKR(payment.amount)}${invoiceName ? ` · ${invoiceName}` : ""} (${method})`,
      );

      await studioNotice({
        title: "Payment recorded",
        company: updated.company,
        lines: [
          `${tgEsc(displayName(actor))} recorded ${tgEsc(fmtLKR(payment.amount))}${invoiceName ? ` for the ${tgEsc(invoiceName)}` : ""}`,
          `Method: ${tgEsc(method)}`,
        ],
        url: `https://${CONSOLE_HOST}/clients/${updated.slug}`,
      });

      return NextResponse.json({ ok: true, payments: updated.payments, stage: updated.stage });
    }

    if (action === "remove") {
      const index = Number(body.index);
      // Optional stable-identity guard: when the client sends the payment's
      // timestamp, refuse if the row at `index` shifted underneath it, so a
      // concurrent add/remove can't make the index delete the wrong payment.
      const expectedAt = typeof body.at === "string" ? body.at : null;
      let gone: Payment | undefined;
      const updated = await updateClient(slug, (client) => {
        const payments = client.payments ?? [];
        const target = Number.isInteger(index) ? payments[index] : undefined;
        if (!target || (expectedAt !== null && target.at !== expectedAt)) {
          throw new Reject(404, "No such payment.");
        }
        gone = target;
        payments.splice(index, 1);
        client.payments = payments;
      });
      if (!updated) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      await logActivity(
        "operator",
        "removed payment",
        slug,
        `${fmtLKR(gone!.amount)}${gone!.invoiceSlug ? ` against ${gone!.invoiceSlug}` : ""}`,
      );
      return NextResponse.json({ ok: true, payments: updated.payments });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof Reject) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof StoreConflictError) {
      return NextResponse.json(
        { error: "That client was being edited at the same time. Please retry." },
        { status: 409 },
      );
    }
    throw e;
  }
}
