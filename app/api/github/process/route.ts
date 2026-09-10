// The processing sweep.
//
// The proxy waves this exact path past the session gate (AUDIT.md API-01),
// because Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` and no
// session cookie — under the old gate a cron call was 401'd here before its
// own bearer check could run, so the sweep never fired on schedule and the
// webhook backstop was dead. Both callers are therefore authorised HERE:
//   - Vercel Cron: the constant-time bearer check (`cronAuthorized`).
//   - A signed-in operator hitting "Process now": the session cookie, which
//     this route now verifies itself (`operatorRequest`) — HMAC + the same
//     live-session allowlist the proxy applies — since the proxy no longer
//     vouches for the cookie on this exempt path.
//
// Why a sweep at all when the webhook route schedules processing after each
// response: because `after()` is best effort. A cold start that dies, a
// deploy mid-flight, or a GitHub outage leaves deliveries pending, and the
// sweep is what guarantees they are eventually handled.
import { timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { processPending, reconcile } from "@/lib/github/processor";
import { getSyncState } from "@/lib/github/inbox";
import { githubConfigured } from "@/lib/github/config";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { studioNotice } from "@/lib/notify";
import { tgEsc } from "@/lib/telegram";

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

/** An operator "Process now" arrives with a session cookie. This path is now
 *  exempt from the proxy's session gate (API-01), so the route must verify the
 *  token itself rather than trusting the cookie's mere presence: HMAC first,
 *  then the live-session allowlist the proxy uses, so a revoked or forged
 *  cookie is refused here just as it would be at the edge. Cron calls carry no
 *  cookie and use the bearer instead. */
async function operatorRequest(req: Request): Promise<boolean> {
  const secret = process.env.SESSION_SECRET || "";
  const cookie = req.headers.get("cookie") || "";
  const prefix = `${SESSION_COOKIE}=`;
  const raw = cookie.split(/;\s*/).find((c) => c.startsWith(prefix))?.slice(prefix.length);
  const session = await verifySessionToken(secret, raw ? decodeURIComponent(raw) : undefined);
  if (!session) return false;
  try {
    const { liveSids } = await import("@/lib/sessions");
    return new Set(await liveSids()).has(session.sid);
  } catch {
    // Session store unreachable: accept a signature-valid, unexpired token,
    // matching the proxy's documented fail-open (proxy.ts) rather than locking
    // the operator out during an R2 outage. The bearer path is unaffected.
    return true;
  }
}

export async function POST(req: Request) {
  if (!cronAuthorized(req) && !(await operatorRequest(req))) {
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
    const deferred = outcomes.filter((o) => o.transient).length;

    // Reconciliation is the scheduled drift check, and it costs a full org
    // read, so it does not run on every five-minute sweep. Rather than
    // depending on a query string in the cron schedule (support for which
    // varies), the sweep decides for itself: reconcile when the last one is
    // older than the interval, or when an operator explicitly asks.
    const forced = url.searchParams.get("reconcile") === "1";
    const drift = forced || (await reconcileIsDue()) ? await reconcile() : null;

    // Alert on the reliability signals reconcile exists to produce (AUDIT.md
    // OPS-07): a drift means webhooks were missed, an error means the check
    // itself couldn't run. Reconcile is infrequent (hourly/daily), so this
    // can't spam. Best-effort — never fails the sweep.
    if (drift && (drift.error || drift.drifted.length > 0)) {
      const host = process.env.CONSOLE_HOST || `console.${process.env.ROOT_DOMAIN || "luminary-dev.xyz"}`;
      await studioNotice({
        title: drift.error ? "GitHub reconcile could not run" : "Projection drift detected",
        company: "Engineering",
        lines: drift.error
          ? [`The drift check failed: ${tgEsc(String(drift.error).slice(0, 200))}`]
          : [`${drift.drifted.length} pull request(s) had drifted from GitHub and were corrected.`],
        url: `https://${host}/github`,
      }).catch(() => {});
    }

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
    logger.error("[github] processing sweep failed", { err: e });
    return NextResponse.json({ error: "The processing sweep failed." }, { status: 500 });
  }
}

/** Vercel Cron issues GETs, so the schedule reaches the same work. */
export async function GET(req: Request) {
  return POST(req);
}
