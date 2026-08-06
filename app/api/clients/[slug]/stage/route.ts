// Manual lifecycle-stage override — the small dropdown on the client page.
// Auto-advance (lib/stage) handles the normal flow; this is for corrections.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { STAGES, STAGE_LABELS, stageRank } from "@/lib/stage";
import { logActivity } from "@/lib/activity";
import type { ClientStage } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const stage = String(body.stage || "") as ClientStage;
  if (!STAGES.includes(stage)) {
    return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
  }

  client.stage = stage;
  if (stageRank(stage) < stageRank("delivered")) {
    // Moving back before delivery resets the warranty clock.
    delete client.deliveredAt;
  } else if (!client.deliveredAt) {
    client.deliveredAt = new Date().toISOString();
  }
  await saveClient(client);
  await logActivity("operator", "set stage", slug, STAGE_LABELS[stage]);
  return NextResponse.json({ ok: true, stage });
}
