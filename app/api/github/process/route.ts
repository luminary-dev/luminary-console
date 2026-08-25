// The processing sweep.
//
// Two callers, one guard each:
//   - Vercel Cron, which sends `Authorization: Bearer <CRON_SECRET>`. The
//     proxy waves /api/cron/* past the session gate, but this route is not
//     under that prefix, so a cron call must carry the bearer AND this route
//     verifies it constant-time, exactly like the backup cron does.
//   - A signed-in operator hitting "Process now" in the admin UI, which
//     arrives with a session cookie and is authorised by the proxy.
//
// Why a sweep at all when the webhook route schedules processing after each
// response: because `after()` is best effort. A cold start that dies, a
// deploy mid-flight, or a GitHub outage leaves deliveries pending, and the
// sweep is what guarantees they are eventually handled.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processPending, reconcile } from "@/lib/github/processor";
import { getSyncState } from "@/lib/github/inbox";
import { githubConfigured } from "@/lib/github/config";

export const runtime = "nodejs";
export const maxDuration = 300;

/** How often the drift check runs, independent of the sweep's cadence. */
const RECONCILE_EVERY_MS = 60 * 60 * 1000;

/** Whether the scheduled reconciliation is due. A store failure answers "no"
 *  rather than "yes": a reconcile is a full org read, and running it on every
 *  sweep because we could not read a timestamp would be worse than skipping
 *  one, which the next sweep picks up anyway. */
async function reconcileIsDue(): Promise<boolean> {
  try {
    const state = await getSyncState("pull_requests");
    const last = Date.parse(state?.lastReconciledAt ?? "");
    if (!Number.isFinite(last)) return true; // never reconciled
    return Date.now() - last >= RECONCILE_EVERY_MS;
  } catch {
    return false;
  }
}

/** Constant-time bearer check, same scheme as the backup cron. */
function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") || "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A session cookie means the proxy already authorised this request; the
 *  presence of the header is the signal, not its contents (the proxy has
 *  verified it). Cron calls carry no cookie, hence the bearer. */
function operatorRequest(req: Request): boolean {
  return (req.headers.get("cookie") || "").includes("lum_session=");
}

export async function POST(req: Request) {
  if (!cronAuthorized(req) && !operatorRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!githubConfigured()) {
    return NextResponse.json(
      { error: "GitHub is not configured on this deployment." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);

  try {
    const outcomes = await processPending(25);
    const processed = outcomes.filter((o) => o.state === "processed").length;
    const failed = outcomes.filter((o) => o.state === "failed").length;
    const skipped = outcomes.filter((o) => o.state === "skipped").length;
    const deferred = outcomes.filter((o) => o.summary.startsWith("Deferred:")).length;

    // Reconciliation is the scheduled drift check, and it costs a full org
    // read, so it does not run on every five-minute sweep. Rather than
    // depending on a query string in the cron schedule (support for which
    // varies), the sweep decides for itself: reconcile when the last one is
    // older than the interval, or when an operator explicitly asks.
    const forced = url.searchParams.get("reconcile") === "1";
    const drift = forced || (await reconcileIsDue()) ? await reconcile(50) : null;

    return NextResponse.json({
      ok: true,
      processed,
      failed,
      skipped,
      deferred,
      outcomes,
      ...(drift ? { drift } : {}),
    });
  } catch (e) {
    console.error("[github] processing sweep failed:", e);
    return NextResponse.json({ error: "The processing sweep failed." }, { status: 500 });
  }
}

/** Vercel Cron issues GETs, so the schedule reaches the same work. */
export async function GET(req: Request) {
  return POST(req);
}
