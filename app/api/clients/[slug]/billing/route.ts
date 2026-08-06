// Billing actions: generate advance/final invoices and receipts (Claude,
// arithmetic grounded in the quotation + billing history + change orders),
// publish/unpublish, revise.
import { NextResponse } from "next/server";
import { deleteAssets, getClient, saveClient } from "@/lib/store";
import { saveBillingDoc, todayLabel } from "@/lib/pipeline";
import { generateBilling, reviseDoc } from "@/lib/generate";
import { logActivity } from "@/lib/activity";
import { advanceStage } from "@/lib/stage";
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
      if (stage === "other" && !instructions) {
        return NextResponse.json(
          { error: "Describe the additional work and amount (invoice) or the payment received (receipt) first." },
          { status: 400 },
        );
      }
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
      await logActivity("operator", `generated ${stage} ${kind}`, slug, doc.no);
      return NextResponse.json({ ok: true, slug: doc.slug, no: doc.no });
    }

    const doc = (client.billing ?? []).find((b) => b.slug === String(body.doc || ""));
    if (!doc) return NextResponse.json({ error: "Billing document not found" }, { status: 404 });

    if (action === "publish" || action === "unpublish") {
      doc.status = action === "publish" ? "published" : "draft";
      doc.updatedAt = new Date().toISOString();
      // Lifecycle: the published final receipt marks delivery (starts the
      // 30-day warranty clock — delivered → warranty → closed).
      if (action === "publish" && doc.kind === "receipt" && doc.stage === "final") {
        advanceStage(client, "delivered");
      }
      await saveClient(client);
      await logActivity("operator", `${action}ed ${doc.stage} ${doc.kind}`, slug, doc.no);
      return NextResponse.json({ ok: true, status: doc.status });
    }

    if (action === "delete") {
      // Deleting a published document would break links a client may already
      // hold — the console unpublishes first, but enforce it here too.
      if (doc.status === "published") {
        return NextResponse.json(
          { error: "This document is published — unpublish it before deleting." },
          { status: 400 },
        );
      }
      await deleteAssets([doc.htmlUrl, doc.pdfUrl]);
      client.billing = (client.billing ?? []).filter((b) => b.slug !== doc.slug);
      await saveClient(client);
      await logActivity("operator", `deleted ${doc.stage} ${doc.kind}`, slug, doc.no);
      return NextResponse.json({ ok: true });
    }

    if (action === "regenerate") {
      if (!instructions) return NextResponse.json({ error: "Revision instructions required" }, { status: 400 });
      const data = await reviseDoc(client, doc.kind, doc.data, instructions, todayLabel());
      await saveBillingDoc(client, doc.kind, doc.stage, data, doc.status, doc.slug);
      await saveClient(client);
      await logActivity("operator", `regenerated ${doc.stage} ${doc.kind}`, slug, doc.no);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error(`Billing action ${action} failed:`, e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
