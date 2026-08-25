// Generate (or refresh) the project handover pack — the document that closes a
// project out. It is stored as a `billing[]` entry of kind "handover" so it
// inherits, unchanged, everything already built for billing documents: the
// /preview/<slug>/<doc> console preview, the public <slug>.luminary-dev.xyz/
// <doc> page and its /pdf, per-document email, the portal listing, and
// publish / unpublish / delete. Nothing about it is drafted by the AI layer —
// see lib/handover.ts.
//
// Authed by the proxy like every /api route.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { archiveVersion, saveBillingDoc } from "@/lib/pipeline";
import { buildHandoverData, handoverEligible } from "@/lib/handover";
import { logActivity } from "@/lib/activity";
import { problemResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (!handoverEligible(client)) {
    return NextResponse.json(
      {
        error:
          "Nothing to hand over yet: publish the final receipt, or move the client to Delivered, first.",
      },
      { status: 400 },
    );
  }

  try {
    const data = buildHandoverData(client);
    const existing = (client.billing ?? []).find((b) => b.kind === "handover");
    // Refresh in place rather than issuing a second pack: the content is
    // derived, so re-running it after (say) a late payment is a correction,
    // not a new document. The superseded render stays reachable via history.
    if (existing) archiveVersion(existing);
    const doc = await saveBillingDoc(
      client,
      "handover",
      "other",
      data,
      existing?.status ?? "draft",
      existing?.slug,
    );
    await saveClient(client);
    await logActivity(
      "operator",
      existing ? "regenerated handover pack" : "generated handover pack",
      slug,
      doc.no,
    );
    return NextResponse.json({ ok: true, slug: doc.slug, no: doc.no, regenerated: !!existing });
  } catch (e) {
    const { body, status } = problemResponse(e, `handover generation for ${slug}`);
    return NextResponse.json(body, { status });
  }
}
