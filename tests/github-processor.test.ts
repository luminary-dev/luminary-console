// Processor tests: the queue discipline, the dead letter and replay paths,
// the backfill that reconstructs state from the API alone, and the drift
// report reconciliation produces.
//
// tests/github-pipeline.test.ts drives the same processor through the real
// webhook route to check the ingestion acceptance criteria. This file goes at
// the processor directly, so it can control the API's answers per call and
// assert the parts the route never reaches: sequencing, stop-early, backfill
// and reconcile.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { atIndex } from "./helpers";

// In-memory store.
// One object per key, exactly like the real bucket, so the per-entity storage
// discipline the projection depends on is preserved.
const objects = new Map<string, unknown>();

vi.mock("@/lib/store", () => ({
  readState: vi.fn(async (path: string) =>
    objects.has(path) ? structuredClone(objects.get(path)) : null,
  ),
  writeState: vi.fn(async (path: string, data: unknown) => {
    objects.set(path, structuredClone(data));
  }),
  clearState: vi.fn(async (path: string) => {
    objects.delete(path);
  }),
  listState: vi.fn(async (prefix: string) =>
    [...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => `console/state/${k}`),
  ),
}));

// Stubbed GitHub API.
// The handlers reconcile by re-reading the entity, so the stub is the only
// thing standing between the processor and the network. Every knob it exposes
// is something a test needs to vary: what the API answers, when it fails, and
// in what order it was asked.
type PullRequestEntity = import("@/lib/github/entities").PullRequestEntity;
type RepoEntity = import("@/lib/github/entities").RepoEntity;
type WorkflowRunEntity = import("@/lib/github/entities").WorkflowRunEntity;

const api = {
  /** Called before every fetchPullRequest answer, so a test can observe the
   *  order of work or mutate the world mid-run. */
  onFetchPullRequest: null as ((repo: string, number: number) => void | Promise<void>) | null,
  /** Numbers the API claims no longer exist. */
  missingPullRequests: new Set<number>(),
  /** Number to error, so a single delivery in a queue can fail. */
  pullRequestErrors: new Map<number, Error>(),
  /** State the API reports for a pull request, overriding the default "open". */
  pullRequestStates: new Map<number, PullRequestEntity["state"]>(),
  orgRepos: [] as RepoEntity[],
  orgReposError: null as Error | null,
  openPullRequests: [] as PullRequestEntity[],
  openPullRequestsError: null as Error | null,
  workflowRuns: new Map<string, WorkflowRunEntity[]>(),
  workflowRunErrors: new Map<string, Error>(),
  workflowRunsAskedFor: [] as string[],
};

function pullRequest(overrides: Partial<PullRequestEntity> = {}): PullRequestEntity {
  const number = overrides.number ?? 1;
  const repo = overrides.repo ?? "luminary-dev/console";
  return {
    id: 500 + number,
    repo,
    number,
    title: `Pull request ${number}`,
    state: "open",
    draft: false,
    author: { id: 1, login: "dhanika" },
    assignees: [],
    requestedReviewers: [],
    labels: [],
    headRef: `feat/${number}`,
    headSha: `sha${number}`,
    baseRef: "main",
    fromFork: false,
    createdAt: "2026-08-26T09:00:00Z",
    updatedAt: "2026-08-26T10:00:00Z",
    mergeable: true,
    url: `https://github.com/${repo}/pull/${number}`,
    reviews: [],
    checks: [],
    syncedAt: "2026-08-26T10:00:00Z",
    ...overrides,
  };
}

function repoEntity(fullName: string, overrides: Partial<RepoEntity> = {}): RepoEntity {
  return {
    id: fullName.length,
    name: fullName.split("/")[1] ?? fullName,
    fullName,
    private: true,
    archived: false,
    defaultBranch: "main",
    url: `https://github.com/${fullName}`,
    syncedAt: "2026-08-26T10:00:00Z",
    ...overrides,
  };
}

function workflowRun(repo: string, id: number): WorkflowRunEntity {
  return {
    id,
    repo,
    name: "CI",
    headSha: `sha${id}`,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-26T09:00:00Z",
    updatedAt: "2026-08-26T09:05:00Z",
  };
}

vi.mock("@/lib/github/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/api")>("@/lib/github/api");
  return {
    ...actual,
    fetchPullRequest: vi.fn(async (repo: string, number: number) => {
      await api.onFetchPullRequest?.(repo, number);
      const failure = api.pullRequestErrors.get(number);
      if (failure) throw failure;
      if (api.missingPullRequests.has(number)) return null;
      const state = api.pullRequestStates.get(number);
      return pullRequest({ repo, number, ...(state ? { state } : {}) });
    }),
    fetchRepo: vi.fn(async () => null),
    fetchOrgRepos: vi.fn(async () => {
      if (api.orgReposError) throw api.orgReposError;
      return api.orgRepos;
    }),
    fetchOpenPullRequests: vi.fn(async () => {
      if (api.openPullRequestsError) throw api.openPullRequestsError;
      return api.openPullRequests;
    }),
    fetchWorkflowRuns: vi.fn(async (repo: string) => {
      api.workflowRunsAskedFor.push(repo);
      const failure = api.workflowRunErrors.get(repo);
      if (failure) throw failure;
      return api.workflowRuns.get(repo) ?? [];
    }),
  };
});

import { GitHubUnavailableError } from "@/lib/github/client";
import { MAX_ATTEMPTS, type StoredDelivery } from "@/lib/github/inbox";
import {
  backfill,
  deadLetters,
  processDelivery,
  processPending,
  reconcile,
  replayDelivery,
  replayRange,
} from "@/lib/github/processor";

const REPO = "luminary-dev/console";

function prPayload(number: number): unknown {
  return {
    action: "opened",
    created_at: "2026-08-26T10:00:00Z",
    repository: { id: 1, name: "console", full_name: REPO },
    pull_request: {
      id: 500 + number,
      number,
      state: "open",
      title: `Pull request ${number}`,
      created_at: "2026-08-26T09:00:00Z",
      updated_at: "2026-08-26T10:00:00Z",
      head: { ref: `feat/${number}`, sha: `sha${number}` },
      base: { ref: "main", sha: "base123" },
    },
  };
}

/** Put a delivery straight into the inbox, bypassing the receive path so a
 *  test can start from any state the processor has to cope with. */
function seedDelivery(
  deliveryId: string,
  overrides: Partial<StoredDelivery> & { number?: number } = {},
): void {
  const { number = 1, ...rest } = overrides;
  const record: StoredDelivery = {
    deliveryId,
    event: "pull_request",
    repo: REPO,
    receivedAt: "2026-08-26T10:00:00Z",
    state: "pending",
    attempts: 0,
    payload: prPayload(number),
    ...rest,
  };
  objects.set(`github/deliveries/${deliveryId}.json`, structuredClone(record));
}

const storedDelivery = (id: string): StoredDelivery | undefined =>
  objects.get(`github/deliveries/${id}.json`) as StoredDelivery | undefined;

const keysUnder = (prefix: string): string[] =>
  [...objects.keys()].filter((k) => k.startsWith(prefix));

beforeEach(() => {
  objects.clear();
  api.onFetchPullRequest = null;
  api.missingPullRequests.clear();
  api.pullRequestErrors.clear();
  api.pullRequestStates.clear();
  api.orgRepos = [];
  api.orgReposError = null;
  api.openPullRequests = [];
  api.openPullRequestsError = null;
  api.workflowRuns.clear();
  api.workflowRunErrors.clear();
  api.workflowRunsAskedFor = [];
  process.env.GH_TOKEN = "test-token";
});

describe("the pending queue", () => {
  it("runs deliveries one at a time rather than firing the batch at once", async () => {
    // Concurrency, not volume, is what trips GitHub's secondary rate limit, so
    // the queue must not overlap two handlers. Interleaved enter/exit marks
    // would be the evidence that it does.
    seedDelivery("seq-1", { number: 1, receivedAt: "2026-08-26T10:00:01Z" });
    seedDelivery("seq-2", { number: 2, receivedAt: "2026-08-26T10:00:02Z" });
    seedDelivery("seq-3", { number: 3, receivedAt: "2026-08-26T10:00:03Z" });

    const marks: string[] = [];
    api.onFetchPullRequest = async (_repo, number) => {
      marks.push(`enter:${number}`);
      await new Promise((r) => setTimeout(r, 1));
      marks.push(`exit:${number}`);
    };

    const outcomes = await processPending();

    expect(outcomes.map((o) => o.state)).toEqual(["processed", "processed", "processed"]);
    expect(marks).toEqual([
      "enter:1",
      "exit:1",
      "enter:2",
      "exit:2",
      "enter:3",
      "exit:3",
    ]);
  });

  it("processes the oldest delivery first", async () => {
    seedDelivery("old", { number: 1, receivedAt: "2026-08-26T09:00:00Z" });
    seedDelivery("new", { number: 2, receivedAt: "2026-08-26T11:00:00Z" });

    const outcomes = await processPending();
    expect(outcomes.map((o) => o.deliveryId)).toEqual(["old", "new"]);
  });

  it("stops at the first deferred delivery and leaves the rest pending", async () => {
    // A GitHub outage is not the queue's fault. Marching the whole batch into
    // a deferred state one timeout at a time wastes the window and buries the
    // deliveries; stopping leaves them exactly where the next pass finds them.
    seedDelivery("halt-1", { number: 1, receivedAt: "2026-08-26T10:00:01Z" });
    seedDelivery("halt-2", { number: 2, receivedAt: "2026-08-26T10:00:02Z" });
    seedDelivery("halt-3", { number: 3, receivedAt: "2026-08-26T10:00:03Z" });
    api.pullRequestErrors.set(2, new GitHubUnavailableError(30_000));

    const outcomes = await processPending();

    expect(outcomes).toHaveLength(2);
    expect(atIndex(outcomes, 0).state).toBe("processed");
    const deferred = atIndex(outcomes, 1);
    expect(deferred.deliveryId).toBe("halt-2");
    expect(deferred.state).toBe("pending");
    expect(deferred.summary.startsWith("Deferred:")).toBe(true);

    // The third delivery must still be waiting, untouched, rather than
    // dropped or counted as attempted.
    const third = storedDelivery("halt-3");
    expect(third?.state).toBe("pending");
    expect(third?.attempts).toBe(0);
    // And the deferred one must not have burned an attempt against the cap.
    expect(storedDelivery("halt-2")?.attempts).toBe(0);
  });

  it("keeps retrying a failed delivery until it reaches the attempt cap", async () => {
    // A failed delivery below the cap is still queue work; one at the cap has
    // become a human's problem and must stop being retried automatically.
    seedDelivery("retryable", {
      number: 1,
      state: "failed",
      attempts: MAX_ATTEMPTS - 1,
      receivedAt: "2026-08-26T10:00:01Z",
    });
    seedDelivery("exhausted", {
      number: 2,
      state: "failed",
      attempts: MAX_ATTEMPTS,
      receivedAt: "2026-08-26T10:00:02Z",
    });

    const outcomes = await processPending();
    expect(outcomes.map((o) => o.deliveryId)).toEqual(["retryable"]);
  });

  it("honours the batch limit so one pass cannot run unbounded", async () => {
    for (let i = 1; i <= 4; i++) {
      seedDelivery(`bounded-${i}`, { number: i, receivedAt: `2026-08-26T10:00:0${i}Z` });
    }
    const outcomes = await processPending(2);
    expect(outcomes).toHaveLength(2);
    expect(storedDelivery("bounded-3")?.state).toBe("pending");
  });
});

describe("idempotency", () => {
  it("lands on the same state when the same delivery is processed twice", async () => {
    // At-least-once delivery is only safe because handlers reconcile against
    // the API instead of applying deltas. Running the same delivery twice must
    // therefore be indistinguishable from running it once.
    seedDelivery("idem", { number: 7 });

    const first = await processDelivery("idem");
    const afterFirst = structuredClone(objects.get(`github/prs/luminary-dev_console/7.json`));
    const second = await processDelivery("idem");
    const afterSecond = objects.get(`github/prs/luminary-dev_console/7.json`);

    expect(first.state).toBe("processed");
    expect(second.state).toBe("processed");
    expect(afterSecond).toEqual(afterFirst);
    // One projection, no matter how many times the delivery was replayed.
    expect(keysUnder("github/prs/")).toHaveLength(1);
    // The attempt counter is the one thing that legitimately moves.
    expect(storedDelivery("idem")?.attempts).toBe(2);
  });

  it("reports a delivery that is no longer in the inbox instead of throwing", async () => {
    // The retention sweep deletes processed deliveries, so an id from an old
    // dead letter link can outlive its record.
    const outcome = await processDelivery("never-existed");
    expect(outcome.state).toBe("failed");
    expect(outcome.summary).toBe("Delivery not found.");
  });

  it("leaves a delivery pending when GitHub is unavailable, without burning an attempt", async () => {
    seedDelivery("transient", { number: 1 });
    api.pullRequestErrors.set(1, new GitHubUnavailableError(12_000));

    const outcome = await processDelivery("transient");
    expect(outcome.state).toBe("pending");
    const stored = storedDelivery("transient");
    expect(stored?.state).toBe("pending");
    expect(stored?.attempts).toBe(0);
    expect(stored?.error).toContain("temporarily unavailable");
  });

  it("fails a delivery whose handler throws for a reason that is our problem", async () => {
    seedDelivery("hard-fail", { number: 1 });
    api.pullRequestErrors.set(1, new Error("something is wrong with the payload mapping"));

    const outcome = await processDelivery("hard-fail");
    expect(outcome.state).toBe("failed");
    expect(storedDelivery("hard-fail")?.attempts).toBe(1);
  });
});

describe("dead letters", () => {
  it("lists only the deliveries that exhausted their retries", async () => {
    seedDelivery("dead", { state: "failed", attempts: MAX_ATTEMPTS, error: "boom" });
    seedDelivery("still-retrying", { state: "failed", attempts: MAX_ATTEMPTS - 1 });
    seedDelivery("fine", { state: "processed", attempts: 1 });
    seedDelivery("waiting", { state: "pending", attempts: 0 });

    const letters = await deadLetters();
    expect(letters.map((d) => d.deliveryId)).toEqual(["dead"]);
    expect(atIndex(letters, 0).error).toBe("boom");
  });

  it("bounds the list so the dead letter screen cannot pull the whole inbox", async () => {
    for (let i = 1; i <= 4; i++) {
      seedDelivery(`dl-${i}`, {
        state: "failed",
        attempts: MAX_ATTEMPTS,
        receivedAt: `2026-08-26T10:00:0${i}Z`,
      });
    }
    expect(await deadLetters(2)).toHaveLength(2);
  });
});

describe("replay", () => {
  it("takes a dead-lettered delivery back out of the dead letter", async () => {
    // A human retry that is immediately re-buried by the attempt cap is not a
    // retry, so the count resets and the stale error is cleared.
    seedDelivery("revive", {
      number: 4,
      state: "failed",
      attempts: MAX_ATTEMPTS,
      error: "GitHub said no",
    });
    expect(await deadLetters()).toHaveLength(1);

    const outcome = await replayDelivery("revive");

    expect(outcome.state).toBe("processed");
    const stored = storedDelivery("revive");
    expect(stored?.attempts).toBe(1);
    expect(stored?.error).toBeUndefined();
    expect(await deadLetters()).toHaveLength(0);
  });

  it("replays only the failed deliveries inside the window", async () => {
    seedDelivery("inside-a", {
      number: 1,
      state: "failed",
      attempts: 5,
      receivedAt: "2026-08-26T10:00:00Z",
    });
    seedDelivery("inside-b", {
      number: 2,
      state: "failed",
      attempts: 5,
      receivedAt: "2026-08-26T10:30:00Z",
    });
    seedDelivery("outside", {
      number: 3,
      state: "failed",
      attempts: 5,
      receivedAt: "2026-08-26T14:00:00Z",
    });
    // A delivery that already worked is not replay material even in range.
    seedDelivery("already-done", {
      number: 4,
      state: "processed",
      attempts: 1,
      receivedAt: "2026-08-26T10:15:00Z",
    });

    const outcomes = await replayRange("2026-08-26T09:00:00Z", "2026-08-26T11:00:00Z");
    expect(outcomes.map((o) => o.deliveryId).sort()).toEqual(["inside-a", "inside-b"]);
  });

  it("reports a delivery swept away mid-range rather than aborting the range", async () => {
    // The retention sweep runs on its own schedule, so a range replay can list
    // a delivery and then find it gone by the time it gets there. Losing the
    // rest of the range to that race would be much worse than one "not found".
    seedDelivery("sweep-newer", {
      number: 1,
      state: "failed",
      attempts: 5,
      receivedAt: "2026-08-26T10:30:00Z",
    });
    seedDelivery("sweep-older", {
      number: 2,
      state: "failed",
      attempts: 5,
      receivedAt: "2026-08-26T10:00:00Z",
    });
    api.onFetchPullRequest = () => {
      objects.delete("github/deliveries/sweep-older.json");
    };

    const outcomes = await replayRange("2026-08-26T09:00:00Z", "2026-08-26T11:00:00Z");

    expect(outcomes).toHaveLength(2);
    expect(atIndex(outcomes, 0).deliveryId).toBe("sweep-newer");
    expect(atIndex(outcomes, 0).state).toBe("processed");
    const vanished = atIndex(outcomes, 1);
    expect(vanished.deliveryId).toBe("sweep-older");
    expect(vanished.state).toBe("failed");
    expect(vanished.summary).toBe("Delivery not found.");
  });

  it("refuses a range it cannot make sense of", async () => {
    await expect(replayRange("not-a-date", "2026-08-26T11:00:00Z")).rejects.toThrow(
      /valid time range/,
    );
  });
});

describe("backfill", () => {
  it("seeds repositories, pull requests and workflow runs from the API alone", async () => {
    // This is the recovery path for a missed webhook window and the day-one
    // path before any webhook has arrived, so all three entity kinds have to
    // land or the CI screens open on "not enough data".
    api.orgRepos = [repoEntity(REPO), repoEntity("luminary-dev/site")];
    api.openPullRequests = [pullRequest({ number: 1 }), pullRequest({ number: 2 })];
    api.workflowRuns.set(REPO, [workflowRun(REPO, 11), workflowRun(REPO, 12)]);
    api.workflowRuns.set("luminary-dev/site", [workflowRun("luminary-dev/site", 21)]);

    const report = await backfill();

    expect(report.repos).toBe(2);
    expect(report.pullRequests).toBe(2);
    expect(report.workflowRuns).toBe(3);
    expect(report.errors).toEqual([]);
    expect(keysUnder("github/repos/")).toHaveLength(2);
    expect(keysUnder("github/prs/")).toHaveLength(2);
    expect(keysUnder("github/runs/")).toHaveLength(3);
    expect(Date.parse(report.finishedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt));

    const sync = objects.get("github/sync/backfill.json") as { lastReconciledAt?: string };
    expect(sync?.lastReconciledAt).toBe(report.finishedAt);
  });

  it("skips an archived repository's runs, because they are history nobody acts on", async () => {
    api.orgRepos = [repoEntity(REPO), repoEntity("luminary-dev/old", { archived: true })];
    api.workflowRuns.set(REPO, [workflowRun(REPO, 11)]);

    const report = await backfill();

    expect(api.workflowRunsAskedFor).toEqual([REPO]);
    // The archived repo is still projected: it just contributes no runs.
    expect(report.repos).toBe(2);
    expect(report.workflowRuns).toBe(1);
  });

  it("records a repository whose runs will not load without failing the backfill", async () => {
    api.orgRepos = [repoEntity(REPO), repoEntity("luminary-dev/sulky")];
    api.workflowRuns.set(REPO, [workflowRun(REPO, 11)]);
    api.workflowRunErrors.set("luminary-dev/sulky", new Error("410 Gone"));

    const report = await backfill();

    expect(report.workflowRuns).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(atIndex(report.errors, 0)).toContain("Runs for luminary-dev/sulky");
    const sync = objects.get("github/sync/backfill.json") as { lastError?: string };
    expect(sync?.lastError).toContain("410 Gone");
  });

  it("still backfills pull requests when the repository listing fails", async () => {
    api.orgReposError = new Error("403 Resource not accessible by integration");
    api.openPullRequests = [pullRequest({ number: 3 })];

    const report = await backfill();

    expect(report.repos).toBe(0);
    expect(report.pullRequests).toBe(1);
    expect(atIndex(report.errors, 0)).toContain("Repositories:");
    // With no repo list there is nothing to ask for runs against.
    expect(api.workflowRunsAskedFor).toEqual([]);
  });

  it("records a pull request listing failure separately from the repo one", async () => {
    api.orgRepos = [repoEntity(REPO)];
    api.openPullRequestsError = new Error("502 Server Error");

    const report = await backfill();

    expect(report.repos).toBe(1);
    expect(report.pullRequests).toBe(0);
    expect(atIndex(report.errors, 0)).toContain("Pull requests: 502 Server Error");
  });
});

describe("reconcile", () => {
  /** Reconcile reads the projection through the repo index, so a repo has to
   *  exist before its pull requests are visible to it. */
  async function seedProjection(prs: PullRequestEntity[]): Promise<void> {
    const { putRepo, putPullRequest } = await import("@/lib/github/projection");
    await putRepo(repoEntity(REPO));
    for (const pr of prs) await putPullRequest(pr);
  }

  it("reports a stored pull request the API says is closed, rather than only fixing it", async () => {
    // Drift means a delivery was lost. Correcting it quietly hides the fact
    // that the pipeline is dropping webhooks, which is the thing worth seeing.
    await seedProjection([
      pullRequest({ number: 1 }),
      pullRequest({ number: 2 }),
      pullRequest({ number: 3, state: "closed" }),
    ]);
    // The API's live open list omits #2, and asked directly it says closed.
    api.openPullRequests = [pullRequest({ number: 1 })];
    api.pullRequestStates.set(2, "closed");

    const report = await reconcile();

    // Two, not three. The closed pull request at #3 is skipped without being
    // checked against GitHub, and reporting it as checked overstated the work
    // in a number the admin screen shows.
    expect(report.checked).toBe(2);
    expect(report.drifted).toHaveLength(1);
    const drift = atIndex(report.drifted, 0);
    expect(drift).toEqual({
      repo: REPO,
      number: 2,
      reason: "stored as open, actually closed",
    });
    expect(report.removed).toBe(0);

    const sync = objects.get("github/sync/pull_requests.json") as { lastDrift?: number };
    expect(sync?.lastDrift).toBe(1);
  });

  it("counts a pull request the API no longer knows about", async () => {
    await seedProjection([pullRequest({ number: 1 }), pullRequest({ number: 9 })]);
    api.openPullRequests = [pullRequest({ number: 1 })];
    api.missingPullRequests.add(9);

    const report = await reconcile();

    expect(report.removed).toBe(1);
    expect(atIndex(report.drifted, 0).reason).toBe("no longer exists");
    // The projection is actually deleted, matching the handler path on a 404.
    // Counting it as removed while leaving it in place meant a pull request
    // whose repository was deleted or transferred stayed in the inbox for
    // good: no webhook would ever arrive for it, and every later reconcile
    // re-reported the same phantom while the inbox showed it as open work.
    expect(objects.has("github/prs/luminary-dev_console/9.json")).toBe(false);
  });

  it("reports no drift when the projection and the live list agree", async () => {
    await seedProjection([pullRequest({ number: 1 }), pullRequest({ number: 2 })]);
    api.openPullRequests = [pullRequest({ number: 1 }), pullRequest({ number: 2 })];

    const report = await reconcile();

    expect(report.drifted).toEqual([]);
    expect(report.removed).toBe(0);
    expect(report.checked).toBe(2);
  });

  it("corrects a stale copy of a still-open pull request AND reports it", async () => {
    // A stale-but-still-open pull request is the ordinary shape of a lost
    // webhook, and it is the most common drift there is. Reconcile used to
    // rewrite it from the live list without comparing first, which fixed the
    // data and reported nothing: the projection looked healthy while the
    // delivery pipeline was quietly dropping events. Correcting it silently
    // defeats the whole point of the report.
    await seedProjection([pullRequest({ number: 1, title: "Stale title" })]);
    api.openPullRequests = [
      pullRequest({ number: 1, title: "Current title", updatedAt: "2026-08-26T12:00:00Z" }),
    ];

    const report = await reconcile();

    const stored = objects.get("github/prs/luminary-dev_console/1.json") as { title: string };
    expect(stored.title).toBe("Current title");
    expect(report.drifted).toHaveLength(1);
    expect(atIndex(report.drifted, 0).number).toBe(1);
    expect(atIndex(report.drifted, 0).reason).toContain("stale");
  });

  it("does not report drift when the stored copy already matches GitHub", async () => {
    // The complement of the test above: reconcile must stay quiet on a
    // healthy projection, or every run would cry wolf and the signal would
    // be worth nothing.
    const current = pullRequest({ number: 1, title: "Same", updatedAt: "2026-08-26T12:00:00Z" });
    await seedProjection([current]);
    api.openPullRequests = [current];

    expect((await reconcile()).drifted).toEqual([]);
  });

  it("reports nothing rather than guessing when the live list is unavailable", async () => {
    // Without the live list every stored PR looks equally suspicious, and
    // inventing drift would poison the signal the report exists to carry.
    await seedProjection([pullRequest({ number: 1 }), pullRequest({ number: 2 })]);
    api.openPullRequestsError = new Error("503 Service Unavailable");

    const report = await reconcile();

    expect(report.checked).toBe(2);
    expect(report.drifted).toEqual([]);
    const sync = objects.get("github/sync/pull_requests.json") as { lastDrift?: number };
    expect(sync?.lastDrift).toBe(0);
  });

  it("bounds how much of the projection one pass reads", async () => {
    await seedProjection([
      pullRequest({ number: 1 }),
      pullRequest({ number: 2 }),
      pullRequest({ number: 3 }),
    ]);
    api.openPullRequests = [];

    const report = await reconcile(2);
    expect(report.checked).toBe(2);
  });
});
