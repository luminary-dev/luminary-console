// Document actions from the console: publish / unpublish / regenerate with
// instructions / generate billing docs (invoice, receipt) / retry stage-2.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { saveDoc, runStage2, todayLabel } from "@/lib/pipeline";
import { reviseDoc } from "@/lib/generate";
import type { DocType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const TYPES: DocType[] = ["estimate", "quotation", "invoice", "receipt", "contract", "proposal"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; type: string }> },
) {
  const { slug, type } = await params;
  if (!TYPES.includes(type as DocType)) {
    return NextResponse.json({ error: "Unknown doc type" }, { status: 400 });
  }
  const docType = type as DocType;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";

  try {
    if (action === "publish" || action === "unpublish") {
      const meta = client.docs[docType];
      if (!meta) return NextResponse.json({ error: "Document not generated yet" }, { status: 404 });
      meta.status = action === "publish" ? "published" : "draft";
      meta.updatedAt = new Date().toISOString();
      await saveClient(client);
      return NextResponse.json({ ok: true, status: meta.status });
    }

    if (action === "regenerate") {
      const meta = client.docs[docType];
      if (!meta) return NextResponse.json({ error: "Document not generated yet" }, { status: 404 });
      if (!instructions) return NextResponse.json({ error: "Revision instructions required" }, { status: 400 });
      const data = await reviseDoc(client, docType, meta.data, instructions, todayLabel());
      const updated = await saveDoc(client, docType, data, meta.status);
      await saveClient(client);
      return NextResponse.json({ ok: true, status: updated.status });
    }

    // (Invoice/receipt generation moved to /api/clients/[slug]/billing —
    // the payment arc supports multiple invoices and receipts per client.)

    if (action === "retry-stage2") {
      if (!client.answersUrl) return NextResponse.json({ error: "No answers submitted yet" }, { status: 400 });
      const res = await fetch(client.answersUrl, { cache: "no-store" });
      const answers = await res.json();
      await runStage2(slug, answers, client.answersAt || "");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error(`Doc action ${action} failed:`, e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
