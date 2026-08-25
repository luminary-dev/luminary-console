// Delivery processing, backfill and reconciliation.
//
// The webhook route only persists and acknowledges. This is where work
// happens: on a schedule (cron), immediately after a receive (best effort,
// via Next's after()), and on demand from the dead letter UI.
//
// Three guarantees the mandate asks for and this provides:
//   1. Failed processing goes to a dead letter with the error, retryable
//      individually or by time range.
//   2. A backfill can reconstruct state from the API alone, so a missed
//      webhook window is recoverable.
//   3. Reconciliation runs on a schedule and REPORTS DRIFT rather than
//      silently fixing it, because drift means we are losing deliveries and
//      that is a fact worth seeing.
import { GitHubUnavailableError } from "./client";
import { fetchOpenPullRequests, fetchOrgRepos, fetchPullRequest } from "./api";
import { handleEvent, syncWorkflowRuns } from "./handlers";
import { notifyForDelivery } from "./notify-events";
import { parseEvent } from "./schema";
import {
  MAX_ATTEMPTS,
  getDelivery,
  listDeliveries,
  pendingDeliveries,
  setSyncState,
  updateDelivery,
  type StoredDelivery,
} from "./inbox";
import {
  deletePullRequest,
  getPullRequest,
  listAllPullRequests,
  putPullRequest,
  putRepo,
} from "./projection";

export type ProcessOutcome = {
  deliveryId: string;
  state: StoredDelivery["state"];
  summary: string;
};

/**
 * Process one delivery.
 *
 * Idempotent by construction: handlers reconcile against the API rather than
 * applying deltas, so running this twice on the same delivery produces the
 * same state. That is what makes at-least-once delivery safe.
 */
export async function processDelivery(deliveryId: string): Promise<ProcessOutcome> {
  const delivery = await getDelivery(deliveryId);
  if (!delivery) {
    return { deliveryId, state: "failed", summary: "Delivery not found." };
  }

  // Validate the payload against its schema before handing it to a handler,
  // so a shape change surfaces here, next to the delivery that caused it,
  // rather than as an undefined deep inside a render.
  const parsed = parseEvent(delivery.event, delivery.payload);
  if (!parsed.ok) {
    const unhandled = parsed.issues[0]?.startsWith("Unhandled event type");
    // An event we do not model is not a failure: acknowledging it keeps the
    // inbox honest without filling the dead letter with noise. A payload that
    // fails ITS OWN schema is a real problem and goes to the dead letter.
    await updateDelivery(deliveryId, {
      state: unhandled ? "skipped" : "failed",
      attempts: delivery.attempts + 1,
      processedAt: new Date().toISOString(),
      issues: parsed.issues,
      ...(unhandled ? {} : { error: "Payload did not match its schema." }),
    });
    return {
      deliveryId,
      state: unhandled ? "skipped" : "failed",
      summary: parsed.issues.join("; "),
    };
  }

  await updateDelivery(deliveryId, { state: "processing", attempts: delivery.attempts + 1 });

  try {
    const result = await handleEvent({
      event: delivery.event,
      deliveryId,
      payload: parsed.data,
    });
    await updateDelivery(deliveryId, {
      state: "processed",
      processedAt: new Date().toISOString(),
      error: undefined,
    });

    // Notifications come after the projection is correct, and never affect
    // whether the delivery counts as processed: being unable to tell someone
    // about a change is not a reason to reprocess the change.
    await notifyForDelivery(delivery.event, parsed.data);

    return { deliveryId, state: "processed", summary: result.summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A GitHub outage is not this delivery's fault: leave it pending so the
    // next pass retries it without burning an attempt against the cap.
    const transient = e instanceof GitHubUnavailableError;
    await updateDelivery(deliveryId, {
      state: transient ? "pending" : "failed",
      attempts: transient ? delivery.attempts : delivery.attempts + 1,
      error: message.slice(0, 500),
    });
    return {
      deliveryId,
      state: transient ? "pending" : "failed",
      summary: transient ? `Deferred: ${message}` : message,
    };
  }
}

/**
 * Process the pending queue.
 *
 * Sequential on purpose. Handlers reconcile against the API, and running a
 * burst of them in parallel is the fastest way to trip GitHub's SECONDARY
 * rate limit, which is a concurrency guard rather than a volume one. A small
 * bounded batch, processed in order, keeps us inside it.
 */
export async function processPending(limit = 20): Promise<ProcessOutcome[]> {
  const queue = await pendingDeliveries(limit);
  const outcomes: ProcessOutcome[] = [];
  for (const delivery of queue) {
    const outcome = await processDelivery(delivery.deliveryId);
    outcomes.push(outcome);
    // Stop early when GitHub is down rather than marching the whole queue
    // into a deferred state one timeout at a time.
    if (outcome.summary.startsWith("Deferred:")) break;
  }
  return outcomes;
}

/** Deliveries that exhausted their retries and need a human. */
export async function deadLetters(max = 100): Promise<StoredDelivery[]> {
  const failed = await listDeliveries({ state: "failed", max: 500 });
  return failed.filter((d) => d.attempts >= MAX_ATTEMPTS).slice(0, max);
}

/** Requeue a delivery for another attempt, resetting its attempt count so a
 *  human retry is not immediately re-buried by the cap. */
export async function replayDelivery(deliveryId: string): Promise<ProcessOutcome> {
  await updateDelivery(deliveryId, { state: "pending", attempts: 0, error: undefined });
  return processDelivery(deliveryId);
}

/** Replay every failed delivery received in a window. The mandate asks for
 *  individual and time-range replay; this is the range form. */
export async function replayRange(fromIso: string, toIso: string): Promise<ProcessOutcome[]> {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error("Replay needs a valid time range with the start before the end.");
  }
  const all = await listDeliveries({ max: 1000 });
  const inRange = all.filter((d) => {
    const at = Date.parse(d.receivedAt);
    return Number.isFinite(at) && at >= from && at <= to && d.state === "failed";
  });
  const outcomes: ProcessOutcome[] = [];
  for (const delivery of inRange) {
    outcomes.push(await replayDelivery(delivery.deliveryId));
  }
  return outcomes;
}

export type BackfillReport = {
  repos: number;
  pullRequests: number;
  workflowRuns: number;
  startedAt: string;
  finishedAt: string;
  errors: string[];
};

/**
 * Rebuild state from the API alone.
 *
 * This is the recovery path for a missed webhook window: with webhooks
 * disabled entirely, running this reconstructs the projection from scratch.
 * It is also what makes the console usable on day one, before any webhook has
 * ever arrived.
 */
export async function backfill(): Promise<BackfillReport> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let pullRequests = 0;

  let repos: Awaited<ReturnType<typeof fetchOrgRepos>> = [];
  try {
    repos = await fetchOrgRepos();
    await Promise.all(repos.map((r) => putRepo(r)));
  } catch (e) {
    errors.push(`Repositories: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const prs = await fetchOpenPullRequests();
    for (const pr of prs) {
      await putPullRequest(pr);
      pullRequests += 1;
    }
  } catch (e) {
    errors.push(`Pull requests: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Workflow runs power the CI screens and the flake leaderboard. Without
  // them those screens correctly but uselessly report "not enough data", so
  // the backfill seeds them too. One call per repository, sequential to stay
  // clear of the secondary rate limit, and an archived repository is skipped
  // because its runs are history nobody acts on.
  let workflowRuns = 0;
  for (const repo of repos.filter((r) => !r.archived)) {
    try {
      workflowRuns += await syncWorkflowRuns(repo.fullName, 50);
    } catch (e) {
      // One repository that will not answer must not fail the whole backfill.
      errors.push(`Runs for ${repo.fullName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const finishedAt = new Date().toISOString();
  await setSyncState({
    resource: "backfill",
    lastReconciledAt: finishedAt,
    ...(errors.length ? { lastError: errors.join(" | ") } : {}),
  });
  return { repos: repos.length, pullRequests, workflowRuns, startedAt, finishedAt, errors };
}

export type DriftReport = {
  checked: number;
  drifted: { repo: string; number: number; reason: string }[];
  removed: number;
  startedAt: string;
  finishedAt: string;
};

/**
 * Reconcile the stored projection against GitHub and REPORT drift.
 *
 * Drift is not just something to fix quietly: a stored PR that disagrees with
 * the API means a delivery was lost, and that is a signal about the health of
 * the pipeline. The report is surfaced in the admin UI and alerted on.
 */
export async function reconcile(limit = 50): Promise<DriftReport> {
  const startedAt = new Date().toISOString();
  const stored = await listAllPullRequests(limit);
  const drifted: DriftReport["drifted"] = [];
  let removed = 0;

  // The API's own list of what is open. Anything we think is open but is not
  // in this list has been closed or merged without us hearing about it.
  let liveOpen: Set<string> | null = null;
  try {
    const live = await fetchOpenPullRequests();
    liveOpen = new Set(live.map((p) => `${p.repo}#${p.number}`));
    for (const pr of live) {
      // A stale-but-still-open pull request is the ordinary signature of a
      // lost webhook delivery, and it is the most common drift there is.
      // Writing the live copy over it without comparing first fixed the data
      // and reported nothing, which is precisely the silent correction this
      // function exists to avoid: the projection looked healthy while the
      // delivery pipeline was quietly dropping events.
      const before = await getPullRequest(pr.repo, pr.number);
      const { written } = await putPullRequest(pr);
      if (written && before && before.updatedAt !== pr.updatedAt) {
        drifted.push({
          repo: pr.repo,
          number: pr.number,
          reason: `stored copy was stale, last updated ${before.updatedAt}, GitHub says ${pr.updatedAt}`,
        });
      }
    }
  } catch {
    // Without the live list we can still check individually below.
    liveOpen = null;
  }

  // Counted rather than taken from stored.length, which overstated the work:
  // closed pull requests are skipped below and never checked against GitHub.
  let checked = 0;
  for (const pr of stored) {
    if (pr.state !== "open") continue;
    checked += 1;
    const key = `${pr.repo}#${pr.number}`;
    if (liveOpen && !liveOpen.has(key)) {
      const fresh = await fetchPullRequest(pr.repo, pr.number).catch(() => null);
      if (!fresh) {
        // Actually remove it, matching what the handler does on a 404. It
        // used to be counted as removed and left in place, so a pull request
        // whose repository was deleted or transferred stayed in the inbox
        // permanently: no webhook would ever arrive for it, and every later
        // reconcile re-reported the same phantom while the inbox went on
        // showing it as open work.
        await deletePullRequest(pr.repo, pr.number);
        removed += 1;
        drifted.push({ repo: pr.repo, number: pr.number, reason: "no longer exists" });
        continue;
      }
      if (fresh.state !== pr.state) {
        drifted.push({
          repo: pr.repo,
          number: pr.number,
          reason: `stored as ${pr.state}, actually ${fresh.state}`,
        });
      }
      await putPullRequest(fresh);
    }
  }

  const finishedAt = new Date().toISOString();
  await setSyncState({
    resource: "pull_requests",
    lastReconciledAt: finishedAt,
    lastDrift: drifted.length,
  });

  return { checked, drifted, removed, startedAt, finishedAt };
}
