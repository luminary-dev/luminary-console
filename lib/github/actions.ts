// Mutations against the organisation.
//
// Everything here writes to GitHub, so three rules apply to all of it:
//
//   1. Least privilege: each function documents the GitHub App permission it
//      needs, and docs/GITHUB-APP.md justifies why that permission is
//      requested at all.
//   2. Confirmation belongs to the caller, not here. The route confirms and
//      audits; this layer performs. That split keeps "what will happen" in
//      the UI where the operator reads it.
//   3. No auto-retry. The client retries idempotent verbs, and every function
//      here is a POST/PUT/PATCH/DELETE that a blind retry could duplicate (a
//      second approval, a second comment). Failures surface.
import { gh, GitHubError } from "./client";
import { fetchPullRequest } from "./api";
import { putPullRequest } from "./projection";
import type { PullRequestEntity } from "./entities";

export type ActionResult = {
  ok: boolean;
  summary: string;
  /** The refreshed projection, so the UI can update without a round trip. */
  pullRequest?: PullRequestEntity;
};

/** Re-read and re-store a PR after a mutation, so the console reflects the
 *  change immediately rather than waiting for the webhook to land. The
 *  webhook still arrives and is still processed; this is about latency, and
 *  because both paths reconcile from the API they cannot disagree. */
async function refresh(repo: string, number: number): Promise<PullRequestEntity | undefined> {
  const fresh = await fetchPullRequest(repo, number).catch(() => null);
  if (!fresh) return undefined;
  await putPullRequest(fresh);
  return fresh;
}

/** The re-read above can come back empty (the PR was deleted, or GitHub was
 *  briefly unavailable), and "no refreshed projection" is the absence of the
 *  key rather than a key holding undefined, so callers spread this instead of
 *  assigning `pullRequest` directly. */
async function refreshed(repo: string, number: number): Promise<Pick<ActionResult, "pullRequest">> {
  const fresh = await refresh(repo, number);
  return fresh ? { pullRequest: fresh } : {};
}

/** Permission: pull_requests write. Submits a review. */
export async function submitReview(
  repo: string,
  number: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string,
): Promise<ActionResult> {
  // GitHub rejects REQUEST_CHANGES and COMMENT without a body, with a 422
  // that reads as a validation error. Catching it here gives the operator a
  // sentence instead.
  if (event !== "APPROVE" && !body?.trim()) {
    return { ok: false, summary: "A comment is required when requesting changes." };
  }
  await gh(`/repos/${repo}/pulls/${number}/reviews`, {
    method: "POST",
    body: { event, ...(body?.trim() ? { body: body.trim() } : {}) },
  });
  const verb =
    event === "APPROVE" ? "Approved" : event === "REQUEST_CHANGES" ? "Requested changes on" : "Commented on";
  return {
    ok: true,
    summary: `${verb} ${repo}#${number}`,
    ...(await refreshed(repo, number)),
  };
}

/** Permission: issues write (PR conversation comments use the issues API). */
export async function commentOnPullRequest(
  repo: string,
  number: number,
  body: string,
): Promise<ActionResult> {
  if (!body.trim()) return { ok: false, summary: "The comment is empty." };
  await gh(`/repos/${repo}/issues/${number}/comments`, {
    method: "POST",
    body: { body: body.trim() },
  });
  return { ok: true, summary: `Commented on ${repo}#${number}` };
}

/** Permission: pull_requests write. */
export async function requestReview(
  repo: string,
  number: number,
  reviewers: string[],
): Promise<ActionResult> {
  if (!reviewers.length) return { ok: false, summary: "No reviewers given." };
  await gh(`/repos/${repo}/pulls/${number}/requested_reviewers`, {
    method: "POST",
    body: { reviewers },
  });
  return {
    ok: true,
    summary: `Requested review from ${reviewers.join(", ")} on ${repo}#${number}`,
    ...(await refreshed(repo, number)),
  };
}

/** Permission: issues write. */
export async function setLabels(
  repo: string,
  number: number,
  labels: string[],
): Promise<ActionResult> {
  await gh(`/repos/${repo}/issues/${number}/labels`, {
    method: "PUT",
    body: { labels },
  });
  return {
    ok: true,
    summary: `Set labels on ${repo}#${number}`,
    ...(await refreshed(repo, number)),
  };
}

/** Permission: pull_requests write. Draft state is a PR property. */
export async function setDraft(
  repo: string,
  number: number,
  draft: boolean,
): Promise<ActionResult> {
  // Converting to and from draft is a GraphQL-only mutation; REST cannot
  // change `draft` after creation. This is one of the few places the
  // transport is dictated by the API rather than by our preference.
  const pr = await fetchPullRequest(repo, number);
  if (!pr?.nodeId) {
    return { ok: false, summary: "Could not resolve the pull request node id." };
  }
  const mutation = draft
    ? `mutation($id: ID!) { convertPullRequestToDraft(input: {pullRequestId: $id}) { pullRequest { isDraft } } }`
    : `mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }`;
  const { ghGraphQL } = await import("./client");
  await ghGraphQL(mutation, { id: pr.nodeId });
  return {
    ok: true,
    summary: `${draft ? "Converted to draft" : "Marked ready for review"}: ${repo}#${number}`,
    ...(await refreshed(repo, number)),
  };
}

/** Permission: contents write. Brings the head up to date with its base. */
export async function updateBranch(repo: string, number: number): Promise<ActionResult> {
  try {
    await gh(`/repos/${repo}/pulls/${number}/update-branch`, {
      method: "PUT",
      body: {},
    });
    return {
      ok: true,
      summary: `Updating ${repo}#${number} from its base branch`,
      ...(await refreshed(repo, number)),
    };
  } catch (e) {
    // 422 here means the branch is already current, which is a success from
    // the operator's point of view, not a failure.
    if (e instanceof GitHubError && e.status === 422) {
      return { ok: true, summary: `${repo}#${number} is already up to date` };
    }
    throw e;
  }
}

/** Permission: actions write. Re-runs only the failed jobs, which is what an
 *  operator almost always wants after a flake. */
export async function rerunFailedJobs(repo: string, runId: number): Promise<ActionResult> {
  await gh(`/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`, {
    method: "POST",
    body: {},
  });
  return { ok: true, summary: `Re-running failed jobs for run ${runId} in ${repo}` };
}

export type MergeMethod = "merge" | "squash" | "rebase";

/**
 * Permission: pull_requests write. The one genuinely irreversible action here.
 *
 * `expectedHeadSha` is not optional by accident. Between the operator reading
 * the merge verdict and clicking merge, someone can push to the branch; merging
 * then ships code nobody reviewed. Passing the SHA the operator was looking at
 * makes GitHub refuse the merge if the head moved. That is the whole point of
 * the parameter and it must never be dropped to "make merge work".
 */
export async function mergePullRequest(
  repo: string,
  number: number,
  opts: {
    method: MergeMethod;
    expectedHeadSha: string;
    title?: string;
    message?: string;
  },
): Promise<ActionResult> {
  if (!opts.expectedHeadSha) {
    return {
      ok: false,
      summary: "Refusing to merge without the head SHA the operator reviewed.",
    };
  }
  try {
    await gh(`/repos/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      body: {
        merge_method: opts.method,
        sha: opts.expectedHeadSha,
        ...(opts.title ? { commit_title: opts.title } : {}),
        ...(opts.message ? { commit_message: opts.message } : {}),
      },
    });
    return {
      ok: true,
      summary: `Merged ${repo}#${number} with ${opts.method}`,
      ...(await refreshed(repo, number)),
    };
  } catch (e) {
    if (e instanceof GitHubError) {
      // 409 is the SHA guard doing its job: the branch moved under us.
      if (e.status === 409) {
        return {
          ok: false,
          summary:
            "The branch changed since you loaded this page, so the merge was refused. Reload and review the new commits.",
        };
      }
      // 405 means branch protection or an unmet requirement refused it.
      if (e.status === 405) {
        return { ok: false, summary: `GitHub refused the merge: ${e.message}` };
      }
    }
    throw e;
  }
}

/** Permission: pull_requests write. Closing is reversible (reopen), which is
 *  why it is not gated as hard as merge, but it still gets a confirmation in
 *  the UI. */
export async function closePullRequest(repo: string, number: number): Promise<ActionResult> {
  await gh(`/repos/${repo}/pulls/${number}`, {
    method: "PATCH",
    body: { state: "closed" },
  });
  return {
    ok: true,
    summary: `Closed ${repo}#${number}`,
    ...(await refreshed(repo, number)),
  };
}

export async function reopenPullRequest(repo: string, number: number): Promise<ActionResult> {
  await gh(`/repos/${repo}/pulls/${number}`, {
    method: "PATCH",
    body: { state: "open" },
  });
  return {
    ok: true,
    summary: `Reopened ${repo}#${number}`,
    ...(await refreshed(repo, number)),
  };
}

export type BatchTarget = { repo: string; number: number };
export type BatchOutcome = {
  target: BatchTarget;
  ok: boolean;
  summary: string;
};

/**
 * Run one action across several pull requests.
 *
 * The mandate is explicit that a batch must report per-item results rather
 * than a single "done", because a batch where three of eight failed is a
 * completely different situation from one that succeeded. So this never
 * throws on an individual failure: it records it and carries on, and the
 * caller renders every line.
 *
 * Sequential, not parallel: a burst of mutations is the fastest way to trip
 * GitHub's secondary rate limit.
 */
export async function runBatch(
  targets: BatchTarget[],
  action: (target: BatchTarget) => Promise<ActionResult>,
): Promise<BatchOutcome[]> {
  const outcomes: BatchOutcome[] = [];
  for (const target of targets) {
    try {
      const result = await action(target);
      outcomes.push({ target, ok: result.ok, summary: result.summary });
    } catch (e) {
      outcomes.push({
        target,
        ok: false,
        summary: e instanceof Error ? e.message : "Failed.",
      });
    }
  }
  return outcomes;
}
