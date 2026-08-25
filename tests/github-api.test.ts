// Typed reads against the GitHub API.
//
// Three things here are worth real tests. The GraphQL-to-REST fallback, which
// is what keeps the console usable on a fine-grained PAT and must fire on
// exactly the statuses that mean "this token cannot use GraphQL for org
// resources" and on nothing else. The log excerpt heuristic, which is the
// difference between a useful CI panel and a wall of noise. And the mapping
// itself: two transports feed the same entity, and if they disagree the PR
// list and the PR detail disagree.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ——— transport ———
// Mocked at the client boundary, so the schema parsing, the entity projection
// and the fallback logic above it are all the real code. GitHubError comes
// from the real module because the fallback branches on `instanceof` and on
// `.status`.
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

// The inbox warns when the org fills a whole GraphQL page, because past that
// the primary path quietly returns less than the REST fallback would. That
// warning is the only signal it happened, so it is asserted rather than
// silenced.
const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logger: { ...actual.logger, ...log } };
});

import { GitHubError } from "@/lib/github/client";
import {
  extractFailure,
  fetchChecks,
  fetchComparison,
  fetchJobFailureExcerpt,
  fetchOpenPullRequests,
  fetchOrgRepos,
  fetchPullRequest,
  fetchPullRequestDiff,
  fetchPullRequestFiles,
  fetchRateLimit,
  fetchRepo,
  fetchReviews,
  fetchWorkflowRuns,
  fromGraphQLPullRequest,
  toRepoEntity,
} from "@/lib/github/api";
import type { PullRequestEntity } from "@/lib/github/entities";
import { atIndex } from "./helpers";

const REPO = "luminary-dev/console";
const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// ——— a tiny router, so each test declares only the endpoints it cares about ———

type Route = { match: RegExp; respond: (path: string) => unknown };

const restRoutes: Route[] = [];
const pageRoutes: Route[] = [];
const rawRoutes: Route[] = [];
const requested: string[] = [];
const graphqlCalls: { query: string; variables: Record<string, unknown> }[] = [];

const onRead = (match: RegExp, respond: (path: string) => unknown) =>
  restRoutes.push({ match, respond });
const onPage = (match: RegExp, respond: (path: string) => unknown) =>
  pageRoutes.push({ match, respond });
const onRaw = (match: RegExp, respond: (path: string) => unknown) =>
  rawRoutes.push({ match, respond });

function dispatch(routes: Route[], path: string, kind: string): unknown {
  requested.push(path);
  const route = routes.find((r) => r.match.test(path));
  if (!route) throw new Error(`the test transport has no ${kind} route for ${path}`);
  return route.respond(path);
}

const notFound = (path: string): never => {
  throw new GitHubError("Not Found", 404, path);
};

/** A gh() response that carries a Link header. Readers that paginate by hand
 *  must follow rel="next" and never synthesise a page number, so the fake
 *  transport hands them a real header to parse rather than a page count. */
class LinkedPage {
  constructor(
    readonly data: unknown,
    readonly next?: string,
  ) {}
}

const linked = (data: unknown, next?: string) => new LinkedPage(data, next);

beforeEach(() => {
  restRoutes.length = 0;
  pageRoutes.length = 0;
  rawRoutes.length = 0;
  requested.length = 0;
  graphqlCalls.length = 0;
  log.warn.mockClear();

  transport.gh.mockReset();
  transport.ghData.mockReset();
  transport.ghPaginate.mockReset();
  transport.ghGraphQL.mockReset();

  transport.gh.mockImplementation(async (path: string) => {
    const answer = dispatch(rawRoutes, path, "gh");
    const headers = new Headers();
    if (answer instanceof LinkedPage && answer.next) {
      // Exactly the shape GitHub sends, including the rel="prev" that a naive
      // parser would happily follow backwards forever.
      headers.set(
        "link",
        `<https://api.github.com${path}>; rel="prev", <https://api.github.com${answer.next}>; rel="next"`,
      );
    }
    return {
      data: answer instanceof LinkedPage ? answer.data : answer,
      status: 200,
      headers,
      fromCache: false,
    };
  });
  transport.ghData.mockImplementation(async (path: string) =>
    dispatch(restRoutes, path, "ghData"),
  );
  transport.ghPaginate.mockImplementation(async (path: string) =>
    dispatch(pageRoutes, path, "ghPaginate"),
  );
  transport.ghGraphQL.mockImplementation(
    async (query: string, variables: Record<string, unknown>) => {
      graphqlCalls.push({ query, variables });
      throw new Error("no GraphQL response was configured for this test");
    },
  );
});

// ——— fixtures ———

const repoPayload = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "console",
  full_name: REPO,
  private: true,
  archived: false,
  default_branch: "main",
  html_url: `https://github.com/${REPO}`,
  description: "The internal console",
  language: "TypeScript",
  license: { spdx_id: "MIT" },
  open_issues_count: 4,
  pushed_at: "2026-08-26T09:30:00Z",
  ...overrides,
});

/** What the pull request LIST endpoint returns: no mergeable, no additions,
 *  no changed_files. The single-PR endpoint is the only one that has those. */
const prListPayload = (overrides: Record<string, unknown> = {}) => ({
  id: 9001,
  node_id: "PR_kwDOexample7",
  number: 7,
  state: "open",
  title: "Harden the merge guard",
  draft: false,
  created_at: "2026-08-20T09:00:00Z",
  updated_at: "2026-08-26T09:30:00Z",
  html_url: `https://github.com/${REPO}/pull/7`,
  user: { id: 11, login: "dhanika", avatar_url: "https://avatars.test/dhanika" },
  assignees: [],
  requested_reviewers: [],
  labels: [{ name: "backend", color: "0e8a16" }],
  head: { ref: "feat/merge-guard", sha: HEAD_SHA, repo: repoPayload() },
  base: { ref: "main", sha: "bbbb", repo: repoPayload() },
  ...overrides,
});

const reviewPayload = {
  id: 31,
  state: "approved",
  submitted_at: "2026-08-26T09:20:00Z",
  user: { id: 12, login: "gaveen", avatar_url: "https://avatars.test/gaveen" },
};

const checkRunPayload = {
  id: 55,
  name: "build",
  head_sha: HEAD_SHA,
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/checks/55",
};

const gqlPullRequest = (overrides: Record<string, unknown> = {}) => ({
  databaseId: 9001,
  id: "PR_kwDOexample7",
  number: 7,
  title: "Harden the merge guard",
  isDraft: false,
  createdAt: "2026-08-20T09:00:00Z",
  updatedAt: "2026-08-26T09:30:00Z",
  // The list-endpoint parity case: GitHub has not computed mergeability, and
  // UNKNOWN must stay null rather than becoming false.
  mergeable: "UNKNOWN",
  url: `https://github.com/${REPO}/pull/7`,
  additions: 120,
  deletions: 8,
  changedFiles: 4,
  author: { login: "dhanika", databaseId: 11, avatarUrl: "https://avatars.test/dhanika" },
  headRefName: "feat/merge-guard",
  headRefOid: HEAD_SHA,
  baseRefName: "main",
  isCrossRepository: false,
  labels: { nodes: [{ name: "backend", color: "0e8a16" }] },
  assignees: { nodes: [] },
  reviewRequests: { nodes: [] },
  latestReviews: {
    nodes: [
      {
        // The same review as reviewPayload below, seen over the other
        // transport: the id has to come out the same on both.
        databaseId: 31,
        state: "APPROVED",
        submittedAt: "2026-08-26T09:20:00Z",
        author: { login: "gaveen", databaseId: 12, avatarUrl: "https://avatars.test/gaveen" },
      },
    ],
  },
  reviewThreads: { nodes: [] },
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: {
              nodes: [
                {
                  __typename: "CheckRun",
                  databaseId: 55,
                  name: "build",
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                  detailsUrl: "https://github.com/checks/55",
                },
              ],
            },
          },
        },
      },
    ],
  },
  ...overrides,
});

const inbox = (prs: unknown[]) => ({
  organization: {
    repositories: { nodes: [{ nameWithOwner: REPO, pullRequests: { nodes: prs } }] },
  },
});

describe("single reads", () => {
  it("maps a repository, converting a UNIX pushed_at into an ISO timestamp", async () => {
    // GitHub answers pushed_at as a number on some endpoints and a string on
    // others; the entity has to be one type or every consumer branches.
    onRead(/^\/repos\/luminary-dev\/console$/, () =>
      repoPayload({ pushed_at: 1_756_200_000 }),
    );
    const repo = await fetchRepo(REPO);
    expect(repo?.pushedAt).toBe(new Date(1_756_200_000 * 1000).toISOString());
    expect(repo?.fullName).toBe(REPO);
    expect(repo?.license).toBe("MIT");
    expect(repo?.private).toBe(true);
  });

  it("reads a 404 as a missing repository, not as an error", async () => {
    // A renamed, transferred or deleted repo is a normal state of the world.
    onRead(/^\/repos\//, notFound);
    expect(await fetchRepo("luminary-dev/gone")).toBeNull();
  });

  it("raises anything that is not a 404 on a repository read", async () => {
    onRead(/^\/repos\//, (path) => {
      throw new GitHubError("Bad gateway", 502, path);
    });
    await expect(fetchRepo(REPO)).rejects.toMatchObject({ status: 502 });
  });

  it("returns null for a payload that does not match the schema", async () => {
    // An unparseable payload must not become undefined three layers down at
    // render time.
    onRead(/^\/repos\//, () => ({ full_name: REPO }));
    expect(await fetchRepo(REPO)).toBeNull();
  });

  it("falls back to a constructed URL and to main when the payload omits them", () => {
    const repo = toRepoEntity({ id: 2, name: "site", full_name: "luminary-dev/site" });
    expect(repo.url).toBe("https://github.com/luminary-dev/site");
    expect(repo.defaultBranch).toBe("main");
    expect(repo.private).toBe(false);
    expect(repo.archived).toBe(false);
  });

  it("paginates the org repository list and drops entries that do not parse", async () => {
    onPage(/^\/orgs\/luminary-dev\/repos/, () => [
      repoPayload(),
      { name: "broken" },
      repoPayload({ id: 2, name: "site", full_name: "luminary-dev/site" }),
    ]);
    const repos = await fetchOrgRepos();
    expect(repos.map((r) => r.fullName)).toEqual([REPO, "luminary-dev/site"]);
    expect(atIndex(transport.ghPaginate.mock.calls, 0)).toEqual([
      "/orgs/luminary-dev/repos?per_page=100&sort=pushed",
      { max: 500 },
    ]);
  });

  it("reads a pull request together with its reviews, checks and base comparison", async () => {
    onRead(/^\/repos\/.+\/pulls\/7$/, () =>
      prListPayload({ mergeable: true, additions: 120, deletions: 8, changed_files: 4 }),
    );
    onPage(/\/pulls\/7\/reviews/, () => [reviewPayload]);
    onRaw(/\/check-runs/, () => ({ check_runs: [checkRunPayload] }));
    onRead(/\/compare\//, () => ({ behind_by: 2, ahead_by: 5 }));

    const pr = await fetchPullRequest(REPO, 7);
    expect(pr?.mergeable).toBe(true);
    expect(pr?.changedFiles).toBe(4);
    expect(atIndex(pr?.reviews ?? [], 0)).toMatchObject({ state: "APPROVED", dismissed: false });
    expect(atIndex(pr?.checks ?? [], 0)).toMatchObject({ name: "build", conclusion: "success" });
    // behind_by is the "branch is behind" signal merge readiness needs.
    expect(pr?.behindBy).toBe(2);
  });

  it("keeps the pull request when its reviews, checks and comparison all fail", async () => {
    // Losing the PR from the inbox because a side read failed would be worse
    // than showing it with less detail.
    onRead(/^\/repos\/.+\/pulls\/7$/, () => prListPayload());
    onPage(/\/reviews/, notFound);
    onRaw(/\/check-runs/, notFound);
    onRead(/\/compare\//, (path) => {
      throw new GitHubError("Server Error", 500, path);
    });

    const pr = await fetchPullRequest(REPO, 7);
    expect(pr?.number).toBe(7);
    expect(pr?.reviews).toEqual([]);
    expect(pr?.checks).toEqual([]);
    expect(pr?.behindBy).toBeUndefined();
  });

  it("returns null for a pull request that no longer exists", async () => {
    onRead(/^\/repos\/.+\/pulls\/7$/, notFound);
    expect(await fetchPullRequest(REPO, 7)).toBeNull();
  });

  it("raises anything that is not a 404 on a pull request read", async () => {
    // "null" means gone. Reporting an outage as gone would let a reconcile
    // delete a projection for a pull request that is perfectly alive.
    onRead(/^\/repos\/.+\/pulls\/7$/, (path) => {
      throw new GitHubError("Bad gateway", 502, path);
    });
    await expect(fetchPullRequest(REPO, 7)).rejects.toMatchObject({ status: 502 });
  });

  it("returns null for a pull request payload that does not parse", async () => {
    onRead(/^\/repos\/.+\/pulls\/7$/, () => ({ number: 7 }));
    expect(await fetchPullRequest(REPO, 7)).toBeNull();
  });

  it("flags a dismissed review while keeping it in the timeline", async () => {
    // A dismissed review no longer gates the merge but still belongs in the
    // history, so it is kept and marked rather than filtered away.
    onPage(/\/reviews/, () => [
      reviewPayload,
      { ...reviewPayload, id: 32, state: "dismissed", user: null },
      { id: 33 },
    ]);
    const reviews = await fetchReviews(REPO, 7);
    expect(reviews).toHaveLength(2);
    expect(atIndex(reviews, 1)).toEqual({ id: 32, state: "DISMISSED", dismissed: true, submittedAt: "2026-08-26T09:20:00Z" });
  });

  it("url-encodes the refs it compares, so a slashed branch name still resolves", async () => {
    onRead(/\/compare\//, () => ({ behind_by: 1, ahead_by: 0 }));
    await fetchComparison(REPO, "release/2026-08", HEAD_SHA);
    expect(atIndex(requested, 0)).toBe(
      `/repos/${REPO}/compare/release%2F2026-08...${HEAD_SHA}`,
    );
  });

  it("reads a 404 or 422 from a comparison as a stale SHA rather than an error", async () => {
    // A force push deletes the SHA we cached; the reconcile refreshes it.
    onRead(/\/compare\//, notFound);
    expect(await fetchComparison(REPO, "main", HEAD_SHA)).toBeNull();

    restRoutes.length = 0;
    onRead(/\/compare\//, (path) => {
      throw new GitHubError("Unprocessable", 422, path);
    });
    expect(await fetchComparison(REPO, "main", HEAD_SHA)).toBeNull();
  });

  it("raises a 500 from a comparison", async () => {
    onRead(/\/compare\//, (path) => {
      throw new GitHubError("Server Error", 500, path);
    });
    await expect(fetchComparison(REPO, "main", HEAD_SHA)).rejects.toMatchObject({ status: 500 });
  });

  it("caps the workflow run page size at GitHub's maximum", async () => {
    onRaw(/\/actions\/runs/, () => ({
      workflow_runs: [
        {
          id: 77,
          name: "CI",
          head_sha: HEAD_SHA,
          status: "completed",
          conclusion: "failure",
          created_at: "2026-08-26T09:00:00Z",
          updated_at: "2026-08-26T09:05:00Z",
          run_started_at: "2026-08-26T09:00:30Z",
        },
        { id: 78 },
      ],
    }));
    const runs = await fetchWorkflowRuns(REPO, 500);
    expect(atIndex(requested, 0)).toBe(`/repos/${REPO}/actions/runs?per_page=100`);
    expect(runs).toHaveLength(1);
    expect(atIndex(runs, 0).durationMs).toBe(270_000);
  });

  it("stops paging workflow runs once it holds as many as it was asked for", async () => {
    // The limit is the caller's appetite. Following the Link header past it
    // would spend rate budget on rows nobody asked for.
    const runsPath = `/repos/${REPO}/actions/runs?per_page=3`;
    const run = (id: number) => ({
      id,
      name: "CI",
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "success",
      created_at: "2026-08-26T09:00:00Z",
      updated_at: "2026-08-26T09:05:00Z",
    });
    onRaw(/actions\/runs\?per_page=3$/, () =>
      linked({ workflow_runs: [run(1), run(2)] }, `${runsPath}&page=2`),
    );
    onRaw(/actions\/runs.*page=2$/, () =>
      linked({ workflow_runs: [run(3), run(4)] }, `${runsPath}&page=3`),
    );

    const runs = await fetchWorkflowRuns(REPO, 3);
    expect(runs.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(requested).toHaveLength(2);
  });

  it("reads the rate limit budget from GitHub rather than inferring it", async () => {
    onRaw(/^\/rate_limit$/, () => ({
      resources: { core: { limit: 5000, remaining: 4900, reset: 1_756_200_000, used: 100 } },
    }));
    const resources = await fetchRateLimit();
    expect(resources.core?.remaining).toBe(4900);
  });

  it("passes the file list cap through to the paginator", async () => {
    onPage(/\/pulls\/7\/files/, () => [
      { filename: "lib/github/api.ts", status: "modified", additions: 3, deletions: 1, changes: 4 },
    ]);
    const files = await fetchPullRequestFiles(REPO, 7, 25);
    expect(atIndex(files, 0).filename).toBe("lib/github/api.ts");
    expect(atIndex(transport.ghPaginate.mock.calls, 0)).toEqual([
      `/repos/${REPO}/pulls/7/files?per_page=100`,
      { max: 25 },
    ]);
  });
});

describe("check runs, which merge safety is decided from", () => {
  const CHECKS_PATH = `/repos/${REPO}/commits/${HEAD_SHA}/check-runs?per_page=100`;

  /** A page of `n` passing check runs, numbered from `from`. */
  const passing = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: from + i,
      name: `matrix-${from + i}`,
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "success",
    }));

  it("treats a commit with no checks as an empty result, not a failure", async () => {
    onRaw(/\/check-runs/, () => ({}));
    expect(await fetchChecks(REPO, HEAD_SHA)).toEqual([]);
  });

  it("reads every check run on a commit with more than one page of them", async () => {
    // A large matrix build easily passes 100 checks. One page used to be all
    // this read, which silently dropped the rest.
    onRaw(/check-runs\?per_page=100$/, () =>
      linked({ check_runs: passing(1, 100) }, `${CHECKS_PATH}&page=2`),
    );
    onRaw(/check-runs.*page=2$/, () =>
      linked({ check_runs: passing(101, 100) }, `${CHECKS_PATH}&page=3`),
    );
    onRaw(/check-runs.*page=3$/, () => ({ check_runs: passing(201, 30) }));

    const checks = await fetchChecks(REPO, HEAD_SHA);
    expect(checks).toHaveLength(230);
    expect(atIndex(checks, 0).name).toBe("matrix-1");
    expect(atIndex(checks, 229).name).toBe("matrix-230");
  });

  it("does not lose a failing check that lands on the second page", async () => {
    // This is the bug in one sentence: mergeReadiness decides from this list,
    // so a dropped failing check made a blocked pull request report as ready.
    onRaw(/check-runs\?per_page=100$/, () =>
      linked({ check_runs: passing(1, 100) }, `${CHECKS_PATH}&page=2`),
    );
    onRaw(/check-runs.*page=2$/, () => ({
      check_runs: [
        {
          id: 999,
          name: "integration",
          head_sha: HEAD_SHA,
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/checks/999",
        },
      ],
    }));

    const checks = await fetchChecks(REPO, HEAD_SHA);
    expect(checks).toHaveLength(101);
    const failing = checks.filter((c) => c.conclusion === "failure");
    expect(failing.map((c) => c.name)).toEqual(["integration"]);
  });

  it("follows rel=next only, never a synthesised page number", async () => {
    // GitHub's Link header simply stops carrying rel="next" on the last page.
    // A loop keyed on "was that a full page?" would ask for page 2 forever.
    onRaw(/check-runs/, () => ({ check_runs: passing(1, 100) }));

    const checks = await fetchChecks(REPO, HEAD_SHA);
    expect(checks).toHaveLength(100);
    expect(requested).toEqual([CHECKS_PATH]);
  });

  it("stops at the page cap rather than following a Link header forever", async () => {
    // A cursor that always points at another page (a redirect loop, a broken
    // proxy) must cost a bounded number of calls, not the whole rate budget.
    onRaw(/\/check-runs/, (path) => linked({ check_runs: passing(1, 1) }, `${path}&page=next`));

    const checks = await fetchChecks(REPO, HEAD_SHA, 3);
    expect(checks).toHaveLength(3);
    expect(requested).toHaveLength(3);
  });

  it("drops a malformed check run without dropping the page it arrived on", async () => {
    onRaw(/\/check-runs/, () => ({
      check_runs: [checkRunPayload, { id: 56 }, { ...checkRunPayload, id: 57, name: "test" }],
    }));
    const checks = await fetchChecks(REPO, HEAD_SHA);
    expect(checks.map((c) => c.name)).toEqual(["build", "test"]);
  });
});

describe("the org inbox: GraphQL first, REST as the fallback", () => {
  function serveRestInbox(): void {
    onPage(/^\/orgs\/luminary-dev\/repos/, () => [
      repoPayload(),
      repoPayload({ id: 2, name: "old", full_name: "luminary-dev/old", archived: true }),
    ]);
    onPage(/^\/repos\/luminary-dev\/console\/pulls\?state=open/, () => [prListPayload()]);
    onPage(/\/pulls\/7\/reviews/, () => [reviewPayload]);
    onRaw(/\/check-runs/, () => ({ check_runs: [checkRunPayload] }));
  }

  it("uses GraphQL when it works, and never touches the REST fallback", async () => {
    // One query instead of 1 + N + 2N round trips is the entire reason this
    // path exists; quietly falling through to REST would cost the rate budget
    // it was built to save.
    transport.ghGraphQL.mockImplementation(async (query: string, variables: Record<string, unknown>) => {
      graphqlCalls.push({ query, variables });
      return inbox([gqlPullRequest()]);
    });

    const prs = await fetchOpenPullRequests(25);
    expect(prs).toHaveLength(1);
    expect(atIndex(prs, 0).repo).toBe(REPO);
    // 100 is GraphQL's hard per-connection maximum, so it is as far as one
    // query reaches; asking for fewer would hide repositories for no gain.
    expect(atIndex(graphqlCalls, 0).variables).toEqual({ org: "luminary-dev", repos: 100, prs: 25 });
    expect(transport.ghPaginate).not.toHaveBeenCalled();
    expect(transport.ghData).not.toHaveBeenCalled();
  });

  it.each([401, 403, 422])(
    "falls back to REST on a %i, because a fine-grained PAT cannot use GraphQL for org resources",
    async (status) => {
      // Returning an empty inbox here would read as "no open pull requests",
      // which is the worst possible way to report a credential limitation.
      transport.ghGraphQL.mockImplementation(async () => {
        throw new GitHubError("Resource not accessible", status, "/graphql");
      });
      serveRestInbox();

      const prs = await fetchOpenPullRequests();
      expect(prs).toHaveLength(1);
      expect(atIndex(prs, 0).number).toBe(7);
      expect(transport.ghPaginate).toHaveBeenCalled();
    },
  );

  it("does not fall back on a 500: a GitHub outage is not a permissions problem", async () => {
    transport.ghGraphQL.mockImplementation(async () => {
      throw new GitHubError("Server Error", 500, "/graphql");
    });
    serveRestInbox();

    await expect(fetchOpenPullRequests()).rejects.toMatchObject({ status: 500 });
    expect(transport.ghPaginate).not.toHaveBeenCalled();
  });

  it("does not fall back on a rate limit, which retrying over REST would only worsen", async () => {
    // ghGraphQL maps a RATE_LIMITED error body onto 429; N+1 REST calls are
    // exactly the wrong response to being rate limited.
    transport.ghGraphQL.mockImplementation(async () => {
      throw new GitHubError("GraphQL: API rate limit exceeded", 429, "/graphql");
    });
    serveRestInbox();

    await expect(fetchOpenPullRequests()).rejects.toMatchObject({ status: 429 });
    expect(transport.ghPaginate).not.toHaveBeenCalled();
  });

  it("does not fall back on an error that is not a GitHubError at all", async () => {
    transport.ghGraphQL.mockImplementation(async () => {
      throw new TypeError("cannot read properties of null");
    });
    serveRestInbox();

    await expect(fetchOpenPullRequests()).rejects.toBeInstanceOf(TypeError);
    expect(transport.ghPaginate).not.toHaveBeenCalled();
  });

  it("skips archived repositories on the REST path", async () => {
    transport.ghGraphQL.mockImplementation(async () => {
      throw new GitHubError("Resource not accessible", 403, "/graphql");
    });
    serveRestInbox();

    await fetchOpenPullRequests();
    expect(requested.some((p) => p.includes("luminary-dev/old"))).toBe(false);
  });

  it("keeps the inbox when one repository is unreadable", async () => {
    // One repo the token cannot see must not empty the whole screen.
    transport.ghGraphQL.mockImplementation(async () => {
      throw new GitHubError("Resource not accessible", 403, "/graphql");
    });
    onPage(/^\/orgs\/luminary-dev\/repos/, () => [
      repoPayload(),
      repoPayload({ id: 2, name: "secret", full_name: "luminary-dev/secret" }),
    ]);
    onPage(/^\/repos\/luminary-dev\/secret\/pulls\?state=open/, notFound);
    onPage(/^\/repos\/luminary-dev\/console\/pulls\?state=open/, () => [prListPayload()]);
    onPage(/\/pulls\/7\/reviews/, () => [reviewPayload]);
    onRaw(/\/check-runs/, () => ({ check_runs: [checkRunPayload] }));

    const prs = await fetchOpenPullRequests();
    expect(prs.map((p) => p.repo)).toEqual([REPO]);
  });

  it("sorts the REST inbox by last update and degrades a PR rather than dropping it", async () => {
    // Reviews and checks are two extra calls per pull request on this path.
    // When they fail the pull request still belongs in the inbox, with less
    // detail, because a missing row is a bug the operator cannot see.
    transport.ghGraphQL.mockImplementation(async () => {
      throw new GitHubError("Resource not accessible", 403, "/graphql");
    });
    onPage(/^\/orgs\/luminary-dev\/repos/, () => [repoPayload()]);
    onPage(/^\/repos\/luminary-dev\/console\/pulls\?state=open/, () => [
      prListPayload({ id: 1, number: 4, updated_at: "2026-08-21T09:00:00Z" }),
      prListPayload({ id: 2, number: 9, updated_at: "2026-08-26T22:00:00Z" }),
      { number: 10 },
    ]);
    onPage(/\/reviews/, notFound);
    onRaw(/\/check-runs/, notFound);

    const prs = await fetchOpenPullRequests();
    expect(prs.map((p) => p.number)).toEqual([9, 4]);
    expect(atIndex(prs, 0).reviews).toEqual([]);
    expect(atIndex(prs, 0).checks).toEqual([]);
  });

  it("sorts the GraphQL inbox by last update, newest first", async () => {
    transport.ghGraphQL.mockImplementation(async () =>
      inbox([
        gqlPullRequest({ number: 3, databaseId: 3, updatedAt: "2026-08-20T08:00:00Z" }),
        null,
        gqlPullRequest({ number: 9, databaseId: 9, updatedAt: "2026-08-26T18:00:00Z" }),
      ]),
    );

    const prs = await fetchOpenPullRequests();
    // A null node in a GraphQL list is normal (a repo the token cannot read)
    // and must be skipped rather than crashing the mapping.
    expect(prs.map((p) => p.number)).toEqual([9, 3]);
  });

  it("says so when the org fills a whole GraphQL page of repositories", async () => {
    // 100 is the hard per-connection maximum, so a full page means there may
    // be repositories the inbox never saw. The REST fallback would have
    // paginated further, and the two paths disagreeing in silence is exactly
    // what this warning exists to prevent.
    const repos = Array.from({ length: 100 }, (_, i) => ({
      nameWithOwner: `luminary-dev/repo-${i}`,
      pullRequests: { nodes: [] },
    }));
    transport.ghGraphQL.mockImplementation(async () => ({
      organization: { repositories: { nodes: repos } },
    }));

    await fetchOpenPullRequests();
    expect(log.warn).toHaveBeenCalledWith(
      "github.inbox.repo_ceiling_reached",
      expect.objectContaining({ ceiling: 100 }),
    );
  });

  it("stays quiet when the org fits inside one page", async () => {
    transport.ghGraphQL.mockImplementation(async () => inbox([gqlPullRequest()]));
    await fetchOpenPullRequests();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("handles an organisation GitHub will not resolve", async () => {
    transport.ghGraphQL.mockImplementation(async () => ({ organization: null }));
    expect(await fetchOpenPullRequests()).toEqual([]);
  });
});

describe("REST and GraphQL project onto the same entity", () => {
  /** Every field both transports can know, ids included. Reviews and checks
   *  are compared whole: the same review read over GraphQL and over REST has
   *  to carry the same id, or anything keyed on it double-counts the moment
   *  the inbox falls back. */
  function comparable(pr: PullRequestEntity) {
    return {
      id: pr.id,
      nodeId: pr.nodeId,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      author: pr.author,
      assignees: pr.assignees,
      requestedReviewers: pr.requestedReviewers,
      labels: pr.labels,
      headRef: pr.headRef,
      headSha: pr.headSha,
      baseRef: pr.baseRef,
      fromFork: pr.fromFork,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      mergeable: pr.mergeable,
      url: pr.url,
      checks: pr.checks,
      reviews: pr.reviews,
    };
  }

  it("produces the same shape from the same pull request over either transport", async () => {
    transport.ghGraphQL.mockImplementation(async () => inbox([gqlPullRequest()]));
    const viaGraphQL = atIndex(await fetchOpenPullRequests(), 0);

    transport.ghGraphQL.mockImplementation(async () => {
      throw new GitHubError("Resource not accessible", 403, "/graphql");
    });
    onPage(/^\/orgs\/luminary-dev\/repos/, () => [repoPayload()]);
    onPage(/^\/repos\/luminary-dev\/console\/pulls\?state=open/, () => [prListPayload()]);
    onPage(/\/pulls\/7\/reviews/, () => [reviewPayload]);
    onRaw(/\/check-runs/, () => ({ check_runs: [checkRunPayload] }));
    const viaRest = atIndex(await fetchOpenPullRequests(), 0);

    expect(comparable(viaRest)).toEqual(comparable(viaGraphQL));
    // Spelled out, because it is the part that used to differ: the review's
    // own GitHub id survives both mappings rather than being a position.
    expect(atIndex(viaRest.reviews, 0).id).toBe(31);
    expect(atIndex(viaGraphQL.reviews, 0).id).toBe(31);
    expect(atIndex(viaRest.checks, 0).id).toBe(55);
    expect(atIndex(viaGraphQL.checks, 0).id).toBe(55);
  });

  it("reports the fields only GraphQL can know as absent on the REST path", async () => {
    // The REST list endpoint omits mergeable, additions, deletions and
    // changed_files, and there is no review thread endpoint at all. The source
    // documents this as "unknown rather than guessing", and absent is what
    // "unknown" has to look like.
    transport.ghGraphQL.mockImplementation(async () => inbox([gqlPullRequest()]));
    const viaGraphQL = atIndex(await fetchOpenPullRequests(), 0);

    transport.ghGraphQL.mockImplementation(async () => {
      throw new GitHubError("Resource not accessible", 403, "/graphql");
    });
    onPage(/^\/orgs\/luminary-dev\/repos/, () => [repoPayload()]);
    onPage(/^\/repos\/luminary-dev\/console\/pulls\?state=open/, () => [prListPayload()]);
    onPage(/\/pulls\/7\/reviews/, () => [reviewPayload]);
    onRaw(/\/check-runs/, () => ({ check_runs: [checkRunPayload] }));
    const viaRest = atIndex(await fetchOpenPullRequests(), 0);

    expect(viaGraphQL.additions).toBe(120);
    expect(viaRest.additions).toBeUndefined();
    expect(viaGraphQL.unresolvedThreads).toBe(0);
    expect(viaRest.unresolvedThreads).toBeUndefined();
    // Both agree that mergeability is not known here, which is the one thing
    // they must not disagree about.
    expect(viaGraphQL.mergeable).toBeNull();
    expect(viaRest.mergeable).toBeNull();
  });
});

describe("the GraphQL mapping's own quirks", () => {
  const map = (overrides: Record<string, unknown> = {}) =>
    fromGraphQLPullRequest(REPO, gqlPullRequest(overrides) as never);

  it("keeps UNKNOWN mergeability null rather than turning it into a conflict", () => {
    expect(map({ mergeable: "MERGEABLE" }).mergeable).toBe(true);
    expect(map({ mergeable: "CONFLICTING" }).mergeable).toBe(false);
    expect(map({ mergeable: "UNKNOWN" }).mergeable).toBeNull();
  });

  it("lowercases SCREAMING_CASE conclusions into the REST vocabulary", () => {
    // Every consumer of CheckSummary expects REST's spelling; normalising here
    // means the merge readiness rules never ask which transport produced them.
    const contexts = (nodes: unknown[]) => ({
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] },
    });

    const pr = map(
      contexts([
        {
          __typename: "CheckRun",
          databaseId: 1,
          name: "lint",
          status: "COMPLETED",
          conclusion: "FAILURE",
          detailsUrl: "https://github.com/checks/1",
          startedAt: "2026-08-26T09:00:00Z",
          completedAt: "2026-08-26T09:01:00Z",
        },
        // A StatusContext has no status field, and its ERROR state is REST's
        // "failure".
        { __typename: "StatusContext", context: "vercel", state: "ERROR", targetUrl: "https://vercel.test/1" },
        // PENDING is not a conclusion at all: it means the check is running.
        { __typename: "StatusContext", context: "netlify", state: "PENDING" },
        null,
      ]),
    );

    expect(pr.checks).toEqual([
      {
        id: 1,
        name: "lint",
        status: "completed",
        conclusion: "failure",
        url: "https://github.com/checks/1",
        startedAt: "2026-08-26T09:00:00Z",
        completedAt: "2026-08-26T09:01:00Z",
      },
      // A StatusContext has no databaseId, so it gets a negative stand-in.
      // The array index used to be the stand-in, which collided head-on with
      // the CheckRun above whose real databaseId is 1.
      { id: -2, name: "vercel", status: "completed", conclusion: "failure", url: "https://vercel.test/1" },
      { id: -3, name: "netlify", status: "in_progress", conclusion: null },
    ]);
  });

  it("cannot give two checks on one pull request the same id", () => {
    // Duplicate ids inside one list break every consumer that keys on them:
    // a React list, a dedupe, a "which check failed" lookup.
    const contexts = (nodes: unknown[]) => ({
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] },
    });

    // Real database ids that sit exactly where the positional fallback used to
    // put the id-less entries.
    const pr = map(
      contexts([
        { __typename: "StatusContext", context: "vercel", state: "SUCCESS" },
        { __typename: "CheckRun", databaseId: 0, name: "zero", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", databaseId: 1, name: "one", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "StatusContext", context: "netlify", state: "SUCCESS" },
        { __typename: "CheckRun", databaseId: 2, name: "two", status: "COMPLETED", conclusion: "SUCCESS" },
      ]),
    );

    const ids = pr.checks.map((c) => c.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    // Every stand-in is negative, so it can never meet a real databaseId.
    expect(ids.filter((id) => id < 0)).toEqual([-1, -4]);
  });

  it("gives a review with no database id a stand-in that cannot be mistaken for one", () => {
    const pr = map({
      latestReviews: {
        nodes: [
          { state: "COMMENTED", submittedAt: null, author: null },
          { databaseId: 44, state: "APPROVED", submittedAt: null, author: null },
        ],
      },
    });
    expect(pr.reviews.map((r) => r.id)).toEqual([-1, 44]);
    expect(atIndex(pr.reviews, 0).submittedAt).toBeUndefined();
  });

  it("counts only unresolved, current review threads as blockers", () => {
    // An outdated thread is one whose code changed underneath it. GitHub does
    // not require resolving those to merge, so counting them would report a
    // block that does not exist.
    const pr = map({
      reviewThreads: {
        nodes: [
          { isResolved: false, isOutdated: false },
          { isResolved: false, isOutdated: true },
          { isResolved: true, isOutdated: false },
          null,
        ],
      },
    });
    expect(pr.unresolvedThreads).toBe(1);
  });

  it("survives a deleted author and a pull request with no database id", () => {
    const pr = map({ author: null, databaseId: null, assignees: { nodes: [null] } });
    expect(pr.author).toBeUndefined();
    expect(pr.id).toBe(0);
    expect(pr.assignees).toEqual([]);
  });

  it("maps requested reviewers and drops ones GitHub would not name", () => {
    const pr = map({
      reviewRequests: {
        nodes: [
          { requestedReviewer: { login: "gaveen", databaseId: 12 } },
          { requestedReviewer: null },
          null,
        ],
      },
    });
    expect(pr.requestedReviewers).toEqual([{ id: 12, login: "gaveen" }]);
  });

  it("tolerates a pull request with no commit rollup at all", () => {
    expect(map({ commits: { nodes: [] } }).checks).toEqual([]);
    expect(
      map({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }).checks,
    ).toEqual([]);
  });
});

describe("the CI log excerpt", () => {
  const timestamped = (lines: string[]) =>
    lines.map((l, i) => `2026-08-26T09:00:${String(i).padStart(2, "0")}.1234567Z ${l}`).join("\n");

  const realisticLog = timestamped([
    "##[group]Run npm test",
    "npm test",
    "shell: /usr/bin/bash -e {0}",
    "##[endgroup]",
    "> luminary-console@1.0.0 test",
    "> vitest run",
    "",
    " FAIL  tests/money.test.ts > rounds a half cent up",
    "AssertionError: expected 2.5 to be 3",
    "    at tests/money.test.ts:42:5",
    "##[error]Process completed with exit code 1.",
  ]);

  it("finds the failure and gives it five lines of lead-in", () => {
    // The lead-in is what tells the operator which test and which file, so an
    // excerpt that starts exactly at the error line is much less useful.
    const excerpt = extractFailure(realisticLog);
    expect(excerpt).not.toBeNull();
    const lines = (excerpt ?? "").split("\n");
    // The FAIL marker is at index 7, so the window opens at index 2.
    expect(atIndex(lines, 0)).toBe("shell: /usr/bin/bash -e {0}");
    expect(excerpt).toContain("AssertionError: expected 2.5 to be 3");
    expect(excerpt).toContain("##[error]Process completed with exit code 1.");
    // The very first line, before the window, is dropped.
    expect(excerpt).not.toContain("##[group]Run npm test");
  });

  it("strips the timestamp Actions puts on every line", () => {
    // Those prefixes are half the width of the panel and carry nothing.
    const excerpt = extractFailure(realisticLog) ?? "";
    expect(excerpt).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("honours the line cap so a huge log cannot fill the panel", () => {
    // The window is the lead-in plus whatever the cap still allows, so a cap
    // of eight stops before the log's last line.
    const excerpt = extractFailure(realisticLog, 8) ?? "";
    expect(excerpt.split("\n")).toHaveLength(8);
    expect(excerpt).toContain("AssertionError: expected 2.5 to be 3");
    expect(excerpt).not.toContain("##[error]Process completed with exit code 1.");
  });

  it("keeps the failing line even when the cap is smaller than the lead-in", () => {
    // The lead-in is context, not the point. A cap of three used to be spent
    // entirely on lines before the failure, so the excerpt showed setup and
    // never the error it existed to show.
    const excerpt = extractFailure(realisticLog, 3) ?? "";
    const lines = excerpt.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines).toContain(" FAIL  tests/money.test.ts > rounds a half cent up");
    // Two lines of lead-in still survive, so the marker is not stranded at the
    // very top with no context at all.
    expect(atIndex(lines, 2)).toBe(" FAIL  tests/money.test.ts > rounds a half cent up");
  });

  it.each([
    ["npm ERR! code ELIFECYCLE", "npm ERR! code ELIFECYCLE"],
    ["Traceback (most recent call last):", "Traceback (most recent call last):"],
    ["error: unable to resolve module", "error: unable to resolve module"],
    ["Uncaught TypeException: boom", "Uncaught TypeException: boom"],
    ["The job failed with exit code 2", "The job failed with exit code 2"],
  ])("recognises %s as the start of the failure", (marker, expected) => {
    const log = ["setting up", "still fine", marker, "after"].join("\n");
    const excerpt = extractFailure(log) ?? "";
    expect(excerpt).toContain(expected);
  });

  it("does not treat a zero exit code as a failure marker", () => {
    // "exit code 0" is the success line; matching it would point the excerpt
    // at the wrong place in a log that failed later.
    const log = ["step one finished with exit code 0", "step two ok", "all green"].join("\n");
    const excerpt = extractFailure(log, 2) ?? "";
    // No marker matched, so this is the tail, not a window around line 0.
    expect(excerpt).toBe("step two ok\nall green");
  });

  it("falls back to the tail when nothing looks like an error", () => {
    // A failure is almost always near the end, so the tail beats nothing.
    const log = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? "" : `line ${i}`)).join("\n");
    const excerpt = extractFailure(log, 4) ?? "";
    expect(excerpt.split("\n")).toEqual(["line 56", "line 57", "line 58", "line 59"]);
    // Blank lines are dropped from the tail rather than padding it out.
    expect(excerpt).not.toContain("\n\n");
  });

  it("returns null for an empty or blank log", () => {
    expect(extractFailure("")).toBeNull();
    expect(extractFailure("   \n\n\t  \n")).toBeNull();
  });

  it("fetches a job log and reduces it", async () => {
    onRead(/\/actions\/jobs\/88\/logs$/, () => realisticLog);
    const excerpt = await fetchJobFailureExcerpt(REPO, 88);
    expect(excerpt).toContain("AssertionError");
    // Raw text, and no conditional request: a log blob has no useful ETag.
    expect(atIndex(transport.ghData.mock.calls, 0)).toEqual([
      `/repos/${REPO}/actions/jobs/88/logs`,
      { accept: "text/plain", conditional: false },
    ]);
  });

  it.each([404, 410])("treats an expired log (%i) as nothing to show", async (status) => {
    // Logs age out of GitHub's retention window; that is normal on an old run
    // and must not surface as an error.
    onRead(/\/logs$/, (path) => {
      throw new GitHubError("Gone", status, path);
    });
    expect(await fetchJobFailureExcerpt(REPO, 88)).toBeNull();
  });

  it("raises a 500 while fetching a log", async () => {
    onRead(/\/logs$/, (path) => {
      throw new GitHubError("Server Error", 500, path);
    });
    await expect(fetchJobFailureExcerpt(REPO, 88)).rejects.toMatchObject({ status: 500 });
  });

  it("returns null when the log endpoint answers with something that is not text", async () => {
    onRead(/\/logs$/, () => ({ message: "not a log" }));
    expect(await fetchJobFailureExcerpt(REPO, 88)).toBeNull();
  });
});

describe("the pull request diff", () => {
  it("returns the diff untruncated when it fits", async () => {
    const diff = "diff --git a/x b/x\n+one line\n";
    onRead(/^\/repos\/.+\/pulls\/7$/, () => diff);
    expect(await fetchPullRequestDiff(REPO, 7)).toEqual({ diff, truncated: false });
    expect(atIndex(transport.ghData.mock.calls, 0)).toEqual([
      `/repos/${REPO}/pulls/7`,
      { accept: "application/vnd.github.diff", conditional: false },
    ]);
  });

  it("truncates an oversized diff and says so", async () => {
    // The flag is what lets the UI tell the operator they are not looking at
    // the whole change, which matters before they approve it.
    onRead(/^\/repos\/.+\/pulls\/7$/, () => "x".repeat(500));
    const result = await fetchPullRequestDiff(REPO, 7, 100);
    expect(result?.truncated).toBe(true);
    expect(result?.diff).toBe("x".repeat(100));
  });

  it("caps a multi-byte diff at the true byte count, not the character count", async () => {
    // The cap is measured in bytes, so it has to be cut in bytes. Cutting with
    // String.slice counts UTF-16 code units, which let a diff of Sinhala or
    // CJK text past a 2 MB cap at up to 4 MB: exactly the payload the cap
    // exists to prevent.
    const diff = "ක".repeat(1000);
    expect(Buffer.byteLength(diff, "utf8")).toBe(3000);
    onRead(/^\/repos\/.+\/pulls\/7$/, () => diff);

    const result = await fetchPullRequestDiff(REPO, 7, 300);
    expect(result?.truncated).toBe(true);
    expect(Buffer.byteLength(result?.diff ?? "", "utf8")).toBeLessThanOrEqual(300);
    // The cut lands on a character boundary rather than leaving a broken code
    // point at the end.
    expect(result?.diff).toBe("ක".repeat(100));
  });

  it("drops a character the byte window cut in half", async () => {
    // 301 bytes is 100 whole characters plus one stray byte of the 101st.
    const diff = "ක".repeat(1000);
    onRead(/^\/repos\/.+\/pulls\/7$/, () => diff);

    const result = await fetchPullRequestDiff(REPO, 7, 301);
    expect(result?.diff).toBe("ක".repeat(100));
    // No U+FFFD left behind, which is what a decoder leaves where it found
    // half a character.
    expect(result?.diff).not.toContain("�");
  });

  it("returns null when GitHub refuses to render the diff", async () => {
    // 406 is GitHub's answer for a diff past its own size limit.
    onRead(/^\/repos\/.+\/pulls\/7$/, (path) => {
      throw new GitHubError("Not Acceptable", 406, path);
    });
    expect(await fetchPullRequestDiff(REPO, 7)).toBeNull();
  });

  it("raises a 500 from a diff read", async () => {
    onRead(/^\/repos\/.+\/pulls\/7$/, (path) => {
      throw new GitHubError("Server Error", 500, path);
    });
    await expect(fetchPullRequestDiff(REPO, 7)).rejects.toMatchObject({ status: 500 });
  });

  it("returns null when the diff comes back as JSON instead of text", async () => {
    onRead(/^\/repos\/.+\/pulls\/7$/, () => ({ message: "not a diff" }));
    expect(await fetchPullRequestDiff(REPO, 7)).toBeNull();
  });
});
