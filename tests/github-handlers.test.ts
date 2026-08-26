// Webhook event handlers.
//
// The rule these are built on is that a handler reconciles against the API
// rather than applying the payload's own copy of the entity. That is what
// makes at-least-once, out-of-order delivery safe, so most of what is asserted
// here is that the payload is used to decide WHICH entity to re-read and
// never as the source of the entity's state.
import { beforeEach, describe, expect, it, vi } from "vitest";

const objects = new Map<string, unknown>();

vi.mock("@/lib/store", () => ({
  readState: vi.fn(async (p: string) => (objects.has(p) ? structuredClone(objects.get(p)) : null)),
  writeState: vi.fn(async (p: string, d: unknown) => {
    objects.set(p, structuredClone(d));
  }),
  clearState: vi.fn(async (p: string) => {
    objects.delete(p);
  }),
  listState: vi.fn(async (prefix: string) =>
    [...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => `console/state/${k}`),
  ),
}));

// The GitHub API stands in for the upstream truth. Handlers are supposed to
// read it on every delivery, so the stub records what it was asked for and can
// answer differently between calls or fail on demand.
const api = {
  pr: null as PullRequestEntity | null,
  prError: null as unknown,
  prCalls: [] as { repo: string; number: number }[],
  repo: null as RepoEntity | null,
  repoError: null as unknown,
  repoCalls: [] as string[],
  runs: [] as WorkflowRunEntity[],
};

vi.mock("@/lib/github/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/api")>("@/lib/github/api");
  return {
    ...actual,
    fetchPullRequest: vi.fn(async (repo: string, number: number) => {
      api.prCalls.push({ repo, number });
      if (api.prError) throw api.prError;
      return api.pr ? { ...api.pr, repo, number } : null;
    }),
    fetchRepo: vi.fn(async (fullName: string) => {
      api.repoCalls.push(fullName);
      if (api.repoError) throw api.repoError;
      return api.repo ? { ...api.repo, fullName } : null;
    }),
    fetchWorkflowRuns: vi.fn(async () => api.runs),
  };
});

import { GitHubError } from "@/lib/github/client";
import { hasHandler, handleEvent, syncWorkflowRuns } from "@/lib/github/handlers";
import {
  getPullRequest,
  getRepo,
  listAlerts,
  listDeployments,
  listReleases,
  listWorkflowRuns,
  putPullRequest,
  putRepo,
} from "@/lib/github/projection";
import type {
  PullRequestEntity,
  RepoEntity,
  WorkflowRunEntity,
} from "@/lib/github/entities";
import { atIndex } from "./helpers";

const REPO = "luminary-dev/console";

// Payload fragments, shaped like the ones GitHub actually sends.

const ghRepo = (fullName = REPO) => ({
  id: 500,
  name: fullName.split("/")[1] ?? fullName,
  full_name: fullName,
  private: true,
  default_branch: "main",
});

const ghPull = (overrides: Record<string, unknown> = {}) => ({
  id: 1001,
  number: 7,
  state: "open",
  title: "Add a thing",
  created_at: "2026-08-20T09:00:00Z",
  updated_at: "2026-08-26T10:00:00Z",
  head: { ref: "feature", sha: "a".repeat(40) },
  base: { ref: "main", sha: "b".repeat(40) },
  ...overrides,
});

const ghIssue = (overrides: Record<string, unknown> = {}) => ({
  id: 2001,
  number: 42,
  state: "open",
  title: "Something is wrong",
  created_at: "2026-08-20T09:00:00Z",
  updated_at: "2026-08-26T10:00:00Z",
  ...overrides,
});

function entity(overrides: Partial<PullRequestEntity> = {}): PullRequestEntity {
  return {
    id: 1001,
    repo: REPO,
    number: 7,
    title: "Fresh from the API",
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
    updatedAt: "2026-08-26T12:00:00Z",
    mergeable: true,
    url: `https://github.com/${REPO}/pull/7`,
    reviews: [],
    checks: [],
    syncedAt: "2026-08-26T12:00:01Z",
    ...overrides,
  };
}

function repoEntity(overrides: Partial<RepoEntity> = {}): RepoEntity {
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

function runEntity(overrides: Partial<WorkflowRunEntity> = {}): WorkflowRunEntity {
  return {
    id: 9001,
    repo: REPO,
    name: "CI",
    headSha: "c".repeat(40),
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-26T10:00:00Z",
    updatedAt: "2026-08-26T10:05:00Z",
    ...overrides,
  };
}

const deliver = (event: string, payload: unknown) =>
  handleEvent({ event, deliveryId: "delivery-1", payload });

beforeEach(() => {
  objects.clear();
  api.pr = entity();
  api.prError = null;
  api.prCalls = [];
  api.repo = repoEntity();
  api.repoError = null;
  api.repoCalls = [];
  api.runs = [];
});

describe("reconciling a pull request", () => {
  it("stores what the API says, not what the payload carries", async () => {
    // The payload is a snapshot from when the event fired and may be minutes
    // stale by the time a retry lands, so it must not be the source of state.
    api.pr = entity({ title: "Fresh from the API", state: "open" });

    const result = await deliver("pull_request", {
      action: "closed",
      repository: ghRepo(),
      pull_request: ghPull({ title: "Stale payload title", state: "closed" }),
    });

    const stored = await getPullRequest(REPO, 7);
    expect(stored?.title).toBe("Fresh from the API");
    expect(stored?.state).toBe("open");
    expect(result.summary).toBe("pull_request.closed: reconciled luminary-dev/console#7");
    expect(api.prCalls).toEqual([{ repo: REPO, number: 7 }]);
  });

  it("names the entity it touched so the UI can invalidate precisely", async () => {
    const result = await deliver("pull_request", {
      action: "opened",
      repository: ghRepo(),
      pull_request: ghPull(),
    });
    expect(result.touched).toEqual([{ kind: "pull_request", id: "luminary-dev/console#7" }]);
  });

  it("converges to the same state whichever order two deliveries arrive in", async () => {
    // A redelivered `closed` landing after the `reopened` that superseded it is
    // the classic out-of-order case. Both re-read, so both end up open.
    const closed = {
      action: "closed",
      repository: ghRepo(),
      pull_request: ghPull({ state: "closed" }),
    };
    const reopened = {
      action: "reopened",
      repository: ghRepo(),
      pull_request: ghPull({ state: "open" }),
    };

    await deliver("pull_request", reopened);
    await deliver("pull_request", closed);
    const afterOutOfOrder = await getPullRequest(REPO, 7);

    objects.clear();
    await deliver("pull_request", closed);
    await deliver("pull_request", reopened);

    expect(await getPullRequest(REPO, 7)).toEqual(afterOutOfOrder);
    expect(afterOutOfOrder?.state).toBe("open");
  });

  it("is idempotent when the very same delivery is replayed", async () => {
    const payload = { action: "synchronize", repository: ghRepo(), pull_request: ghPull() };

    const first = await deliver("pull_request", payload);
    const stored = await getPullRequest(REPO, 7);
    const second = await deliver("pull_request", payload);

    expect(second.summary).toBe(first.summary);
    expect(await getPullRequest(REPO, 7)).toEqual(stored);
    // A replay still costs a read: that read is what makes it safe.
    expect(api.prCalls).toHaveLength(2);
  });

  it("keeps a newer projection when the API answers with an older snapshot", async () => {
    // Two reconciles can race; the projection guard decides, and the handler
    // reports that it kept what it had rather than claiming a write.
    await putPullRequest(entity({ title: "Newer", updatedAt: "2026-08-26T13:00:00Z" }));
    api.pr = entity({ title: "Older", updatedAt: "2026-08-26T09:00:00Z" });

    const result = await deliver("pull_request", {
      action: "edited",
      repository: ghRepo(),
      pull_request: ghPull(),
    });

    expect(result.summary).toBe(
      "pull_request.edited: luminary-dev/console#7 already newer, kept",
    );
    expect((await getPullRequest(REPO, 7))?.title).toBe("Newer");
  });

  it("removes the projection when the entity has gone upstream", async () => {
    // A tombstone would keep showing in the inbox, so an entity the API no
    // longer returns is dropped rather than left behind.
    await putPullRequest(entity());
    api.pr = null;

    const result = await deliver("pull_request", {
      action: "closed",
      repository: ghRepo(),
      pull_request: ghPull(),
    });

    expect(result.summary).toBe("luminary-dev/console#7 no longer exists, projection removed");
    expect(result.touched).toBeUndefined();
    expect(await getPullRequest(REPO, 7)).toBeNull();
  });

  it("removes the projection when the API answers 404", async () => {
    await putPullRequest(entity());
    api.prError = new GitHubError("Not Found", 404, "/repos/x/pulls/7");

    const result = await deliver("pull_request", {
      action: "closed",
      repository: ghRepo(),
      pull_request: ghPull(),
    });

    expect(result.summary).toBe("luminary-dev/console#7 not found, projection removed");
    expect(await getPullRequest(REPO, 7)).toBeNull();
  });

  it("re-raises anything that is not a 404 so the delivery is retried", async () => {
    // A 500 is transient. Swallowing it would mark the delivery done and lose
    // the update for good.
    await putPullRequest(entity({ title: "Kept" }));
    api.prError = new GitHubError("Server Error", 500, "/repos/x/pulls/7");

    await expect(
      deliver("pull_request", { action: "closed", repository: ghRepo(), pull_request: ghPull() }),
    ).rejects.toThrow(GitHubError);
    expect((await getPullRequest(REPO, 7))?.title).toBe("Kept");
  });

  it("re-raises a transport failure that is not a GitHubError at all", async () => {
    api.prError = new Error("socket hang up");
    await expect(
      deliver("pull_request", { action: "opened", repository: ghRepo(), pull_request: ghPull() }),
    ).rejects.toThrow("socket hang up");
  });

  it("skips a pull request event that carries no repository", async () => {
    const result = await deliver("pull_request", { action: "opened", pull_request: ghPull() });
    expect(result.summary).toBe("pull_request without a repository, skipped");
    expect(api.prCalls).toEqual([]);
  });

  it("rejects a malformed payload rather than storing a half-parsed entity", async () => {
    await expect(deliver("pull_request", { action: "opened" })).rejects.toThrow();
    await expect(
      deliver("pull_request", {
        action: "opened",
        repository: ghRepo(),
        pull_request: { id: 1, number: "seven" },
      }),
    ).rejects.toThrow();
    expect(objects.size).toBe(0);
  });
});

describe("review events", () => {
  it("reconciles the whole pull request when a review lands", async () => {
    // A dismissed review changes merge readiness, so the PR is re-derived
    // rather than having its review list patched in place.
    const result = await deliver("pull_request_review", {
      action: "dismissed",
      repository: ghRepo(),
      review: { id: 55, state: "dismissed" },
      pull_request: ghPull(),
    });

    expect(result.summary).toBe("review.dismissed: reconciled luminary-dev/console#7");
    expect(api.prCalls).toEqual([{ repo: REPO, number: 7 }]);
  });

  it("skips a review with no repository", async () => {
    const result = await deliver("pull_request_review", {
      action: "submitted",
      review: { id: 55, state: "approved" },
      pull_request: ghPull(),
    });
    expect(result.summary).toBe("pull_request_review without a repository, skipped");
  });

  it("reconciles on a review comment", async () => {
    const result = await deliver("pull_request_review_comment", {
      action: "created",
      repository: ghRepo(),
      comment: { id: 77, body: "nit" },
      pull_request: ghPull(),
    });
    expect(result.summary).toBe("review_comment: reconciled luminary-dev/console#7");
  });

  it("skips a review comment with no repository", async () => {
    const result = await deliver("pull_request_review_comment", {
      action: "created",
      comment: { id: 77 },
      pull_request: ghPull(),
    });
    expect(result.summary).toBe("review comment without a repository, skipped");
  });

  it("reconciles on a resolved review thread, which can unblock a merge", async () => {
    const result = await deliver("pull_request_review_thread", {
      action: "resolved",
      repository: ghRepo(),
      thread: { node_id: "PRRT_1" },
      pull_request: ghPull(),
    });
    expect(result.summary).toBe("thread.resolved: reconciled luminary-dev/console#7");
  });

  it("skips a review thread with no repository", async () => {
    const result = await deliver("pull_request_review_thread", {
      action: "resolved",
      thread: {},
      pull_request: ghPull(),
    });
    expect(result.summary).toBe("review thread without a repository, skipped");
  });
});

describe("checks", () => {
  const checkRun = (overrides: Record<string, unknown> = {}) => ({
    id: 8001,
    name: "build",
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "failure",
    ...overrides,
  });

  it("reconciles every pull request a check run names, exactly once each", async () => {
    // The same PR appears on both the run and its suite; reconciling twice
    // would double the API cost for no new information.
    const result = await deliver("check_run", {
      action: "completed",
      repository: ghRepo(),
      check_run: checkRun({
        pull_requests: [{ number: 7 }],
        check_suite: { id: 4, pull_requests: [{ number: 7 }, { number: 9 }] },
      }),
    });

    expect(api.prCalls.map((c) => c.number)).toEqual([7, 9]);
    expect(result.touched).toHaveLength(2);
    expect(result.summary).toContain("check_run.completed: reconciled luminary-dev/console#7");
    expect(result.summary).toContain("check_run.completed: reconciled luminary-dev/console#9");
  });

  it("touches nothing when the pull requests a check named are all gone", async () => {
    // A check can arrive after the PR is deleted upstream. Each reconcile then
    // removes a projection and touches nothing, and the aggregate must be an
    // empty list rather than a list of undefined.
    api.pr = null;
    const result = await deliver("check_run", {
      action: "completed",
      repository: ghRepo(),
      check_run: checkRun({ pull_requests: [{ number: 7 }] }),
    });

    expect(result.touched).toEqual([]);
    expect(result.summary).toBe("luminary-dev/console#7 no longer exists, projection removed");
  });

  it("touches nothing when a check suite's pull requests are gone", async () => {
    api.pr = null;
    const result = await deliver("check_suite", {
      action: "completed",
      repository: ghRepo(),
      check_suite: {
        id: 4,
        head_sha: "d".repeat(40),
        status: "completed",
        pull_requests: [{ number: 7 }],
      },
    });
    expect(result.touched).toEqual([]);
  });

  it("records a check on a branch with no pull request instead of failing", async () => {
    const result = await deliver("check_run", {
      action: "completed",
      repository: ghRepo(),
      check_run: checkRun(),
    });
    expect(result.summary).toBe("check_run build on luminary-dev/console, no associated PR");
    expect(api.prCalls).toEqual([]);
  });

  it("skips a check run with no repository", async () => {
    const result = await deliver("check_run", { action: "completed", check_run: checkRun() });
    expect(result.summary).toBe("check_run without a repository, skipped");
  });

  it("reconciles the pull requests a check suite names", async () => {
    const result = await deliver("check_suite", {
      action: "completed",
      repository: ghRepo(),
      check_suite: {
        id: 4,
        head_sha: "d".repeat(40),
        status: "completed",
        pull_requests: [{ number: 7 }],
      },
    });

    expect(api.prCalls).toEqual([{ repo: REPO, number: 7 }]);
    expect(result.touched).toEqual([{ kind: "pull_request", id: "luminary-dev/console#7" }]);
  });

  it("names the head SHA when a check suite has no pull request", async () => {
    const result = await deliver("check_suite", {
      action: "completed",
      repository: ghRepo(),
      check_suite: { id: 4, head_sha: "abcdef0123456789", status: "completed" },
    });
    expect(result.summary).toBe("check_suite on luminary-dev/console@abcdef0, no PR");
  });

  it("skips a check suite with no repository", async () => {
    const result = await deliver("check_suite", {
      action: "completed",
      check_suite: { id: 4, head_sha: "a".repeat(40), status: "completed" },
    });
    expect(result.summary).toBe("check_suite without a repository, skipped");
  });

  it("records a legacy commit status, which carries no pull request reference", async () => {
    const result = await deliver("status", {
      repository: ghRepo(),
      sha: "abcdef0123456789",
      state: "success",
      context: "ci/circleci",
    });
    expect(result.summary).toBe("status ci/circleci success on luminary-dev/console@abcdef0");
    expect(api.prCalls).toEqual([]);
  });

  it("records a commit status even when the repository is absent", async () => {
    const result = await deliver("status", {
      sha: "abcdef0123456789",
      state: "failure",
      context: "ci",
    });
    expect(result.summary).toBe("status ci failure on unknown@abcdef0");
  });
});

describe("workflow runs and jobs", () => {
  const ghRun = (overrides: Record<string, unknown> = {}) => ({
    id: 9001,
    name: "CI",
    head_sha: "c".repeat(40),
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-26T10:00:00Z",
    updated_at: "2026-08-26T10:05:00Z",
    ...overrides,
  });

  it("stores the run and reconciles the pull requests at that SHA", async () => {
    const result = await deliver("workflow_run", {
      action: "completed",
      repository: ghRepo(),
      workflow_run: ghRun({ pull_requests: [{ number: 7 }] }),
    });

    const runs = await listWorkflowRuns(REPO);
    expect(runs).toHaveLength(1);
    expect(atIndex(runs, 0).conclusion).toBe("success");
    expect(api.prCalls).toEqual([{ repo: REPO, number: 7 }]);
    expect(result.touched).toEqual([{ kind: "workflow_run", id: "luminary-dev/console#9001" }]);
    expect(result.summary).toBe("workflow_run CI completed on luminary-dev/console");
  });

  it("stores a run that belongs to no pull request", async () => {
    await deliver("workflow_run", {
      action: "requested",
      repository: ghRepo(),
      workflow_run: ghRun(),
    });
    expect(await listWorkflowRuns(REPO)).toHaveLength(1);
    expect(api.prCalls).toEqual([]);
  });

  it("handles a run whose workflow has no name", async () => {
    // GitHub sends a null name for a run whose workflow file was deleted, and
    // the summary must not read "undefined".
    const result = await deliver("workflow_run", {
      action: "completed",
      repository: ghRepo(),
      workflow_run: ghRun({ name: null }),
    });

    // "workflow" rather than an empty string, which rendered as a double
    // space, and matching what the stored entity already used for this case.
    expect(result.summary).toBe("workflow_run workflow completed on luminary-dev/console");
    expect(atIndex(await listWorkflowRuns(REPO), 0).name).toBe("workflow");
  });

  it("skips a workflow run with no repository", async () => {
    const result = await deliver("workflow_run", { action: "completed", workflow_run: ghRun() });
    expect(result.summary).toBe("workflow_run without a repository, skipped");
    expect(objects.size).toBe(0);
  });

  it("records a job event without storing one object per job", async () => {
    // Job events are high volume and the failing step is fetched on demand, so
    // storing each one would fill the bucket for nothing.
    const result = await deliver("workflow_job", {
      action: "completed",
      repository: ghRepo(),
      workflow_job: { id: 12, run_id: 9001, name: "test", status: "completed" },
    });
    expect(result.summary).toBe("workflow_job test completed on luminary-dev/console");
    expect(objects.size).toBe(0);
  });

  it("records a job event with no repository", async () => {
    const result = await deliver("workflow_job", {
      action: "queued",
      workflow_job: { id: 12, run_id: 9001, name: "test", status: "queued" },
    });
    expect(result.summary).toBe("workflow_job test queued on unknown");
  });

  it("syncWorkflowRuns stores every run it read and reports the count", async () => {
    api.runs = [runEntity({ id: 1 }), runEntity({ id: 2 })];
    expect(await syncWorkflowRuns(REPO)).toBe(2);
    expect(await listWorkflowRuns(REPO)).toHaveLength(2);
  });
});

describe("repository lifecycle", () => {
  it("removes the projection when a repository is deleted", async () => {
    await putRepo(repoEntity());
    const result = await deliver("repository", { action: "deleted", repository: ghRepo() });

    expect(result.summary).toBe("repository luminary-dev/console deleted, projection removed");
    expect(await getRepo(REPO)).toBeNull();
    expect(api.repoCalls).toEqual([]);
  });

  it("drops the old projection on a rename so the list shows one repository", async () => {
    // The payload's full_name is already the NEW name; without deleting the old
    // key the repository would appear twice for good.
    await putRepo(repoEntity({ fullName: "luminary-dev/old-name", name: "old-name" }));
    api.repo = repoEntity({ fullName: "luminary-dev/console" });

    const result = await deliver("repository", {
      action: "renamed",
      repository: ghRepo(),
      changes: { repository: { name: { from: "old-name" } } },
    });

    expect(await getRepo("luminary-dev/old-name")).toBeNull();
    expect((await getRepo(REPO))?.fullName).toBe(REPO);
    expect(result.summary).toBe("repository.renamed: reconciled luminary-dev/console");
  });

  it("keeps the old projection when a rename payload omits the previous name", async () => {
    await putRepo(repoEntity({ fullName: "luminary-dev/old-name", name: "old-name" }));
    await deliver("repository", { action: "renamed", repository: ghRepo() });
    expect(await getRepo("luminary-dev/old-name")).not.toBeNull();
  });

  it("reconciles a repository on any other action", async () => {
    const result = await deliver("repository", { action: "privatized", repository: ghRepo() });
    expect(result.touched).toEqual([{ kind: "repository", id: REPO }]);
    expect(api.repoCalls).toEqual([REPO]);
    expect(await getRepo(REPO)).not.toBeNull();
  });

  it("removes a repository that has become unreadable", async () => {
    // Losing read access looks exactly like a deletion from here, and a
    // projection we can no longer refresh is worse than none.
    await putRepo(repoEntity());
    api.repo = null;

    const result = await deliver("repository", { action: "archived", repository: ghRepo() });
    expect(result.summary).toBe("repository luminary-dev/console unreadable, projection removed");
    expect(await getRepo(REPO)).toBeNull();
  });

  it("skips a repository event with no repository", async () => {
    const result = await deliver("repository", { action: "edited" });
    expect(result.summary).toBe("repository event without a repository, skipped");
  });
});

describe("push, create and delete", () => {
  const push = (overrides: Record<string, unknown> = {}) => ({
    repository: ghRepo(),
    ref: "refs/heads/main",
    before: "0".repeat(40),
    after: "1".repeat(40),
    commits: [{ id: "1".repeat(40), message: "Fix the thing" }],
    ...overrides,
  });

  it("refreshes pushedAt on the repository it already holds", async () => {
    await putRepo(repoEntity({ pushedAt: "2026-08-01T00:00:00Z" }));
    const result = await deliver("push", push());

    const stored = await getRepo(REPO);
    expect(stored?.pushedAt).not.toBe("2026-08-01T00:00:00Z");
    expect(result.summary).toBe("push 1 commit to luminary-dev/console:main");
    expect(result.touched).toEqual([{ kind: "repository", id: REPO }]);
  });

  it("does not invent a repository projection from a push alone", async () => {
    // A push tells us a repo was touched, not what it is. Writing a stub here
    // would put a half-empty repository into the list view.
    await deliver("push", push());
    expect(await getRepo(REPO)).toBeNull();
  });

  it("pluralises the commit count and names a force push", async () => {
    const result = await deliver("push", {
      ...push({ commits: [] }),
      ref: "refs/heads/feature",
      forced: true,
    });
    expect(result.summary).toBe("push 0 commits to luminary-dev/console:feature, force pushed");
  });

  it("counts a push whose payload omits the commit list", async () => {
    const payload = push();
    delete (payload as { commits?: unknown }).commits;
    const result = await deliver("push", payload);
    expect(result.summary).toBe("push 0 commits to luminary-dev/console:main");
  });

  it("skips a push with no repository", async () => {
    const payload = push();
    delete (payload as { repository?: unknown }).repository;
    const result = await deliver("push", payload);
    expect(result.summary).toBe("push without a repository, skipped");
  });

  it("records a created and a deleted ref without changing a projection", async () => {
    const created = await deliver("create", {
      repository: ghRepo(),
      ref: "v1.0.0",
      ref_type: "tag",
    });
    const deleted = await deliver("delete", {
      repository: ghRepo(),
      ref: "feature",
      ref_type: "branch",
    });

    expect(created.summary).toBe("created tag v1.0.0 on luminary-dev/console");
    expect(deleted.summary).toBe("deleted branch feature on luminary-dev/console");
    expect(objects.size).toBe(0);
  });

  it("records a ref event with no repository", async () => {
    const result = await deliver("create", { ref: "main", ref_type: "branch" });
    expect(result.summary).toBe("created branch main on unknown");
    const deleted = await deliver("delete", { ref: "feature", ref_type: "branch" });
    expect(deleted.summary).toBe("deleted branch feature on unknown");
  });
});

describe("issues and issue comments", () => {
  it("records an issue event", async () => {
    const result = await deliver("issues", {
      action: "opened",
      repository: ghRepo(),
      issue: ghIssue(),
    });
    expect(result.summary).toBe("issues.opened #42 on luminary-dev/console");
  });

  it("records an issue event with no repository", async () => {
    const result = await deliver("issues", { action: "closed", issue: ghIssue() });
    expect(result.summary).toBe("issues.closed #42 on unknown");
  });

  it("treats a comment on a pull request as a pull request event", async () => {
    // GitHub sends conversation comments on a PR as `issue_comment`, and
    // `issue.pull_request` is the only thing that distinguishes them.
    const result = await deliver("issue_comment", {
      action: "created",
      repository: ghRepo(),
      issue: ghIssue({ number: 7, pull_request: { url: "https://api.github.com/x" } }),
      comment: { id: 99, body: "LGTM" },
    });

    expect(api.prCalls).toEqual([{ repo: REPO, number: 7 }]);
    expect(result.summary).toBe("issue_comment.created: reconciled luminary-dev/console#7");
  });

  it("leaves a genuine issue comment as a log entry", async () => {
    const result = await deliver("issue_comment", {
      action: "created",
      repository: ghRepo(),
      issue: ghIssue(),
      comment: { id: 99, body: "Confirmed" },
    });

    expect(api.prCalls).toEqual([]);
    expect(result.summary).toBe("issue_comment.created on #42 of luminary-dev/console");
  });

  it("does not reconcile a pull request comment that names no repository", async () => {
    const result = await deliver("issue_comment", {
      action: "created",
      issue: ghIssue({ number: 7, pull_request: {} }),
      comment: { id: 99 },
    });
    expect(api.prCalls).toEqual([]);
    expect(result.summary).toBe("issue_comment.created on #7 of unknown");
  });
});

describe("deployments and releases", () => {
  const ghDeployment = (overrides: Record<string, unknown> = {}) => ({
    id: 3001,
    sha: "e".repeat(40),
    ref: "main",
    environment: "production",
    created_at: "2026-08-26T10:00:00Z",
    ...overrides,
  });

  it("records a new deployment as pending, because it has no status yet", async () => {
    const result = await deliver("deployment", {
      action: "created",
      repository: ghRepo(),
      deployment: ghDeployment({
        description: "Ship it",
        creator: { id: 9, login: "dhanika", avatar_url: "https://example.test/a.png" },
      }),
    });

    const stored = atIndex(await listDeployments(REPO), 0);
    expect(stored.state).toBe("pending");
    expect(stored.description).toBe("Ship it");
    expect(stored.creator).toEqual({
      id: 9,
      login: "dhanika",
      avatarUrl: "https://example.test/a.png",
    });
    expect(result.touched).toEqual([{ kind: "deployment", id: "luminary-dev/console#3001" }]);
  });

  it("omits a description and a creator that the payload does not carry", async () => {
    await deliver("deployment", { repository: ghRepo(), deployment: ghDeployment() });
    const stored = atIndex(await listDeployments(REPO), 0);
    expect(stored.description).toBeUndefined();
    expect(stored.creator).toBeUndefined();
  });

  it("skips a deployment with no repository", async () => {
    const result = await deliver("deployment", { deployment: ghDeployment() });
    expect(result.summary).toBe("deployment without a repository, skipped");
  });

  it("overwrites the pending deployment with its outcome", async () => {
    // The status event carries the same deployment id, so the state advances in
    // place instead of leaving a pending row next to a successful one.
    await deliver("deployment", { repository: ghRepo(), deployment: ghDeployment() });
    const result = await deliver("deployment_status", {
      repository: ghRepo(),
      deployment: ghDeployment(),
      deployment_status: {
        id: 77,
        state: "success",
        environment: "production-eu",
        environment_url: "https://console.example.test",
        description: "Deployed",
        created_at: "2026-08-26T10:05:00Z",
      },
    });

    const deployments = await listDeployments(REPO);
    expect(deployments).toHaveLength(1);
    const stored = atIndex(deployments, 0);
    expect(stored.state).toBe("success");
    // The status names its own environment, which wins over the deployment's.
    expect(stored.environment).toBe("production-eu");
    expect(stored.environmentUrl).toBe("https://console.example.test");
    expect(stored.updatedAt).toBe("2026-08-26T10:05:00Z");
    expect(result.summary).toBe("deployment success in production-eu on luminary-dev/console");
  });

  it("falls back to the deployment's environment when the status omits one", async () => {
    const result = await deliver("deployment_status", {
      repository: ghRepo(),
      deployment: ghDeployment({ creator: { id: 9, login: "dhanika" } }),
      deployment_status: { id: 77, state: "failure", created_at: "2026-08-26T10:05:00Z" },
    });

    const failed = atIndex(await listDeployments(REPO), 0);
    expect(failed.environment).toBe("production");
    expect(failed.creator).toEqual({ id: 9, login: "dhanika" });
    expect(failed.description).toBeUndefined();
    expect(failed.environmentUrl).toBeUndefined();
    expect(result.summary).toBe("deployment failure in production on luminary-dev/console");
  });

  it("skips a deployment status with no repository", async () => {
    const result = await deliver("deployment_status", {
      deployment: ghDeployment(),
      deployment_status: { id: 77, state: "success", created_at: "2026-08-26T10:05:00Z" },
    });
    expect(result.summary).toBe("deployment_status without a repository, skipped");
  });

  it("stores a release with its optional fields when they are present", async () => {
    const result = await deliver("release", {
      action: "published",
      repository: ghRepo(),
      release: {
        id: 4001,
        tag_name: "v1.0.0",
        name: "First cut",
        body: "Notes",
        draft: false,
        prerelease: true,
        created_at: "2026-08-26T09:00:00Z",
        published_at: "2026-08-26T10:00:00Z",
        html_url: "https://github.com/luminary-dev/console/releases/v1.0.0",
        author: { id: 9, login: "dhanika" },
      },
    });

    const stored = atIndex(await listReleases(REPO), 0);
    expect(stored.name).toBe("First cut");
    expect(stored.prerelease).toBe(true);
    expect(stored.author).toEqual({ id: 9, login: "dhanika" });
    expect(result.summary).toBe("release.published v1.0.0 on luminary-dev/console");
  });

  it("treats a release with no draft or prerelease flag as neither", async () => {
    await deliver("release", {
      action: "created",
      repository: ghRepo(),
      release: { id: 4002, tag_name: "v0.1.0", created_at: "2026-08-26T09:00:00Z" },
    });

    const stored = atIndex(await listReleases(REPO), 0);
    expect(stored.draft).toBe(false);
    expect(stored.prerelease).toBe(false);
    expect(stored.name).toBeUndefined();
    expect(stored.url).toBeUndefined();
  });

  it("skips a release with no repository", async () => {
    const result = await deliver("release", {
      action: "published",
      release: { id: 4001, tag_name: "v1.0.0", created_at: "2026-08-26T09:00:00Z" },
    });
    expect(result.summary).toBe("release without a repository, skipped");
  });
});

describe("security alerts", () => {
  it("takes a dependabot alert's title from its advisory", async () => {
    const result = await deliver("dependabot_alert", {
      action: "created",
      repository: ghRepo(),
      alert: {
        number: 5,
        state: "open",
        created_at: "2026-08-26T10:00:00Z",
        html_url: "https://github.com/luminary-dev/console/security/dependabot/5",
        security_advisory: { summary: "Prototype pollution in lodash", severity: "high" },
        dependency: { package: { name: "lodash" } },
      },
    });

    const stored = atIndex(await listAlerts(REPO), 0);
    expect(stored.title).toBe("Prototype pollution in lodash");
    expect(stored.severity).toBe("high");
    expect(result.summary).toBe("dependabot_alert.created #5 on luminary-dev/console");
  });

  it("names the package when the advisory has no summary", async () => {
    await deliver("dependabot_alert", {
      action: "created",
      repository: ghRepo(),
      alert: { number: 6, state: "open", dependency: { package: { name: "left-pad" } } },
    });
    expect(atIndex(await listAlerts(REPO), 0).title).toBe("Vulnerability in left-pad");
  });

  it("falls back to the alert number when nothing describes it", async () => {
    await deliver("dependabot_alert", {
      action: "created",
      repository: ghRepo(),
      alert: { number: 7, state: "open" },
    });
    const stored = atIndex(await listAlerts(REPO), 0);
    expect(stored.title).toBe("Dependabot alert 7");
    expect(stored.severity).toBeUndefined();
  });

  it("skips a dependabot alert with no repository", async () => {
    const result = await deliver("dependabot_alert", {
      action: "created",
      alert: { number: 5, state: "open" },
    });
    expect(result.summary).toBe("dependabot_alert without a repository, skipped");
  });

  it("takes a code scanning alert's title and severity from its rule", async () => {
    const result = await deliver("code_scanning_alert", {
      action: "appeared_in_branch",
      repository: ghRepo(),
      alert: {
        number: 11,
        state: "open",
        created_at: "2026-08-26T10:00:00Z",
        html_url: "https://github.com/luminary-dev/console/security/code-scanning/11",
        rule: { id: "js/sql-injection", severity: "error", description: "SQL injection" },
      },
    });

    const stored = atIndex(await listAlerts(REPO), 0);
    expect(stored.title).toBe("SQL injection");
    expect(stored.severity).toBe("error");
    expect(stored.createdAt).toBe("2026-08-26T10:00:00Z");
    expect(stored.url).toBe("https://github.com/luminary-dev/console/security/code-scanning/11");
    expect(result.summary).toBe("code_scanning_alert.appeared_in_branch #11 on luminary-dev/console");
  });

  it("falls back to the alert number when a code scanning rule is absent", async () => {
    await deliver("code_scanning_alert", {
      action: "created",
      repository: ghRepo(),
      alert: { number: 12, state: "open" },
    });
    expect(atIndex(await listAlerts(REPO), 0).title).toBe("Code scanning alert 12");
  });

  it("skips a code scanning alert with no repository", async () => {
    const result = await deliver("code_scanning_alert", {
      action: "created",
      alert: { number: 11, state: "open" },
    });
    expect(result.summary).toBe("code_scanning_alert without a repository, skipped");
  });

  it("always treats a leaked secret as critical", async () => {
    // These alerts carry no severity of their own, and defaulting to unknown
    // would sort a live credential below a moderate dependency warning.
    await deliver("secret_scanning_alert", {
      action: "created",
      repository: ghRepo(),
      alert: {
        number: 21,
        state: "open",
        secret_type: "aws_access_key_id",
        secret_type_display_name: "Amazon AWS Access Key ID",
      },
    });

    const stored = atIndex(await listAlerts(REPO), 0);
    expect(stored.severity).toBe("critical");
    expect(stored.title).toBe("Amazon AWS Access Key ID");
  });

  it("keeps the discovery time and the link a secret alert carries", async () => {
    await deliver("secret_scanning_alert", {
      action: "created",
      repository: ghRepo(),
      alert: {
        number: 24,
        state: "open",
        created_at: "2026-08-26T10:00:00Z",
        html_url: "https://github.com/luminary-dev/console/security/secret-scanning/24",
        secret_type: "stripe_api_key",
      },
    });

    const stored = atIndex(await listAlerts(REPO), 0);
    expect(stored.createdAt).toBe("2026-08-26T10:00:00Z");
    expect(stored.url).toBe(
      "https://github.com/luminary-dev/console/security/secret-scanning/24",
    );
  });

  it("falls back through the secret type to a generic title", async () => {
    await deliver("secret_scanning_alert", {
      action: "created",
      repository: ghRepo(),
      alert: { number: 22, state: "open", secret_type: "github_pat" },
    });
    expect(atIndex(await listAlerts(REPO), 0).title).toBe("github_pat");

    objects.clear();
    await deliver("secret_scanning_alert", {
      action: "created",
      repository: ghRepo(),
      alert: { number: 23, state: "open" },
    });
    expect(atIndex(await listAlerts(REPO), 0).title).toBe("Secret detected");
  });

  it("skips a secret scanning alert with no repository", async () => {
    const result = await deliver("secret_scanning_alert", {
      action: "created",
      alert: { number: 21, state: "open" },
    });
    expect(result.summary).toBe("secret_scanning_alert without a repository, skipped");
  });
});

describe("merge queue, installation and org events", () => {
  it("records a merge group by its head SHA", async () => {
    const result = await deliver("merge_group", {
      action: "checks_requested",
      repository: ghRepo(),
      merge_group: { head_sha: "abcdef0123456789" },
    });
    expect(result.summary).toBe(
      "merge_group.checks_requested abcdef0 on luminary-dev/console",
    );
  });

  it("calls out a suspended installation, because deliveries then stop", async () => {
    // Without this line a suspension reads as a quiet week rather than as a
    // loss of every event.
    const result = await deliver("installation", {
      action: "suspend",
      installation: {
        id: 1,
        account: { id: 2, login: "luminary-dev" },
        suspended_at: "2026-08-26T10:00:00Z",
      },
    });
    expect(result.summary).toBe("installation.suspend, SUSPENDED for luminary-dev");
  });

  it("records an unsuspended installation without the marker", async () => {
    const result = await deliver("installation", {
      action: "created",
      installation: { id: 1 },
    });
    expect(result.summary).toBe("installation.created for unknown");
  });

  it("drops a removed repository and projects an added one", async () => {
    await putRepo(repoEntity({ fullName: "luminary-dev/gone", name: "gone" }));
    api.repo = repoEntity();

    const result = await deliver("installation_repositories", {
      action: "added",
      installation: { id: 1 },
      repositories_added: [{ full_name: REPO }],
      repositories_removed: [{ full_name: "luminary-dev/gone" }],
    });

    expect(await getRepo("luminary-dev/gone")).toBeNull();
    expect(await getRepo(REPO)).not.toBeNull();
    expect(result.summary).toBe("installation_repositories.added: 1 added, 1 removed");
  });

  it("survives an added repository we cannot read yet", async () => {
    // Access can lag the event by moments. A failure here must not fail the
    // whole delivery, which also carries the removals.
    api.repoError = new GitHubError("Not Found", 404, "/repos/x");

    const result = await deliver("installation_repositories", {
      action: "added",
      installation: { id: 1 },
      repositories_added: [{ full_name: REPO }],
    });

    expect(result.summary).toBe("installation_repositories.added: 1 added, 0 removed");
    expect(await getRepo(REPO)).toBeNull();
  });

  it("reports zero on an installation_repositories event with neither list", async () => {
    const result = await deliver("installation_repositories", {
      action: "removed",
      installation: { id: 1 },
    });
    expect(result.summary).toBe("installation_repositories.removed: 0 added, 0 removed");
  });

  it("records member, membership, organization and protection events", async () => {
    expect((await deliver("member", { repository: ghRepo(), action: "added" })).summary).toBe(
      "member event on luminary-dev/console",
    );
    expect((await deliver("membership", { action: "added" })).summary).toBe(
      "membership event on the organization",
    );
    expect((await deliver("organization", { action: "member_added" })).summary).toBe(
      "organization event on the organization",
    );
    expect(
      (await deliver("branch_protection_rule", { repository: ghRepo(), action: "edited" })).summary,
    ).toBe("branch_protection_rule changed on luminary-dev/console");
    expect(objects.size).toBe(0);
  });

  it("tolerates a member payload that does not match the installation shape", async () => {
    // The handler parses permissively on purpose: it only logs, so a shape it
    // cannot read must not fail the delivery.
    const result = await deliver("member", { repository: ghRepo() });
    expect(result.summary).toBe("member event on luminary-dev/console");
  });

  it("names an unknown scope on the org-level events that carry no repository", async () => {
    // These arrive at organisation scope as well as at repository scope, and a
    // log line reading "on undefined" tells an operator nothing.
    expect((await deliver("member", { action: "added" })).summary).toBe("member event on unknown");
    expect((await deliver("branch_protection_rule", { action: "created" })).summary).toBe(
      "branch_protection_rule changed on unknown",
    );
    expect(
      (await deliver("merge_group", { action: "destroyed", merge_group: { head_sha: "abcdef0123" } }))
        .summary,
    ).toBe("merge_group.destroyed abcdef0 on unknown");
  });
});

describe("dispatch", () => {
  it("knows which events it handles", () => {
    expect(hasHandler("pull_request")).toBe(true);
    expect(hasHandler("gollum")).toBe(false);
    // A prototype key must not be mistaken for a handler.
    expect(hasHandler("toString")).toBe(false);
  });

  it("acknowledges an event it has no handler for instead of failing", async () => {
    // GitHub disables a webhook that keeps erroring, so an unknown event is
    // recorded and accepted rather than rejected.
    const result = await deliver("gollum", { repository: ghRepo() });
    expect(result.summary).toBe("No handler for gollum, acknowledged without processing");
    expect(result.touched).toBeUndefined();
  });
});
