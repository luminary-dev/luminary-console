// Mutations against GitHub.
//
// Everything in lib/github/actions.ts writes to a real organisation, so these
// tests care about exactly three things: the request that goes out (method,
// path, body), what happens when GitHub refuses, and whether a refusal
// reaches the operator as a sentence rather than as a stack trace.
//
// The single most important property is the merge guard: mergePullRequest
// must send the head SHA the operator was looking at, so that a push landing
// between page load and click makes GitHub refuse the merge instead of
// shipping unreviewed code.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ——— in-memory store ———
// The actions refresh their projection after a successful mutation, and that
// write goes through lib/store. Mocking at the store boundary keeps the
// refresh path real without touching R2.
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

// ——— transport ———
// Mocked at the client boundary rather than at fetch, so every layer above it
// (the action, the entity projection, the store write) is the real code.
// GitHubError is kept from the real module: the actions branch on `instanceof`
// and on `.status`, and a hand-rolled stand-in would not exercise that.
const transport = vi.hoisted(() => ({
  gh: vi.fn(),
  ghData: vi.fn(),
  ghPaginate: vi.fn(),
  ghGraphQL: vi.fn(),
}));

vi.mock("@/lib/github/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/client")>(
    "@/lib/github/client",
  );
  return {
    ...actual,
    gh: transport.gh,
    ghData: transport.ghData,
    ghPaginate: transport.ghPaginate,
    ghGraphQL: transport.ghGraphQL,
  };
});

import { GitHubError } from "@/lib/github/client";
import {
  closePullRequest,
  commentOnPullRequest,
  mergePullRequest,
  reopenPullRequest,
  requestReview,
  rerunFailedJobs,
  runBatch,
  setDraft,
  setLabels,
  submitReview,
  updateBranch,
  type ActionResult,
} from "@/lib/github/actions";
import { atIndex } from "./helpers";

const REPO = "luminary-dev/console";
const NUMBER = 7;
const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PR_KEY = "github/prs/luminary-dev_console/7.json";

/** The single-PR REST payload the refresh re-reads after every mutation. */
function pullRequestPayload() {
  return {
    id: 9001,
    node_id: "PR_kwDOexample7",
    number: NUMBER,
    state: "open",
    title: "Harden the merge guard",
    draft: false,
    created_at: "2026-08-20T09:00:00Z",
    updated_at: "2026-08-26T09:30:00Z",
    html_url: `https://github.com/${REPO}/pull/${NUMBER}`,
    mergeable: true,
    user: { id: 11, login: "dhanika" },
    head: {
      ref: "feat/merge-guard",
      sha: HEAD_SHA,
      repo: { id: 1, name: "console", full_name: REPO },
    },
    base: {
      ref: "main",
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      repo: { id: 1, name: "console", full_name: REPO },
    },
  };
}

type Recorded = { path: string; method: string; body: unknown };
type Failure = { method: string; path: string; status: number; message: string };

const ghCalls: Recorded[] = [];
const graphqlCalls: { query: string; variables: Record<string, unknown> }[] = [];
const failures: Failure[] = [];
const state = { pullRequestMissing: false };

/** Queue a GitHub refusal for the next request matching this method and this
 *  fragment of the path. Method is part of the match because a PR is read and
 *  written at the very same path, and only the verb tells them apart. */
function refuse(method: string, path: string, status: number, message: string): void {
  failures.push({ method, path, status, message });
}

function failureFor(method: string, path: string): Failure | undefined {
  const index = failures.findIndex((f) => f.method === method && path.includes(f.path));
  if (index === -1) return undefined;
  return failures.splice(index, 1)[0];
}

beforeEach(() => {
  objects.clear();
  ghCalls.length = 0;
  graphqlCalls.length = 0;
  failures.length = 0;
  state.pullRequestMissing = false;

  transport.gh.mockReset();
  transport.ghData.mockReset();
  transport.ghPaginate.mockReset();
  transport.ghGraphQL.mockReset();

  transport.gh.mockImplementation(
    async (path: string, opts: { method?: string; body?: unknown } = {}) => {
      const method = (opts.method ?? "GET").toUpperCase();
      ghCalls.push({ path, method, body: opts.body });
      const failure = failureFor(method, path);
      if (failure) throw new GitHubError(failure.message, failure.status, path);
      return { data: {}, status: 200, headers: new Headers(), fromCache: false };
    },
  );

  // The refresh reads the PR, its checks and its comparison. Only the PR read
  // needs a real shape; the other two exist so the parallel reads resolve.
  transport.ghData.mockImplementation(async (path: string) => {
    const failure = failureFor("GET", path);
    if (failure) throw new GitHubError(failure.message, failure.status, path);
    if (/\/pulls\/\d+$/.test(path)) {
      if (state.pullRequestMissing) throw new GitHubError("Not Found", 404, path);
      return pullRequestPayload();
    }
    if (path.includes("/check-runs")) return { check_runs: [] };
    if (path.includes("/compare/")) return { behind_by: 0, ahead_by: 3 };
    throw new Error(`the test transport has no route for ${path}`);
  });

  transport.ghPaginate.mockImplementation(async () => []);
  transport.ghGraphQL.mockImplementation(
    async (query: string, variables: Record<string, unknown>) => {
      graphqlCalls.push({ query, variables });
      return {};
    },
  );
});

/** Every write the actions made, so a test can assert that nothing was sent. */
const mutations = (): Recorded[] => ghCalls.filter((c) => c.method !== "GET");

const mutation = (index: number): Recorded => atIndex(mutations(), index);

describe("merging: the head SHA guard", () => {
  it("sends the reviewed head SHA with the merge", async () => {
    // The whole reason expectedHeadSha exists. If this body ever stops
    // carrying `sha`, GitHub will happily merge whatever landed after the
    // operator read the page.
    const result = await mergePullRequest(REPO, NUMBER, {
      method: "squash",
      expectedHeadSha: HEAD_SHA,
    });

    expect(result.ok).toBe(true);
    const sent = mutation(0);
    expect(sent.method).toBe("PUT");
    expect(sent.path).toBe(`/repos/${REPO}/pulls/${NUMBER}/merge`);
    expect(sent.body).toEqual({ merge_method: "squash", sha: HEAD_SHA });
  });

  it("refuses to merge at all when no head SHA is given", async () => {
    // An empty SHA must not degrade into an unguarded merge: the request has
    // to not happen.
    const result = await mergePullRequest(REPO, NUMBER, {
      method: "merge",
      expectedHeadSha: "",
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("Refusing to merge without the head SHA the operator reviewed.");
    expect(mutations()).toHaveLength(0);
    expect(result.pullRequest).toBeUndefined();
  });

  it("turns GitHub's 409 on a stale SHA into an instruction, not an exception", async () => {
    // 409 is the guard firing on GitHub's side: the branch moved. The operator
    // needs to be told to reload and re-read the new commits.
    refuse("PUT", "/merge", 409, "Head branch was modified. Review and try the merge again.");

    const stale = "0000000000000000000000000000000000000000";
    const result = await mergePullRequest(REPO, NUMBER, {
      method: "merge",
      expectedHeadSha: stale,
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("The branch changed since you loaded this page");
    expect(result.pullRequest).toBeUndefined();
    // The stale SHA still had to be sent, otherwise GitHub could not have
    // refused: the refusal is the proof the guard was armed.
    expect(mutation(0).body).toMatchObject({ sha: stale });
  });

  it("reports a branch protection refusal in GitHub's own words", async () => {
    refuse("PUT", "/merge", 405, "At least 2 approving reviews are required.");

    const result = await mergePullRequest(REPO, NUMBER, {
      method: "merge",
      expectedHeadSha: HEAD_SHA,
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toBe(
      "GitHub refused the merge: At least 2 approving reviews are required.",
    );
  });

  it("does not swallow a permissions failure", async () => {
    // 403 is not a merge verdict, it is a broken installation. Reporting it as
    // "not merged" would hide a configuration problem behind a normal-looking
    // refusal.
    refuse("PUT", "/merge", 403, "Resource not accessible by integration");

    await expect(
      mergePullRequest(REPO, NUMBER, { method: "merge", expectedHeadSha: HEAD_SHA }),
    ).rejects.toBeInstanceOf(GitHubError);
  });

  it("does not mistake a transport failure for a merge verdict", async () => {
    // Only a GitHubError carries a status worth interpreting. A socket that
    // died mid-request tells us nothing about whether the merge happened, so
    // it must propagate rather than be reported as "not merged".
    transport.gh.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      mergePullRequest(REPO, NUMBER, { method: "merge", expectedHeadSha: HEAD_SHA }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("sends a commit title and message only when they were given", async () => {
    await mergePullRequest(REPO, NUMBER, {
      method: "squash",
      expectedHeadSha: HEAD_SHA,
      title: "Harden the merge guard (#7)",
      message: "Reviewed by dhanika.",
    });
    expect(mutation(0).body).toEqual({
      merge_method: "squash",
      sha: HEAD_SHA,
      commit_title: "Harden the merge guard (#7)",
      commit_message: "Reviewed by dhanika.",
    });

    await mergePullRequest(REPO, NUMBER, {
      method: "rebase",
      expectedHeadSha: HEAD_SHA,
      title: "",
    });
    expect(mutation(1).body).toEqual({ merge_method: "rebase", sha: HEAD_SHA });
  });

  it("stores the refreshed projection so the console does not wait on the webhook", async () => {
    const result = await mergePullRequest(REPO, NUMBER, {
      method: "merge",
      expectedHeadSha: HEAD_SHA,
    });

    expect(result.summary).toBe(`Merged ${REPO}#${NUMBER} with merge`);
    expect(result.pullRequest?.number).toBe(NUMBER);
    expect(result.pullRequest?.headSha).toBe(HEAD_SHA);
    expect(objects.get(PR_KEY)).toMatchObject({ repo: REPO, number: NUMBER });
  });

  it("keeps a successful merge successful when the refresh read fails", async () => {
    // The merge already happened. A failed re-read is a latency problem, not a
    // merge problem, and reporting it as a failed merge would invite the
    // operator to press merge a second time.
    refuse("GET", `/pulls/${NUMBER}`, 500, "Server Error");

    const result = await mergePullRequest(REPO, NUMBER, {
      method: "merge",
      expectedHeadSha: HEAD_SHA,
    });

    expect(result.ok).toBe(true);
    expect("pullRequest" in result).toBe(false);
  });

  it("omits the projection entirely when the re-read comes back empty", async () => {
    // The source spreads `refreshed()` precisely so that a failed re-read
    // leaves the key absent rather than present-and-undefined.
    state.pullRequestMissing = true;
    const result: ActionResult = await mergePullRequest(REPO, NUMBER, {
      method: "merge",
      expectedHeadSha: HEAD_SHA,
    });

    expect(result.ok).toBe(true);
    expect("pullRequest" in result).toBe(false);
    expect(objects.has(PR_KEY)).toBe(false);
  });
});

describe("reviews", () => {
  it("approves without inventing a body", async () => {
    const result = await submitReview(REPO, NUMBER, "APPROVE");

    expect(result.ok).toBe(true);
    expect(result.summary).toBe(`Approved ${REPO}#${NUMBER}`);
    expect(mutation(0)).toMatchObject({
      method: "POST",
      path: `/repos/${REPO}/pulls/${NUMBER}/reviews`,
      body: { event: "APPROVE" },
    });
  });

  it("refuses to request changes with no comment, before calling GitHub", async () => {
    // GitHub answers 422 here. Catching it locally gives the operator a
    // sentence instead of a validation error, and costs no rate budget.
    const result = await submitReview(REPO, NUMBER, "REQUEST_CHANGES", "   ");

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("A comment is required when requesting changes.");
    expect(mutations()).toHaveLength(0);
  });

  it("trims the review body it sends", async () => {
    const result = await submitReview(REPO, NUMBER, "COMMENT", "  Please rebase.  ");

    expect(result.summary).toBe(`Commented on ${REPO}#${NUMBER}`);
    expect(mutation(0).body).toEqual({ event: "COMMENT", body: "Please rebase." });
  });

  it("names the action in the summary for a change request", async () => {
    const result = await submitReview(REPO, NUMBER, "REQUEST_CHANGES", "Needs tests.");
    expect(result.summary).toBe(`Requested changes on ${REPO}#${NUMBER}`);
  });

  it("surfaces a 403 as a readable GitHubError rather than something opaque", async () => {
    refuse("POST", "/reviews", 403, "Resource not accessible by integration");

    await expect(submitReview(REPO, NUMBER, "APPROVE")).rejects.toThrow(
      "Resource not accessible by integration",
    );
  });

  it("does not retry a review that GitHub rejected", async () => {
    // A blind retry of a POST is a second review. The client only auto-retries
    // idempotent verbs, and the action layer adds no retry of its own.
    refuse("POST", "/reviews", 422, "Validation Failed");
    await expect(submitReview(REPO, NUMBER, "APPROVE")).rejects.toBeInstanceOf(GitHubError);
    expect(mutations()).toHaveLength(1);
  });
});

describe("comments, reviewers and labels", () => {
  it("posts a PR comment through the issues API", async () => {
    const result = await commentOnPullRequest(REPO, NUMBER, "  Looks good.  ");

    expect(result.ok).toBe(true);
    expect(mutation(0)).toMatchObject({
      method: "POST",
      path: `/repos/${REPO}/issues/${NUMBER}/comments`,
      body: { body: "Looks good." },
    });
    // Commenting changes nothing the projection renders, so it does not pay
    // for a re-read.
    expect("pullRequest" in result).toBe(false);
  });

  it("rejects an empty comment without calling GitHub", async () => {
    const result = await commentOnPullRequest(REPO, NUMBER, "\n\t ");
    expect(result).toEqual({ ok: false, summary: "The comment is empty." });
    expect(mutations()).toHaveLength(0);
  });

  it("reports a 404 on a comment as an error the operator can act on", async () => {
    refuse("POST", "/comments", 404, "Not Found");
    await expect(commentOnPullRequest(REPO, NUMBER, "Hello")).rejects.toMatchObject({
      name: "GitHubError",
      status: 404,
      message: "Not Found",
    });
  });

  it("requests review from the named logins", async () => {
    const result = await requestReview(REPO, NUMBER, ["gaveen", "shashmitha"]);

    expect(result.summary).toBe(`Requested review from gaveen, shashmitha on ${REPO}#${NUMBER}`);
    expect(mutation(0)).toMatchObject({
      method: "POST",
      path: `/repos/${REPO}/pulls/${NUMBER}/requested_reviewers`,
      body: { reviewers: ["gaveen", "shashmitha"] },
    });
  });

  it("refuses an empty reviewer list", async () => {
    const result = await requestReview(REPO, NUMBER, []);
    expect(result).toEqual({ ok: false, summary: "No reviewers given." });
    expect(mutations()).toHaveLength(0);
  });

  it("replaces labels with PUT, which is the endpoint that sets rather than adds", async () => {
    const result = await setLabels(REPO, NUMBER, ["urgent", "backend"]);

    expect(result.ok).toBe(true);
    expect(mutation(0)).toMatchObject({
      method: "PUT",
      path: `/repos/${REPO}/issues/${NUMBER}/labels`,
      body: { labels: ["urgent", "backend"] },
    });
    expect(result.pullRequest?.repo).toBe(REPO);
  });

  it("treats clearing every label as a real instruction, not as a no-op", async () => {
    await setLabels(REPO, NUMBER, []);
    expect(mutation(0).body).toEqual({ labels: [] });
  });
});

describe("draft state", () => {
  it("converts to draft with the GraphQL mutation, because REST cannot", async () => {
    const result = await setDraft(REPO, NUMBER, true);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe(`Converted to draft: ${REPO}#${NUMBER}`);
    const call = atIndex(graphqlCalls, 0);
    expect(call.query).toContain("convertPullRequestToDraft");
    expect(call.variables).toEqual({ id: "PR_kwDOexample7" });
    // The node id has to come from a read; there is no REST mutation to fall
    // back to, so no REST write should have been attempted.
    expect(mutations()).toHaveLength(0);
  });

  it("marks ready for review with the opposite mutation", async () => {
    const result = await setDraft(REPO, NUMBER, false);

    expect(result.summary).toBe(`Marked ready for review: ${REPO}#${NUMBER}`);
    expect(atIndex(graphqlCalls, 0).query).toContain("markPullRequestReadyForReview");
  });

  it("gives up cleanly when the node id cannot be resolved", async () => {
    // Without a node id the GraphQL mutation cannot be addressed at all, and
    // sending it anyway would fail with a GraphQL error nobody can read.
    state.pullRequestMissing = true;
    const result = await setDraft(REPO, NUMBER, true);

    expect(result).toEqual({
      ok: false,
      summary: "Could not resolve the pull request node id.",
    });
    expect(graphqlCalls).toHaveLength(0);
  });
});

describe("branch updates and re-runs", () => {
  it("updates the branch from its base", async () => {
    const result = await updateBranch(REPO, NUMBER);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe(`Updating ${REPO}#${NUMBER} from its base branch`);
    expect(mutation(0)).toMatchObject({
      method: "PUT",
      path: `/repos/${REPO}/pulls/${NUMBER}/update-branch`,
      body: {},
    });
  });

  it("reads a 422 as already up to date, which is a success to the operator", async () => {
    // "Nothing to do" is the outcome the operator wanted, so showing it as a
    // failure would send them looking for a problem that does not exist.
    refuse("PUT", "/update-branch", 422, "merge conflict between base and head");

    const result = await updateBranch(REPO, NUMBER);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(`${REPO}#${NUMBER} is already up to date`);
    // No re-read: there is nothing new to project.
    expect("pullRequest" in result).toBe(false);
  });

  it("still raises a 403 on update-branch", async () => {
    refuse("PUT", "/update-branch", 403, "Resource not accessible by integration");
    await expect(updateBranch(REPO, NUMBER)).rejects.toMatchObject({ status: 403 });
  });

  it("re-runs only the failed jobs of a workflow run", async () => {
    const result = await rerunFailedJobs(REPO, 12345);

    expect(result).toEqual({
      ok: true,
      summary: `Re-running failed jobs for run 12345 in ${REPO}`,
    });
    expect(mutation(0)).toMatchObject({
      method: "POST",
      path: `/repos/${REPO}/actions/runs/12345/rerun-failed-jobs`,
      body: {},
    });
  });

  it("propagates a 404 from a run that no longer exists", async () => {
    refuse("POST", "/rerun-failed-jobs", 404, "Not Found");
    await expect(rerunFailedJobs(REPO, 12345)).rejects.toMatchObject({ status: 404 });
  });
});

describe("closing and reopening", () => {
  it("closes with a PATCH on the pull request itself", async () => {
    const result = await closePullRequest(REPO, NUMBER);

    expect(result.summary).toBe(`Closed ${REPO}#${NUMBER}`);
    expect(mutation(0)).toEqual({
      method: "PATCH",
      path: `/repos/${REPO}/pulls/${NUMBER}`,
      body: { state: "closed" },
    });
    expect(result.pullRequest?.number).toBe(NUMBER);
  });

  it("reopens with the same endpoint and the opposite state", async () => {
    const result = await reopenPullRequest(REPO, NUMBER);

    expect(result.summary).toBe(`Reopened ${REPO}#${NUMBER}`);
    expect(mutation(0).body).toEqual({ state: "open" });
  });

  it("raises a 422 from reopening a PR whose branch is gone", async () => {
    refuse("PATCH", `/pulls/${NUMBER}`, 422, "Validation Failed");
    await expect(reopenPullRequest(REPO, NUMBER)).rejects.toMatchObject({ status: 422 });
  });
});

describe("batches", () => {
  it("reports one outcome per target rather than a single verdict", async () => {
    const outcomes = await runBatch(
      [
        { repo: REPO, number: 1 },
        { repo: REPO, number: 2 },
      ],
      async (target) => ({ ok: true, summary: `did ${target.repo}#${target.number}` }),
    );

    expect(outcomes).toEqual([
      { target: { repo: REPO, number: 1 }, ok: true, summary: `did ${REPO}#1` },
      { target: { repo: REPO, number: 2 }, ok: true, summary: `did ${REPO}#2` },
    ]);
  });

  it("carries on past a thrown failure and records its message", async () => {
    // A batch where three of eight failed is a different situation from one
    // that succeeded, so a mid-batch throw must not abandon the rest.
    const seen: number[] = [];
    const outcomes = await runBatch(
      [
        { repo: REPO, number: 1 },
        { repo: REPO, number: 2 },
        { repo: REPO, number: 3 },
      ],
      async (target) => {
        seen.push(target.number);
        if (target.number === 2) throw new GitHubError("Not Found", 404, "/x");
        return { ok: true, summary: `merged #${target.number}` };
      },
    );

    expect(seen).toEqual([1, 2, 3]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    expect(atIndex(outcomes, 1).summary).toBe("Not Found");
  });

  it("describes a non-Error rejection rather than rendering undefined", async () => {
    const outcomes = await runBatch([{ repo: REPO, number: 1 }], async () => {
      throw "a string, thrown from somewhere careless";
    });
    expect(atIndex(outcomes, 0)).toEqual({
      target: { repo: REPO, number: 1 },
      ok: false,
      summary: "Failed.",
    });
  });

  it("runs sequentially, because a burst of mutations trips the secondary limit", async () => {
    const order: string[] = [];
    await runBatch(
      [
        { repo: REPO, number: 1 },
        { repo: REPO, number: 2 },
      ],
      async (target) => {
        order.push(`start ${target.number}`);
        await new Promise((r) => setTimeout(r, 1));
        order.push(`end ${target.number}`);
        return { ok: true, summary: "" };
      },
    );

    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("keeps a false result from the action as a failure, not as a throw", async () => {
    const outcomes = await runBatch([{ repo: REPO, number: 4 }], async () => ({
      ok: false,
      summary: "A comment is required when requesting changes.",
    }));
    expect(atIndex(outcomes, 0).ok).toBe(false);
    expect(atIndex(outcomes, 0).summary).toBe("A comment is required when requesting changes.");
  });
});
