// Typed reads against the GitHub API, on top of the hardened client.
//
// This is where the REST vs GraphQL decision is made per call, and the
// reasoning is recorded next to each one, as the mandate requires.
import { gh, ghData, ghGraphQL, ghPaginate, parseNextLink, GitHubError } from "./client";
import type { GitHubResponse } from "./client";
import { logger } from "@/lib/logger";
import { githubOrg } from "./config";
import {
  GhCheckRun,
  GhPullRequest,
  GhRepo,
  GhReview,
  GhWorkflowRun,
} from "./schema";
import {
  toActor,
  toCheckSummary,
  toPullRequestEntity,
  toWorkflowRunEntity,
  type PullRequestEntity,
  type RepoEntity,
  type ReviewState,
  type ReviewSummary,
  type WorkflowRunEntity,
} from "./entities";

/** REST: a single repository read, where REST's 404 is exactly the signal we
 *  want when a repo has been renamed, transferred or deleted. */
export async function fetchRepo(fullName: string): Promise<RepoEntity | null> {
  try {
    const raw = await ghData<unknown>(`/repos/${fullName}`);
    const parsed = GhRepo.safeParse(raw);
    if (!parsed.success) return null;
    return toRepoEntity(parsed.data);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

// Takes the validated payload type rather than a hand-written copy of it: a
// duplicate shape drifts from the schema, and the schema is what the parse
// actually guarantees.
export function toRepoEntity(repo: GhRepo): RepoEntity {
  const pushedAt =
    typeof repo.pushed_at === "number"
      ? new Date(repo.pushed_at * 1000).toISOString()
      : (repo.pushed_at ?? undefined);
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private === true,
    archived: repo.archived === true,
    defaultBranch: repo.default_branch ?? "main",
    ...(repo.description ? { description: repo.description } : {}),
    ...(repo.language ? { language: repo.language } : {}),
    ...(repo.license?.spdx_id ? { license: repo.license.spdx_id } : {}),
    ...(repo.open_issues_count !== undefined ? { openIssues: repo.open_issues_count } : {}),
    ...(pushedAt ? { pushedAt } : {}),
    url: repo.html_url ?? `https://github.com/${repo.full_name}`,
    syncedAt: new Date().toISOString(),
  };
}

/** REST + pagination: every repository in the org. Paginated properly via the
 *  Link header, so an org that grows past one page does not silently truncate. */
export async function fetchOrgRepos(): Promise<RepoEntity[]> {
  const raw = await ghPaginate<unknown>(
    `/orgs/${githubOrg()}/repos?per_page=100&sort=pushed`,
    { max: 500 },
  );
  return raw
    .map((r) => GhRepo.safeParse(r))
    .filter((r): r is { success: true; data: import("zod").infer<typeof GhRepo> } => r.success)
    .map((r) => toRepoEntity(r.data));
}

/** REST: one pull request, with the fields only the single-PR endpoint
 *  returns (mergeable, changed_files, additions/deletions). The list endpoint
 *  omits those, which is why merge readiness cannot be derived from a list
 *  response alone. */
export async function fetchPullRequest(
  repo: string,
  number: number,
): Promise<PullRequestEntity | null> {
  try {
    const raw = await ghData<unknown>(`/repos/${repo}/pulls/${number}`);
    const parsed = GhPullRequest.safeParse(raw);
    if (!parsed.success) return null;

    // These three reads are independent, so they go in parallel rather than
    // serially: this path runs on every reconcile and the latency adds up.
    const [reviews, checks, comparison] = await Promise.all([
      fetchReviews(repo, number).catch(() => []),
      fetchChecks(repo, parsed.data.head.sha).catch(() => []),
      fetchComparison(repo, parsed.data.base.ref, parsed.data.head.sha).catch(() => null),
    ]);

    return toPullRequestEntity(repo, parsed.data, {
      reviews,
      checks,
      ...(comparison ? { behindBy: comparison.behindBy } : {}),
    });
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

/** REST: reviews on a PR. Dismissed reviews are kept, flagged, because they
 *  belong in the timeline even though they no longer gate the merge. */
export async function fetchReviews(repo: string, number: number): Promise<ReviewSummary[]> {
  const raw = await ghPaginate<unknown>(
    `/repos/${repo}/pulls/${number}/reviews?per_page=100`,
    { max: 200 },
  );
  const reviews: ReviewSummary[] = [];
  for (const item of raw) {
    const parsed = GhReview.safeParse(item);
    if (!parsed.success) continue;
    const state = parsed.data.state.toUpperCase() as ReviewState;
    const author = toActor(parsed.data.user);
    reviews.push({
      id: parsed.data.id,
      state,
      dismissed: state === "DISMISSED",
      ...(author ? { author } : {}),
      ...(parsed.data.submitted_at ? { submittedAt: parsed.data.submitted_at } : {}),
    });
  }
  return reviews;
}

/**
 * REST: check runs for a commit. A ref with no checks is a legitimate empty
 * result, not an error.
 *
 * This paginates. It used to request one page of 100 and stop, which silently
 * dropped every check beyond the hundredth on a commit with a large matrix
 * build. That is not a cosmetic loss: `mergeReadiness` decides whether a pull
 * request is safe to merge from this list, so a dropped FAILING check made a
 * blocked pull request report as ready. Losing checks has to be impossible
 * here, not unlikely.
 *
 * `ghPaginate` cannot be used as-is because this endpoint returns an object
 * with a `check_runs` array rather than a bare array, so the Link header is
 * followed by hand, exactly as ghPaginate does: `rel="next"` only, never a
 * synthesised page number.
 */
export async function fetchChecks(repo: string, sha: string, maxPages = 20) {
  const runs: unknown[] = [];
  let path: string | null = `/repos/${repo}/commits/${sha}/check-runs?per_page=100`;

  for (let page = 0; path && page < maxPages; page++) {
    const res: GitHubResponse<{ check_runs?: unknown[] }> = await gh<{ check_runs?: unknown[] }>(path);
    runs.push(...(res.data.check_runs ?? []));
    path = parseNextLink(res.headers.get("link"));
  }

  // Leaving the loop with a next link still in hand means the ceiling bit and
  // checks were dropped after all, which is the very failure this function was
  // fixed to prevent, just at a higher number. It must not happen quietly.
  if (path) {
    logger.warn("github.checks.page_ceiling_reached", { repo, sha, pages: maxPages });
  }

  return runs
    .map((r) => GhCheckRun.safeParse(r))
    .filter((r): r is { success: true; data: import("zod").infer<typeof GhCheckRun> } => r.success)
    .map((r) => toCheckSummary(r.data));
}

/** REST: how far the head is behind its base. `behind_by` is the count of
 *  commits the base has that the head does not, which is the "branch is
 *  behind" signal in merge readiness. */
export async function fetchComparison(
  repo: string,
  base: string,
  head: string,
): Promise<{ behindBy: number; aheadBy: number } | null> {
  try {
    const res = await ghData<{ behind_by?: number; ahead_by?: number }>(
      `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );
    return { behindBy: res.behind_by ?? 0, aheadBy: res.ahead_by ?? 0 };
  } catch (e) {
    // A force-pushed or deleted head SHA 404s here. That is expected, not a
    // fault: it means our cached SHA is stale and a reconcile will refresh it.
    if (e instanceof GitHubError && (e.status === 404 || e.status === 422)) return null;
    throw e;
  }
}

/**
 * GraphQL: the org-wide PR inbox.
 *
 * This is the one query that MUST be GraphQL. Over REST, listing open PRs
 * across N repos and showing review state plus check status per PR is
 * 1 + N + 2N calls; on a 20 repo org that is 60+ round trips and a rate limit
 * problem on every page load. One GraphQL query returns the same data in a
 * single request. The cost is that GraphQL reports errors with HTTP 200, which
 * ghGraphQL already handles.
 */
export async function fetchOpenPullRequests(limit = 50): Promise<PullRequestEntity[]> {
  try {
    return await fetchOpenPullRequestsGraphQL(limit);
  } catch (e) {
    // Fine-grained personal access tokens cannot use the GraphQL API for
    // organisation resources at all, and answer 401/403 for every query. That
    // is a headline reason to install the App, but the PAT fallback mode has
    // to remain usable until someone does, so drop to REST rather than
    // returning an empty inbox that looks like "no open pull requests".
    const status = e instanceof GitHubError ? e.status : 0;
    if (status !== 401 && status !== 403 && status !== 422) throw e;
    return fetchOpenPullRequestsRest(limit);
  }
}

/**
 * REST fallback for the org-wide inbox.
 *
 * Deliberately the slower path: it is 1 + N calls across N repositories, and
 * it reads the LIST endpoint, which omits mergeable, additions, deletions and
 * changed_files. So merge readiness from this path knows about reviews and
 * checks but reports mergeability as unknown rather than guessing, and the
 * detail view still reads the single-PR endpoint for the full picture.
 */
async function fetchOpenPullRequestsRest(limit: number): Promise<PullRequestEntity[]> {
  const repos = await fetchOrgRepos();
  const active = repos.filter((r) => !r.archived);

  const perRepo = await Promise.all(
    active.map(async (repo) => {
      try {
        const raw = await ghPaginate<unknown>(
          `/repos/${repo.fullName}/pulls?state=open&per_page=100`,
          { max: limit },
        );
        const out: PullRequestEntity[] = [];
        for (const item of raw) {
          const parsed = GhPullRequest.safeParse(item);
          if (!parsed.success) continue;
          // Reviews and checks are what merge readiness actually needs; they
          // are two more calls per PR, which is the cost of not having
          // GraphQL. Failures degrade to an empty list rather than losing the
          // pull request from the inbox entirely.
          const [reviews, checks] = await Promise.all([
            fetchReviews(repo.fullName, parsed.data.number).catch(() => []),
            fetchChecks(repo.fullName, parsed.data.head.sha).catch(() => []),
          ]);
          out.push(toPullRequestEntity(repo.fullName, parsed.data, { reviews, checks }));
        }
        return out;
      } catch {
        // One unreadable repository must not empty the whole inbox.
        return [];
      }
    }),
  );

  return perRepo
    .flat()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit * active.length);
}

async function fetchOpenPullRequestsGraphQL(limit: number): Promise<PullRequestEntity[]> {
  const query = `
    query OrgPullRequests($org: String!, $repos: Int!, $prs: Int!) {
      organization(login: $org) {
        repositories(first: $repos, orderBy: {field: PUSHED_AT, direction: DESC}) {
          nodes {
            nameWithOwner
            pullRequests(states: OPEN, first: $prs, orderBy: {field: UPDATED_AT, direction: DESC}) {
              nodes {
                databaseId
                id
                number
                title
                isDraft
                createdAt
                updatedAt
                mergeable
                url
                additions
                deletions
                changedFiles
                author { login ... on User { databaseId avatarUrl } }
                headRefName
                headRefOid
                baseRefName
                isCrossRepository
                labels(first: 20) { nodes { name color } }
                assignees(first: 10) { nodes { login databaseId avatarUrl } }
                reviewRequests(first: 10) {
                  nodes { requestedReviewer { ... on User { login databaseId avatarUrl } } }
                }
                latestReviews(first: 20) {
                  nodes { databaseId state submittedAt author { login ... on User { databaseId avatarUrl } } }
                }
                reviewThreads(first: 50) { nodes { isResolved isOutdated } }
                commits(last: 1) {
                  nodes {
                    commit {
                      statusCheckRollup {
                        contexts(first: 50) {
                          nodes {
                            __typename
                            ... on CheckRun { databaseId name status conclusion detailsUrl startedAt completedAt }
                            ... on StatusContext { context state targetUrl createdAt }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`;

  // 100 is GraphQL's hard per-connection maximum, so this is as far as one
  // query reaches. The REST fallback paginates to 500 repositories, and an
  // org past this ceiling would quietly show fewer pull requests on the
  // primary path than on the fallback. Rather than let the two disagree in
  // silence, the shortfall is logged: see the check after the loop.
  const REPO_CEILING = 100;
  const data = await ghGraphQL<GraphQLInbox>(query, {
    org: githubOrg(),
    repos: REPO_CEILING,
    prs: limit,
  });

  const repoNodes = data.organization?.repositories?.nodes ?? [];
  if (repoNodes.length >= REPO_CEILING) {
    logger.warn("github.inbox.repo_ceiling_reached", {
      ceiling: REPO_CEILING,
      hint: "the org has grown past one GraphQL page; the inbox may be incomplete",
    });
  }

  const out: PullRequestEntity[] = [];
  for (const repo of repoNodes) {
    if (!repo) continue;
    for (const pr of repo.pullRequests?.nodes ?? []) {
      if (!pr) continue;
      out.push(fromGraphQLPullRequest(repo.nameWithOwner, pr));
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// GraphQL response shapes, kept local because they exist only to be mapped
// onto our entities immediately.
type GqlActor = { login: string; databaseId?: number; avatarUrl?: string } | null;
type GqlCheckContext = {
  __typename: string;
  databaseId?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
  createdAt?: string;
};
type GqlPullRequest = {
  databaseId: number | null;
  id: string;
  number: number;
  title: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergeable: string;
  url: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  author: GqlActor;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  isCrossRepository: boolean;
  labels?: { nodes: ({ name: string; color?: string } | null)[] };
  assignees?: { nodes: (GqlActor | null)[] };
  reviewRequests?: { nodes: ({ requestedReviewer: GqlActor } | null)[] };
  latestReviews?: {
    nodes: (
      | { databaseId: number | null; state: string; submittedAt: string | null; author: GqlActor }
      | null
    )[];
  };
  reviewThreads?: { nodes: ({ isResolved: boolean; isOutdated: boolean } | null)[] };
  commits?: {
    nodes: ({
      commit: { statusCheckRollup: { contexts: { nodes: (GqlCheckContext | null)[] } } | null };
    } | null)[];
  };
};
type GraphQLInbox = {
  organization: {
    repositories: { nodes: ({ nameWithOwner: string; pullRequests: { nodes: (GqlPullRequest | null)[] } } | null)[] };
  } | null;
};

const gqlActor = (a: GqlActor) =>
  a ? { id: a.databaseId ?? 0, login: a.login, ...(a.avatarUrl ? { avatarUrl: a.avatarUrl } : {}) } : undefined;

/** GraphQL check conclusions are SCREAMING_CASE; REST's are lower_case, and
 *  every consumer expects the REST vocabulary. Normalising here means the
 *  merge-readiness rules do not need to know which transport produced them. */
function normalizeConclusion(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  // GraphQL StatusContext uses states, not conclusions: map them across.
  if (lower === "error") return "failure";
  if (lower === "expected" || lower === "pending") return null;
  return lower;
}

export function fromGraphQLPullRequest(repo: string, pr: GqlPullRequest): PullRequestEntity {
  const contexts =
    pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes?.filter(
      (c): c is GqlCheckContext => c !== null,
    ) ?? [];

  const checks = contexts.map((c, i) => {
    const isCheckRun = c.__typename === "CheckRun";
    const conclusion = normalizeConclusion(isCheckRun ? c.conclusion : c.state);
    return {
      // A StatusContext carries no databaseId, so it falls back to a
      // NEGATIVE synthetic id. A plain index collided with a real CheckRun
      // databaseId (a run with databaseId 1 and a status at index 1 both
      // came out as 1), which duplicates React keys and breaks any dedupe
      // done by id. Real GitHub ids are positive, so negatives cannot clash.
      id: c.databaseId ?? -(i + 1),
      name: (isCheckRun ? c.name : c.context) ?? "check",
      // A StatusContext has no status field; a null conclusion means pending.
      status: isCheckRun ? (c.status ?? "").toLowerCase() : conclusion === null ? "in_progress" : "completed",
      conclusion: conclusion as ReturnType<typeof toCheckSummary>["conclusion"],
      ...(c.detailsUrl || c.targetUrl ? { url: (c.detailsUrl ?? c.targetUrl) as string } : {}),
      ...(c.startedAt ? { startedAt: c.startedAt } : {}),
      ...(c.completedAt ? { completedAt: c.completedAt } : {}),
    };
  });

  const reviews: ReviewSummary[] = (pr.latestReviews?.nodes ?? [])
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r, i) => {
      const author = gqlActor(r.author);
      return {
        // databaseId is the same id the REST path reports, so a review keeps
        // one identity whichever transport loaded it. A positional index gave
        // the same review a different id depending on the route taken, which
        // makes any id-based comparison between the two paths meaningless.
        id: r.databaseId ?? -(i + 1),
        state: r.state.toUpperCase() as ReviewState,
        dismissed: r.state.toUpperCase() === "DISMISSED",
        ...(author ? { author } : {}),
        ...(r.submittedAt ? { submittedAt: r.submittedAt } : {}),
      };
    });

  // An outdated thread is one whose code changed underneath it; GitHub does
  // not require resolving those to merge, so counting them as blockers would
  // report a block that does not exist.
  const unresolvedThreads = (pr.reviewThreads?.nodes ?? []).filter(
    (t) => t !== null && !t.isResolved && !t.isOutdated,
  ).length;

  const author = gqlActor(pr.author);

  return {
    id: pr.databaseId ?? 0,
    nodeId: pr.id,
    repo,
    number: pr.number,
    title: pr.title,
    state: "open",
    draft: pr.isDraft,
    ...(author ? { author } : {}),
    assignees: (pr.assignees?.nodes ?? [])
      .map(gqlActor)
      .filter((a): a is NonNullable<typeof a> => !!a),
    requestedReviewers: (pr.reviewRequests?.nodes ?? [])
      .map((r) => (r ? gqlActor(r.requestedReviewer) : undefined))
      .filter((a): a is NonNullable<typeof a> => !!a),
    labels: (pr.labels?.nodes ?? [])
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => ({ name: l.name, ...(l.color ? { color: l.color } : {}) })),
    headRef: pr.headRefName,
    headSha: pr.headRefOid,
    baseRef: pr.baseRefName,
    fromFork: pr.isCrossRepository,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    // GraphQL reports MERGEABLE / CONFLICTING / UNKNOWN, where UNKNOWN means
    // "still computing" and must stay null rather than becoming false.
    mergeable: pr.mergeable === "MERGEABLE" ? true : pr.mergeable === "CONFLICTING" ? false : null,
    ...(pr.additions !== undefined ? { additions: pr.additions } : {}),
    ...(pr.deletions !== undefined ? { deletions: pr.deletions } : {}),
    ...(pr.changedFiles !== undefined ? { changedFiles: pr.changedFiles } : {}),
    url: pr.url,
    reviews,
    checks,
    unresolvedThreads,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * REST: recent workflow runs for a repo.
 *
 * Paginates to honour `limit`. GitHub's per_page maximum is 100, so asking
 * for more than that used to return 100 quietly and leave the caller
 * believing it had the number it asked for. Same object-wrapped response
 * shape as check-runs, so the Link header is followed the same way.
 */
export async function fetchWorkflowRuns(repo: string, limit = 50): Promise<WorkflowRunEntity[]> {
  const raw: unknown[] = [];
  let path: string | null = `/repos/${repo}/actions/runs?per_page=${Math.min(limit, 100)}`;

  while (path && raw.length < limit) {
    const res: GitHubResponse<{ workflow_runs?: unknown[] }> = await gh<{
      workflow_runs?: unknown[];
    }>(path);
    raw.push(...(res.data.workflow_runs ?? []));
    path = parseNextLink(res.headers.get("link"));
  }

  return raw
    .slice(0, limit)
    .map((r) => GhWorkflowRun.safeParse(r))
    .filter((r): r is { success: true; data: import("zod").infer<typeof GhWorkflowRun> } => r.success)
    .map((r) => toWorkflowRunEntity(repo, r.data));
}

/**
 * The failing job's log, reduced to the lines that explain the failure.
 *
 * GitHub returns the whole log, which for a CI run is megabytes. Showing that
 * inline is useless; the operator wants the error. This finds the failing
 * step's region and extracts a window around the first real error line.
 */
export async function fetchJobFailureExcerpt(
  repo: string,
  jobId: number,
  maxLines = 40,
): Promise<string | null> {
  let text: string;
  try {
    // The logs endpoint 302s to a signed blob; the client follows redirects.
    text = await ghData<string>(`/repos/${repo}/actions/jobs/${jobId}/logs`, {
      accept: "text/plain",
      conditional: false,
    });
  } catch (e) {
    // Logs expire after a retention window; a 404 or 410 is normal on an old
    // run and must not be an error the operator sees.
    if (e instanceof GitHubError && [404, 410].includes(e.status)) return null;
    throw e;
  }
  if (typeof text !== "string" || !text.trim()) return null;
  return extractFailure(text, maxLines);
}

/** Pull the meaningful failure out of a raw job log. Exported for tests
 *  because this heuristic is the difference between a useful CI panel and a
 *  wall of noise. */
export function extractFailure(log: string, maxLines = 40): string | null {
  const lines = log.split(/\r?\n/);
  // Strip the timestamp prefix Actions puts on every line.
  const clean = lines.map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ""));

  const markers = [
    /^##\[error\]/i,
    /\bFAIL\b/,
    /^\s*(Error|error):/,
    /AssertionError/,
    /Exception\b/,
    /Traceback \(most recent call last\)/,
    /npm ERR!/,
    /\bexit code [1-9]/i,
  ];

  let hit = -1;
  for (const [i, line] of clean.entries()) {
    if (markers.some((m) => m.test(line))) {
      hit = i;
      break;
    }
  }
  if (hit === -1) {
    // No marker: the tail is the next best thing, since a failure is almost
    // always near the end.
    // Guarded because -0 is not negative: slice(-0) is slice(0) and would
    // return the WHOLE log, the exact inverse of a cap. Same trap as the
    // activity log's limit (LC-075).
    const tail = maxLines > 0 ? clean.filter((l) => l.trim()).slice(-maxLines) : [];
    return tail.length ? tail.join("\n") : null;
  }

  // A few lines of lead-in give the error context (which test, which file).
  // The lead is bounded by the budget so a small maxLines cannot spend the
  // whole window on context and scroll the failing line itself out of view,
  // which is the one line the excerpt exists to show.
  const start = Math.max(0, hit - Math.min(5, Math.max(0, maxLines - 1)));
  return clean
    .slice(start, start + maxLines)
    .join("\n")
    .trimEnd();
}

/** REST: the PR diff, as a unified patch. Large diffs are the reason this is
 *  a separate call with its own cap rather than part of the PR read. */
export async function fetchPullRequestDiff(
  repo: string,
  number: number,
  maxBytes = 2 * 1024 * 1024,
): Promise<{ diff: string; truncated: boolean } | null> {
  try {
    const diff = await ghData<string>(`/repos/${repo}/pulls/${number}`, {
      accept: "application/vnd.github.diff",
      conditional: false,
    });
    if (typeof diff !== "string") return null;
    if (Buffer.byteLength(diff, "utf8") > maxBytes) {
      // Measured in bytes, so it has to be cut in bytes. String.slice counts
      // UTF-16 code units, so a diff of Sinhala or CJK text sailed past a
      // 2 MB cap at up to 4 MB, and slicing mid-character could also split a
      // surrogate pair. Decoding the byte window with a non-fatal decoder
      // turns a cut-through character into a single replacement character
      // rather than mojibake, and that trailing partial is dropped.
      const bytes = Buffer.from(diff, "utf8");
      const window = bytes.subarray(0, maxBytes);
      const cut = new TextDecoder("utf-8").decode(window);
      // Only strip a trailing replacement character when the cut actually
      // made one. A byte at the boundary with the 10xxxxxx continuation
      // pattern means a multi-byte character was severed. Testing the bytes
      // rather than the decoded text matters because a diff can legitimately
      // contain U+FFFD, and blindly stripping would eat a real character.
      const severed = maxBytes < bytes.length && (bytes[maxBytes] ?? 0) >= 0x80 && (bytes[maxBytes] ?? 0) < 0xc0;
      return { diff: severed ? cut.replace(/�$/, "") : cut, truncated: true };
    }
    return { diff, truncated: false };
  } catch (e) {
    // GitHub refuses to render a diff past a size limit, with a 406.
    if (e instanceof GitHubError && [404, 406].includes(e.status)) return null;
    throw e;
  }
}

/** REST: the file list for a PR, which is what the review UI needs before it
 *  needs any file's contents. */
export async function fetchPullRequestFiles(repo: string, number: number, max = 300) {
  return ghPaginate<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>(`/repos/${repo}/pulls/${number}/files?per_page=100`, { max });
}

/** Our own rate limit budget, read from GitHub rather than inferred. */
export async function fetchRateLimit() {
  const res = await gh<{
    resources: Record<string, { limit: number; remaining: number; reset: number; used: number }>;
  }>("/rate_limit", { conditional: false });
  return res.data.resources;
}
