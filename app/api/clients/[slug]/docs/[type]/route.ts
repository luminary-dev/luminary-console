// Document actions from the console: publish / unpublish / regenerate with
// instructions / generate billing docs (invoice, receipt) / retry stage-2.
import { NextResponse } from "next/server";
import { deleteAssets, fetchAsset, getClient, saveClient } from "@/lib/store";
import { archiveVersion, saveDoc, runStage2, todayLabel } from "@/lib/pipeline";
import { reviseDoc } from "@/lib/generate";
import { logOperatorActivity } from "@/lib/operator";
import { advanceStage } from "@/lib/stage";
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
      // Lifecycle: a published quotation means the client is "quoted".
      if (action === "publish" && docType === "quotation") advanceStage(client, "quoted");
      await saveClient(client);
      await logOperatorActivity(`${action}ed ${docType}`, slug, meta.no);
      return NextResponse.json({ ok: true, status: meta.status });
    }

    if (action === "delete") {
      const meta = client.docs[docType];
      if (!meta) return NextResponse.json({ error: "Document not generated yet" }, { status: 404 });
      // Same rule as billing: a published document has a live URL the client
      // may hold, so it must be unpublished first (the console does that as a
      // separate confirmed step).
      if (meta.status === "published") {
        return NextResponse.json(
          { error: "This document is published — unpublish it before deleting." },
          { status: 400 },
        );
      }
      await deleteAssets([
        meta.htmlUrl,
        meta.pdfUrl,
        ...(meta.history ?? []).flatMap((h) => [h.htmlUrl, h.pdfUrl]),
      ]);
      delete client.docs[docType];
      await saveClient(client);
      await logOperatorActivity(`deleted ${docType}`, slug, meta.no);
      return NextResponse.json({ ok: true });
    }

    if (action === "regenerate") {
      const meta = client.docs[docType];
      if (!meta) return NextResponse.json({ error: "Document not generated yet" }, { status: 404 });
      if (!instructions) return NextResponse.json({ error: "Revision instructions required" }, { status: 400 });
      const today = todayLabel();
      const data = await reviseDoc(client, docType, meta.data, instructions, today);
      // Keep the render being replaced so the operator can compare/roll back.
      archiveVersion(meta);
      const updated = await saveDoc(client, docType, data, meta.status);

      // Cascade: apply the SAME instruction to the other project documents so
      // one edit propagates instead of being re-typed into each. Each sibling
      // is revised with the just-revised primary doc as context (so they stay
      // consistent), archived, and re-rendered keeping its own status. Only the
      // estimate/quotation/proposal/contract family cascades; billing is out.
      const cascaded: string[] = [];
      if (body.cascade) {
        const FAMILY: DocType[] = ["estimate", "quotation", "proposal", "contract"];
        if (FAMILY.includes(docType)) {
          const siblings = FAMILY.filter((t) => t !== docType && client.docs[t]);
          for (const t of siblings) {
            const sMeta = client.docs[t];
            if (!sMeta) continue;
            const ctx = `${instructions}

Apply the SAME change to this ${t} and keep it fully consistent with the ${docType} that was just revised. Only change what this instruction implies; leave everything else as-is. The revised ${docType} now reads:
${JSON.stringify(data)}`;
            const sData = await reviseDoc(client, t, sMeta.data, ctx, today);
            archiveVersion(sMeta);
            await saveDoc(client, t, sData, sMeta.status);
            cascaded.push(t);
          }
        }
      }

      await saveClient(client);
      await logOperatorActivity(
        `regenerated ${docType}${cascaded.length ? ` + applied to ${cascaded.join(", ")}` : ""}`,
        slug,
        updated.no,
      );
      return NextResponse.json({ ok: true, status: updated.status, cascaded });
    }

    // (Invoice/receipt generation moved to /api/clients/[slug]/billing —
    // the payment arc supports multiple invoices and receipts per client.)

    if (action === "retry-stage2") {
      if (!client.answersUrl) return NextResponse.json({ error: "No answers submitted yet" }, { status: 400 });
      // runStage2 replaces quotation/proposal/contract with fresh DRAFTS. The
      // questionnaire route already refuses to re-run for exactly this reason
      // (`willDraft`), but the API did not — so a replayed or stale POST could
      // silently demote a published, possibly already-accepted quotation.
      const live = (["quotation", "proposal", "contract"] as DocType[]).filter(
        (t) => client.docs[t]?.status === "published",
      );
      if (live.length) {
        return NextResponse.json(
          { error: `Already published: ${live.join(", ")}. Unpublish or delete those first — re-drafting replaces them.` },
          { status: 409 },
        );
      }
      const res = await fetchAsset(client.answersUrl);
      // fetchAsset answers a missing object with a 404 and a null body, which
      // would otherwise blow up in res.json() and surface as a raw 500.
      if (!res.ok) return NextResponse.json({ error: "The stored answers are missing." }, { status: 404 });
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
