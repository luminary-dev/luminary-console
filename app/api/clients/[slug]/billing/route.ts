// Billing actions: generate design-approval/final invoices and receipts (Claude,
// arithmetic grounded in the quotation + billing history + change orders),
// publish/unpublish, revise.
import { NextResponse } from "next/server";
import { deleteAssets, getClient, saveClient } from "@/lib/store";
import { archiveVersion, saveBillingDoc, todayLabel } from "@/lib/pipeline";
import { generateBilling, reviseDoc } from "@/lib/generate";
import { logOperatorActivity } from "@/lib/operator";
import { advanceStage, revertDelivery } from "@/lib/stage";
import { problemResponse } from "@/lib/errors";
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
      const stage = ["advance", "progress", "final", "other"].includes(body.stage) ? body.stage : "other";
      if (stage === "other" && !instructions) {
        return NextResponse.json(
          { error: "Describe the additional work and amount (invoice) or the payment received (receipt) first." },
          { status: 400 },
        );
      }
      // Design-approval/final billing is arithmetic ON the quotation — the
      // default instruction is literally "invoice the standard 30% design-
      // approval milestone against the quotation total". With no quotation
      // there is nothing to ground on and the amount would be invented.
      if (stage !== "other" && !client.docs.quotation) {
        return NextResponse.json(
          {
            error:
              "There's no quotation to bill against: draft the quotation first, or use an additional invoice with explicit instructions.",
          },
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
      // Machine-readable due date for overdue detection (data.dueDate is the
      // model's display string). Same offsets generateBilling uses: design-
      // approval +7, delivery +14, additional +14. Invoices only.
      if (kind === "invoice") {
        const dueDays = stage === "progress" ? 7 : 14;
        doc.dueOn = new Date(Date.now() + dueDays * 86_400_000).toISOString();
      }
      await saveClient(client);
      await logOperatorActivity(`generated ${stage} ${kind}`, slug, doc.no);
      return NextResponse.json({ ok: true, slug: doc.slug, no: doc.no });
    }

    const doc = (client.billing ?? []).find((b) => b.slug === String(body.doc || ""));
    if (!doc) return NextResponse.json({ error: "Billing document not found" }, { status: 404 });

    if (action === "publish" || action === "unpublish") {
      doc.status = action === "publish" ? "published" : "draft";
      doc.updatedAt = new Date().toISOString();
      // Lifecycle: the published final receipt marks delivery (starts the
      // 30-day warranty clock: delivered, warranty, closed). Unpublishing it
      // takes the delivery stamp back off, otherwise an accidental
      // publish/unpublish left a spurious delivery date and a live warranty
      // commitment running off it (LC-025). doc.status is already "draft"
      // here, so revertDelivery sees the state it needs to judge.
      if (doc.kind === "receipt" && doc.stage === "final") {
        if (action === "publish") advanceStage(client, "delivered");
        else revertDelivery(client);
      }
      await saveClient(client);
      await logOperatorActivity(`${action}ed ${doc.stage} ${doc.kind}`, slug, doc.no);
      return NextResponse.json({ ok: true, status: doc.status });
    }

    if (action === "delete") {
      // Deleting a published document would break links a client may already
      // hold — the console unpublishes first, but enforce it here too.
      if (doc.status === "published") {
        return NextResponse.json(
          { error: "This document is published. Unpublish it before deleting." },
          { status: 400 },
        );
      }
      await deleteAssets([
        doc.htmlUrl,
        doc.pdfUrl,
        ...(doc.history ?? []).flatMap((v) => [v.htmlUrl, v.pdfUrl]),
      ]);
      client.billing = (client.billing ?? []).filter((b) => b.slug !== doc.slug);
      await saveClient(client);
      await logOperatorActivity(`deleted ${doc.stage} ${doc.kind}`, slug, doc.no);
      return NextResponse.json({ ok: true });
    }

    if (action === "regenerate") {
      // The handover pack has no AI-drafted data to revise — it is rebuilt
      // from the record by its own endpoint.
      if (doc.kind === "handover") {
        return NextResponse.json(
          { error: "Handover packs are rebuilt from the record: use Regenerate on the Handover pack card." },
          { status: 400 },
        );
      }
      if (!instructions) return NextResponse.json({ error: "Revision instructions required" }, { status: 400 });
      const data = await reviseDoc(client, doc.kind, doc.data, instructions, todayLabel());
      // Keep the render being replaced so the operator can compare/roll back.
      archiveVersion(doc);
      await saveBillingDoc(client, doc.kind, doc.stage, data, doc.status, doc.slug);
      await saveClient(client);
      await logOperatorActivity(`regenerated ${doc.stage} ${doc.kind}`, slug, doc.no);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    // One taxonomy, one shape, no internals on the wire (LC-005). The mapper
    // logs the real cause against the requestId it returns.
    const { body, status } = problemResponse(e, `billing action ${action} on ${slug}`);
    return NextResponse.json(body, { status });
  }
}
