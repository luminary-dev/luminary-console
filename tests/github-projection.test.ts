// Persistence for projected GitHub entities.
//
// Two things carry real risk here. The first is the ordering guard in
// putPullRequest: webhook delivery is at-least-once and out-of-order, so a
// redelivered older snapshot must never overwrite a newer projection. The
// second is key derivation: a repository full name arrives from a payload and
// is used to build a storage path, so it has to collapse into exactly one
// safe key segment.
import { beforeEach, describe, expect, it, vi } from "vitest";

const objects = new Map<string, unknown>();

// When set, listState answers with keys that do not carry the bucket's
// `/state/` marker, which is how a key in an unexpected shape is simulated.
const store = { rawKeys: false };

vi.mock("@/lib/store", () => ({
  readState: vi.fn(async (p: string) => (objects.has(p) ? structuredClone(objects.get(p)) : null)),
  writeState: vi.fn(async (p: string, d: unknown) => {
    objects.set(p, structuredClone(d));
  }),
  clearState: vi.fn(async (p: string) => {
    objects.delete(p);
  }),
  listState: vi.fn(async (prefix: string) =>
    [...objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => (store.rawKeys ? k : `console/state/${k}`)),
  ),
}));

import {
  deletePullRequest,
  deleteRepo,
  getPullRequest,
  getRepo,
  listAlerts,
  listAllAlerts,
  listAllDeployments,
  listAllPullRequests,
  listAllReleases,
  listAllWorkflowRuns,
  listDeployments,
  listPullRequests,
  listReleases,
  listRepos,
  listWorkflowRuns,
  putAlert,
  putDeployment,
  putPullRequest,
  putRelease,
  putRepo,
  putWorkflowRun,
  repoKey,
} from "@/lib/github/projection";
import type {
  AlertEntity,
  DeploymentEntity,
  PullRequestEntity,
  ReleaseEntity,
  RepoEntity,
  WorkflowRunEntity,
} from "@/lib/github/entities";
import { atIndex } from "./helpers";

const REPO = "luminary-dev/console";

function pullRequest(overrides: Partial<PullRequestEntity> = {}): PullRequestEntity {
  return {
    id: 1001,
    repo: REPO,
    number: 7,
    title: "Add a thing",
    state: "open",
    draft: false,
    assignees: [],
    requestedReviewers: [],
    labels: [],
    headRef: "feature",
    headSha: "a".repeat(40),
    baseRef: "main",
    fromFork: false,
    createdAt: "2026-08-20T09:00:00Z",
    updatedAt: "2026-08-26T10:00:00Z",
    mergeable: true,
    url: `https://github.com/${REPO}/pull/7`,
    reviews: [],
    checks: [],
    syncedAt: "2026-08-26T10:00:01Z",
    ...overrides,
  };
}

function repo(overrides: Partial<RepoEntity> = {}): RepoEntity {
  return {
    id: 500,
    name: "console",
    fullName: REPO,
    private: true,
    archived: false,
    defaultBranch: "main",
    url: `https://github.com/${REPO}`,
    syncedAt: "2026-08-26T10:00:00Z",
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRunEntity> = {}): WorkflowRunEntity {
  return {
    id: 9001,
    repo: REPO,
    name: "CI",
    headSha: "b".repeat(40),
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-26T10:00:00Z",
    updatedAt: "2026-08-26T10:05:00Z",
    ...overrides,
  };
}

function deployment(overrides: Partial<DeploymentEntity> = {}): DeploymentEntity {
  return {
    id: 3001,
    repo: REPO,
    environment: "production",
    ref: "main",
    sha: "c".repeat(40),
    state: "success",
    createdAt: "2026-08-26T10:00:00Z",
    ...overrides,
  };
}

function release(overrides: Partial<ReleaseEntity> = {}): ReleaseEntity {
  return {
    id: 4001,
    repo: REPO,
    tagName: "v1.0.0",
    draft: false,
    prerelease: false,
    publishedAt: "2026-08-26T10:00:00Z",
    ...overrides,
  };
}

function alert(overrides: Partial<AlertEntity> = {}): AlertEntity {
  return {
    repo: REPO,
    kind: "dependabot",
    number: 1,
    state: "open",
    title: "Vulnerability in left-pad",
    ...overrides,
  };
}

beforeEach(() => {
  objects.clear();
  store.rawKeys = false;
});

describe("repoKey", () => {
  it("collapses a full name into a single safe key segment", () => {
    // The name arrives from a payload and is concatenated into a storage path,
    // so the slash must not survive as a path separator.
    expect(repoKey("luminary-dev/console")).toBe("luminary-dev_console");
  });

  it("neutralises a traversal attempt rather than passing it through", () => {
    // No slash survives, so "../.." cannot climb out of the github/ prefix.
    const key = repoKey("../../etc/passwd");
    expect(key).toBe(".._.._etc_passwd");
    expect(key).not.toContain("/");
  });

  it("refuses a name that cannot produce a usable key", () => {
    expect(() => repoKey("")).toThrow(/Unusable repository name/);
    expect(() => repoKey(`owner/${"n".repeat(200)}`)).toThrow(/Unusable repository name/);
  });
});

describe("storage key derivation", () => {
  it("gives every entity kind its own per-repo prefix", async () => {
    await putPullRequest(pullRequest());
    await putRepo(repo());
    await putWorkflowRun(run());
    await putDeployment(deployment());
    await putRelease(release());
    await putAlert(alert());

    expect([...objects.keys()].sort()).toEqual([
      "github/alerts/luminary-dev_console/dependabot-1.json",
      "github/deployments/luminary-dev_console/3001.json",
      "github/prs/luminary-dev_console/7.json",
      "github/releases/luminary-dev_console/4001.json",
      "github/repos/luminary-dev_console.json",
      "github/runs/luminary-dev_console/9001.json",
    ]);
  });

  it("keeps the same alert number in different scanners apart", async () => {
    // Dependabot #1 and a code scanning #1 are different alerts; a key without
    // the scanner in it would let one silently overwrite the other.
    await putAlert(alert({ kind: "dependabot", number: 1, title: "Dependabot one" }));
    await putAlert(alert({ kind: "code_scanning", number: 1, title: "Code scanning one" }));
    expect(await listAlerts(REPO)).toHaveLength(2);
  });

  it("truncates a non-integer id so a read finds what a write stored", async () => {
    await putPullRequest(pullRequest({ number: 7.9 }));
    expect([...objects.keys()]).toContain("github/prs/luminary-dev_console/7.json");
    expect(await getPullRequest(REPO, 7)).not.toBeNull();
  });
});

describe("putPullRequest ordering guard", () => {
  it("accepts a newer projection over an older one", async () => {
    await putPullRequest(pullRequest({ title: "Old", updatedAt: "2026-08-26T10:00:00Z" }));
    const result = await putPullRequest(
      pullRequest({ title: "New", updatedAt: "2026-08-26T11:00:00Z" }),
    );

    expect(result.written).toBe(true);
    const stored = await getPullRequest(REPO, 7);
    expect(stored?.title).toBe("New");
  });

  it("refuses an older projection over a newer one", async () => {
    // The case this exists for: a redelivered `closed` landing after the
    // `reopened` that superseded it must not resurrect the stale state.
    await putPullRequest(
      pullRequest({ state: "open", title: "Reopened", updatedAt: "2026-08-26T11:00:00Z" }),
    );
    const result = await putPullRequest(
      pullRequest({ state: "closed", title: "Closed", updatedAt: "2026-08-26T10:00:00Z" }),
    );

    expect(result.written).toBe(false);
    const stored = await getPullRequest(REPO, 7);
    expect(stored?.state).toBe("open");
    expect(stored?.title).toBe("Reopened");
  });

  it("writes on an equal timestamp rather than dropping the delivery", async () => {
    // The comparison is strictly `incoming < current`, so a same-second event
    // (a label added moments after an edit) still lands. Dropping ties would
    // lose real updates, and rewriting an identical snapshot costs nothing.
    const at = "2026-08-26T10:00:00Z";
    await putPullRequest(pullRequest({ title: "First", updatedAt: at }));
    const result = await putPullRequest(pullRequest({ title: "Second", updatedAt: at }));

    expect(result.written).toBe(true);
    expect((await getPullRequest(REPO, 7))?.title).toBe("Second");
  });

  it("converges to the same state whichever order the two writes arrive in", async () => {
    const older = pullRequest({ state: "closed", title: "Closed", updatedAt: "2026-08-26T10:00:00Z" });
    const newer = pullRequest({ state: "open", title: "Reopened", updatedAt: "2026-08-26T11:00:00Z" });

    await putPullRequest(older);
    await putPullRequest(newer);
    const inOrder = await getPullRequest(REPO, 7);

    objects.clear();
    await putPullRequest(newer);
    await putPullRequest(older);
    const reversed = await getPullRequest(REPO, 7);

    expect(reversed).toEqual(inOrder);
  });

  it("is idempotent when the same snapshot is replayed", async () => {
    const pr = pullRequest();
    await putPullRequest(pr);
    const first = await getPullRequest(REPO, 7);
    const replay = await putPullRequest(pr);

    expect(replay.written).toBe(true);
    expect(await getPullRequest(REPO, 7)).toEqual(first);
    expect(objects.size).toBe(1);
  });

  it("writes when a timestamp cannot be parsed, rather than blocking forever", async () => {
    // An unparseable `updated_at` must fail open. Treating it as infinitely
    // new would wedge the projection: nothing could ever replace it.
    await putPullRequest(pullRequest({ title: "Broken clock", updatedAt: "not-a-date" }));
    const result = await putPullRequest(
      pullRequest({ title: "Real", updatedAt: "2026-08-26T10:00:00Z" }),
    );

    expect(result.written).toBe(true);
    expect((await getPullRequest(REPO, 7))?.title).toBe("Real");
  });

  it("writes the first copy when nothing is stored yet", async () => {
    const result = await putPullRequest(pullRequest());
    expect(result.written).toBe(true);
    expect((await getPullRequest(REPO, 7))?.number).toBe(7);
  });
});

describe("pull request reads", () => {
  it("returns null for a pull request that was never stored", async () => {
    expect(await getPullRequest(REPO, 404)).toBeNull();
  });

  it("removes a projection on delete", async () => {
    await putPullRequest(pullRequest());
    await deletePullRequest(REPO, 7);
    expect(await getPullRequest(REPO, 7)).toBeNull();
  });

  it("deleting an absent projection is a no-op, not an error", async () => {
    await expect(deletePullRequest(REPO, 999)).resolves.toBeUndefined();
  });

  it("lists only the pull requests of the repo asked for", async () => {
    await putPullRequest(pullRequest({ number: 1 }));
    await putPullRequest(pullRequest({ number: 2 }));
    await putPullRequest(pullRequest({ repo: "luminary-dev/other", number: 3 }));

    const mine = await listPullRequests(REPO);
    expect(mine.map((p) => p.number).sort()).toEqual([1, 2]);
  });

  it("honours the cap on a per-repo listing", async () => {
    for (const n of [1, 2, 3]) await putPullRequest(pullRequest({ number: n }));
    expect(await listPullRequests(REPO, 2)).toHaveLength(2);
  });

  it("orders the org-wide inbox by most recently updated", async () => {
    await putRepo(repo());
    await putRepo(repo({ id: 501, name: "site", fullName: "luminary-dev/site" }));
    await putPullRequest(pullRequest({ number: 1, updatedAt: "2026-08-24T10:00:00Z" }));
    await putPullRequest(
      pullRequest({ repo: "luminary-dev/site", number: 2, updatedAt: "2026-08-26T10:00:00Z" }),
    );

    const all = await listAllPullRequests();
    expect(all.map((p) => p.number)).toEqual([2, 1]);
  });

  it("shows a pull request whose repository projection is missing", async () => {
    // The org-wide inbox used to enumerate repositories first, which hid any
    // pull request stored under a repository we held no RepoEntity for. That
    // was reachable: the pull_request handler writes the pull request but
    // never writes a repository, and push only updates a repository
    // projection that already exists, so a repository that only ever emitted
    // pull request events accumulated work no screen would show. The listing
    // now reads the stored objects directly, so the repository index cannot
    // hide anything.
    await putPullRequest(pullRequest());
    expect(await listAllPullRequests()).toHaveLength(1);

    // Projecting the repository afterwards must not duplicate it either.
    await putRepo(repo());
    expect(await listAllPullRequests()).toHaveLength(1);
  });

  it("honours the cap on the org-wide inbox", async () => {
    await putRepo(repo());
    for (const n of [1, 2, 3]) await putPullRequest(pullRequest({ number: n }));
    expect(await listAllPullRequests(2)).toHaveLength(2);
  });
});

describe("repositories", () => {
  it("round-trips a repository projection", async () => {
    await putRepo(repo());
    expect((await getRepo(REPO))?.fullName).toBe(REPO);
  });

  it("returns null for an unknown repository", async () => {
    expect(await getRepo("luminary-dev/nope")).toBeNull();
  });

  it("removes a repository projection on delete", async () => {
    await putRepo(repo());
    await deleteRepo(REPO);
    expect(await getRepo(REPO)).toBeNull();
    expect(await listRepos()).toEqual([]);
  });

  it("lists repositories by full name so the order is stable between reads", async () => {
    await putRepo(repo({ id: 3, name: "site", fullName: "luminary-dev/site" }));
    await putRepo(repo({ id: 1, name: "console", fullName: "luminary-dev/console" }));
    await putRepo(repo({ id: 2, name: "docs", fullName: "luminary-dev/docs" }));

    expect((await listRepos()).map((r) => r.fullName)).toEqual([
      "luminary-dev/console",
      "luminary-dev/docs",
      "luminary-dev/site",
    ]);
  });

  it("skips a bucket key that does not carry the state marker", async () => {
    // listState answers with full bucket keys. A key in an unexpected shape is
    // dropped rather than crashing the whole listing.
    await putRepo(repo());
    store.rawKeys = true;
    expect(await listRepos()).toEqual([]);
  });
});

describe("workflow runs", () => {
  it("lists a repo's runs newest first", async () => {
    await putWorkflowRun(run({ id: 1, createdAt: "2026-08-24T10:00:00Z" }));
    await putWorkflowRun(run({ id: 2, createdAt: "2026-08-26T10:00:00Z" }));
    expect((await listWorkflowRuns(REPO)).map((r) => r.id)).toEqual([2, 1]);
  });

  it("overwrites a run in place when the same run is re-read", async () => {
    // A run is re-projected on every status change, so the key must be the run
    // id and not something that accumulates a row per update.
    await putWorkflowRun(run({ id: 1, status: "in_progress", conclusion: null }));
    await putWorkflowRun(run({ id: 1, status: "completed", conclusion: "failure" }));

    const runs = await listWorkflowRuns(REPO);
    expect(runs).toHaveLength(1);
    expect(atIndex(runs, 0).conclusion).toBe("failure");
  });

  it("orders the org-wide run list across repositories", async () => {
    await putRepo(repo());
    await putRepo(repo({ id: 2, name: "site", fullName: "luminary-dev/site" }));
    await putWorkflowRun(run({ id: 1, createdAt: "2026-08-24T10:00:00Z" }));
    await putWorkflowRun(
      run({ id: 2, repo: "luminary-dev/site", createdAt: "2026-08-26T10:00:00Z" }),
    );

    expect((await listAllWorkflowRuns()).map((r) => r.id)).toEqual([2, 1]);
    expect(await listAllWorkflowRuns(1)).toHaveLength(1);
  });

  it("honours the cap on a per-repo run listing", async () => {
    for (const id of [1, 2, 3]) await putWorkflowRun(run({ id }));
    expect(await listWorkflowRuns(REPO, 2)).toHaveLength(2);
  });
});

describe("deployments", () => {
  it("lists a repo's deployments newest first", async () => {
    await putDeployment(deployment({ id: 1, createdAt: "2026-08-24T10:00:00Z" }));
    await putDeployment(deployment({ id: 2, createdAt: "2026-08-26T10:00:00Z" }));
    expect((await listDeployments(REPO)).map((d) => d.id)).toEqual([2, 1]);
    expect(await listDeployments(REPO, 1)).toHaveLength(1);
  });

  it("orders the org-wide deployment list across repositories", async () => {
    await putRepo(repo());
    await putRepo(repo({ id: 2, name: "site", fullName: "luminary-dev/site" }));
    await putDeployment(deployment({ id: 1, createdAt: "2026-08-24T10:00:00Z" }));
    await putDeployment(
      deployment({ id: 2, repo: "luminary-dev/site", createdAt: "2026-08-26T10:00:00Z" }),
    );

    expect((await listAllDeployments()).map((d) => d.id)).toEqual([2, 1]);
    expect(await listAllDeployments(1)).toHaveLength(1);
  });
});

describe("releases", () => {
  it("lists releases newest published first, with an unpublished draft last", async () => {
    // A draft has no published_at at all; sorting must not throw on it or push
    // it above shipped releases.
    await putRelease(release({ id: 1, publishedAt: "2026-08-24T10:00:00Z" }));
    await putRelease(release({ id: 2, publishedAt: "2026-08-26T10:00:00Z" }));
    for (const id of [3, 4]) {
      const draft = release({ id, draft: true });
      delete draft.publishedAt;
      await putRelease(draft);
    }

    const listed = await listReleases(REPO);
    expect(listed.map((r) => r.id).slice(0, 2)).toEqual([2, 1]);
    expect(listed.map((r) => r.id).slice(2).sort()).toEqual([3, 4]);
    expect(await listReleases(REPO, 2)).toHaveLength(2);
  });

  it("orders the org-wide release list across repositories, drafts last", async () => {
    await putRepo(repo());
    await putRepo(repo({ id: 2, name: "site", fullName: "luminary-dev/site" }));
    await putRelease(release({ id: 1, publishedAt: "2026-08-24T10:00:00Z" }));
    await putRelease(
      release({ id: 2, repo: "luminary-dev/site", publishedAt: "2026-08-26T10:00:00Z" }),
    );
    for (const [id, owner] of [[3, "luminary-dev/site"], [4, REPO]] as const) {
      const draft = release({ id, repo: owner, draft: true });
      delete draft.publishedAt;
      await putRelease(draft);
    }

    const listed = await listAllReleases();
    expect(listed.map((r) => r.id).slice(0, 2)).toEqual([2, 1]);
    expect(listed.map((r) => r.id).slice(2).sort()).toEqual([3, 4]);
    expect(await listAllReleases(1)).toHaveLength(1);
  });
});

describe("alerts", () => {
  it("honours the cap on a per-repo alert listing", async () => {
    for (const n of [1, 2, 3]) await putAlert(alert({ number: n }));
    expect(await listAlerts(REPO, 2)).toHaveLength(2);
  });

  it("leads with open alerts, then with the worst severity", async () => {
    // The security view must open on what matters. A resolved critical below a
    // live low is the ordering that makes the screen useful.
    await putRepo(repo());
    await putAlert(alert({ number: 1, state: "open", severity: "low", title: "Open low" }));
    await putAlert(alert({ number: 2, state: "fixed", severity: "critical", title: "Fixed critical" }));
    await putAlert(alert({ number: 3, state: "open", severity: "critical", title: "Open critical" }));

    expect((await listAllAlerts()).map((a) => a.title)).toEqual([
      "Open critical",
      "Open low",
      "Fixed critical",
    ]);
  });

  it("ranks an unknown or missing severity below every known one", async () => {
    await putRepo(repo());
    const missing = alert({ number: 1, title: "No severity" });
    await putAlert(missing);
    await putAlert(alert({ number: 2, severity: "note", title: "Note" }));
    await putAlert(alert({ number: 3, severity: "banana", title: "Nonsense" }));

    const titles = (await listAllAlerts()).map((a) => a.title);
    expect(atIndex(titles, 0)).toBe("Note");
    expect(titles.slice(1).sort()).toEqual(["No severity", "Nonsense"]);
  });

  it("treats moderate and medium as the same severity band", async () => {
    // GitHub uses "moderate" for Dependabot and "medium" for code scanning;
    // ranking them differently would interleave equal risks arbitrarily.
    await putRepo(repo());
    await putAlert(alert({ number: 1, severity: "moderate", title: "Moderate" }));
    await putAlert(alert({ number: 2, kind: "code_scanning", severity: "medium", title: "Medium" }));
    await putAlert(alert({ number: 3, severity: "low", title: "Low" }));

    const titles = (await listAllAlerts()).map((a) => a.title);
    expect(atIndex(titles, 2)).toBe("Low");
    expect(titles.slice(0, 2).sort()).toEqual(["Medium", "Moderate"]);
  });

  it("honours the cap on the org-wide alert list", async () => {
    await putRepo(repo());
    for (const n of [1, 2, 3]) await putAlert(alert({ number: n }));
    expect(await listAllAlerts(2)).toHaveLength(2);
  });
});
