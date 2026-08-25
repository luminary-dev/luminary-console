// The webhook delivery inbox and dead letter API, behind the console session
// gate like every other /api route.
//
//   GET  ?state=&event=&repo=&max=   list deliveries, newest first
//   GET  ?dead=1                     only deliveries that exhausted retries
//   POST { action: "replay", deliveryId }
//   POST { action: "replayRange", from, to }
//   POST { action: "backfill" }
//   POST { action: "reconcile" }
//
// Replay is deliberately an operator action rather than an automatic one past
// the retry cap: a delivery that failed five times usually needs a code fix
// first, and silently retrying it forever hides that.
import { NextResponse } from "next/server";
import { listDeliveries, type DeliveryState } from "@/lib/github/inbox";
import { backfill, deadLetters, reconcile, replayDelivery, replayRange } from "@/lib/github/processor";
import { logOperatorActivity } from "@/lib/operator";
import { githubConfigured } from "@/lib/github/config";

export const runtime = "nodejs";
export const maxDuration = 300;

const STATES: DeliveryState[] = ["pending", "processing", "processed", "failed", "skipped"];

export async function GET(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("dead") === "1") {
    return NextResponse.json({ deliveries: await deadLetters(100) });
  }

  const stateParam = url.searchParams.get("state");
  const state = stateParam && STATES.includes(stateParam as DeliveryState)
    ? (stateParam as DeliveryState)
    : undefined;
  const event = url.searchParams.get("event") || undefined;
  const repo = url.searchParams.get("repo") || undefined;
  const maxParam = Number(url.searchParams.get("max"));
  const max = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(maxParam, 200) : 50;

  const deliveries = await listDeliveries({
    ...(state ? { state } : {}),
    ...(event ? { event } : {}),
    ...(repo ? { repo } : {}),
    max,
  });

  // Payloads are large and the list view does not render them; stripping them
  // here keeps a 50-delivery page from being megabytes of JSON.
  return NextResponse.json({
    deliveries: deliveries.map(({ payload, ...rest }) => {
      void payload;
      return rest;
    }),
  });
}

export async function POST(req: Request) {
  if (!githubConfigured()) {
    return NextResponse.json(
      { error: "GitHub is not configured on this deployment." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = String((body as { action?: unknown })?.action ?? "");

  try {
    if (action === "replay") {
      const deliveryId = String((body as { deliveryId?: unknown }).deliveryId ?? "");
      if (!deliveryId) {
        return NextResponse.json({ error: "A delivery id is required." }, { status: 400 });
      }
      const outcome = await replayDelivery(deliveryId);
      await logOperatorActivity("replayed a webhook delivery", "github", deliveryId);
      return NextResponse.json({ ok: true, outcome });
    }

    if (action === "replayRange") {
      const from = String((body as { from?: unknown }).from ?? "");
      const to = String((body as { to?: unknown }).to ?? "");
      const outcomes = await replayRange(from, to);
      await logOperatorActivity(
        "replayed a webhook range",
        "github",
        `${from} to ${to}, ${outcomes.length} deliveries`,
      );
      return NextResponse.json({ ok: true, replayed: outcomes.length, outcomes });
    }

    if (action === "backfill") {
      const report = await backfill();
      await logOperatorActivity(
        "ran a GitHub backfill",
        "github",
        `${report.repos} repos, ${report.pullRequests} pull requests, ${report.workflowRuns} workflow runs`,
      );
      return NextResponse.json({ ok: true, report });
    }

    if (action === "reconcile") {
      const report = await reconcile(100);
      await logOperatorActivity(
        "ran a GitHub reconciliation",
        "github",
        `${report.checked} checked, ${report.drifted.length} drifted`,
      );
      return NextResponse.json({ ok: true, report });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "That did not work.";
    console.error(`[github] deliveries action ${action} failed:`, e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
