// Manual lifecycle-stage override — the small dropdown on the client page.
// Auto-advance (lib/stage) handles the normal flow; this is for corrections.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { STAGES, STAGE_LABELS, stageRank } from "@/lib/stage";
import { currentOperator, logOperatorActivity } from "@/lib/operator";
import { sendPushNotice } from "@/lib/push";
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
  } else if (stage === "delivered" || stage === "warranty") {
    // Re-stamp, don't merely fill a gap. currentStage() drifts delivered →
    // warranty → closed off deliveredAt, so keeping a month-old timestamp
    // made "put this back to Delivered" snap to Closed on the very next
    // read — the one thing a manual override exists to prevent.
    client.deliveredAt = new Date().toISOString();
  }
  // "Closed" deliberately stamps nothing: it is also how a lead is closed
  // out unwon, and inventing a delivery date there would put a fabricated
  // delivery and a 30-day warranty commitment on the handover pack.
  await saveClient(client);
  await logOperatorActivity("set stage", slug, STAGE_LABELS[stage]);
  // Push only — see docs/[type]: operator actions notify phones, not Telegram.
  await sendPushNotice({
    title: "Stage changed",
    company: client.company,
    lines: [`→ ${STAGE_LABELS[stage]} · by ${await currentOperator()}`],
    url: `https://${process.env.CONSOLE_HOST || `console.${process.env.ROOT_DOMAIN || "luminary-dev.xyz"}`}/clients/${slug}`,
  });
  return NextResponse.json({ ok: true, stage });
}
