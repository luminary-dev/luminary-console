// Billing actions: generate advance/final invoices and receipts (Claude,
// arithmetic grounded in the quotation + billing history + change orders),
// publish/unpublish, revise.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { saveBillingDoc, todayLabel } from "@/lib/pipeline";
import { generateBilling, reviseDoc } from "@/lib/generate";
import type { QuotationData } from "@/lib/templates/docs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";

  try {
    if (action === "generate") {
      const kind = body.kind === "receipt" ? "receipt" : "invoice";
      const stage = ["advance", "final", "other"].includes(body.stage) ? body.stage : "other";
      const context = {
        quotation: (client.docs.quotation?.data as QuotationData) ?? null,
        priorBilling: (client.billing ?? []).map((b) => ({
          kind: b.kind,
          stage: b.stage,
          no: b.no,
          data: b.data,
        })),
        changeOrders: client.changeOrders ?? [],
      };
      const data = await generateBilling(client, kind, stage, context, instructions, todayLabel());
      const doc = await saveBillingDoc(client, kind, stage, data, "draft");
      await saveClient(client);
      return NextResponse.json({ ok: true, slug: doc.slug, no: doc.no });
    }

    const doc = (client.billing ?? []).find((b) => b.slug === String(body.doc || ""));
    if (!doc) return NextResponse.json({ error: "Billing document not found" }, { status: 404 });

    if (action === "publish" || action === "unpublish") {
      doc.status = action === "publish" ? "published" : "draft";
      doc.updatedAt = new Date().toISOString();
      await saveClient(client);
      return NextResponse.json({ ok: true, status: doc.status });
    }

    if (action === "regenerate") {
      if (!instructions) return NextResponse.json({ error: "Revision instructions required" }, { status: 400 });
      const data = await reviseDoc(client, doc.kind, doc.data, instructions, todayLabel());
      await saveBillingDoc(client, doc.kind, doc.stage, data, doc.status, doc.slug);
      await saveClient(client);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error(`Billing action ${action} failed:`, e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
