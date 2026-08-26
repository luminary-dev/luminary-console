// @vitest-environment jsdom
// The GitHub console screens beyond the pull request inbox.
//
// Five things here are load-bearing enough to gate a merge on.
//
// 1. Flaky and broken are different diagnoses with opposite fixes, and the UI
//    has to say which one it is. Collapsing them into "failing" is what trains
//    a team to re-run red checks until they go green.
// 2. A metric with no sample must read "not enough data". Printing 0 for an
//    absent value is a lie the reader cannot detect.
// 3. No screen carries a per-person metric. That is a binding constraint from
//    docs/adr/0002-team-health-not-individual-scoreboards.md, not a style
//    preference, so it is tested rather than trusted.
// 4. A leaked secret sorts above everything else, including a critical
//    dependency advisory: it is already in someone else's hands.
// 5. No status is carried by colour alone. Every icon is decorative and paired
//    with the same fact in words.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AlertEntity,
  DeploymentEntity,
  PullRequestEntity,
  RepoEntity,
  WorkflowRunEntity,
} from "@/lib/github/entities";
import { buildInsights, type FlakeStat } from "@/lib/github/insights";
import { atIndex } from "./helpers";
import AlertList, { sortAlerts } from "@/components/github/AlertList";
import GithubNav, { GITHUB_SECTIONS, GithubEmpty } from "@/components/github/GithubNav";
import InsightPanel, {
  DurationTable,
  FlakeLeaderboard,
} from "@/components/github/InsightPanel";
import RepoHealth, { repoHealthRows } from "@/components/github/RepoHealth";

// The deployment screen's grouping helpers are imported from the page module,
// which pulls in the console's client chrome; those hooks need a router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/github/deployments",
}));

afterEach(cleanup);

// vitest runs from the repository root, and under jsdom import.meta.url is not
// a file URL, so the source-level gates below resolve from the cwd.
const REPO_ROOT = process.cwd();
const sourceOf = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");
const NOW = Date.parse("2026-08-26T12:00:00.000Z");

// === fixtures ===

function repo(overrides: Partial<RepoEntity> = {}): RepoEntity {
  return {
    id: 1,
    name: "console",
    fullName: "luminary-dev/console",
    private: true,
    archived: false,
    defaultBranch: "main",
    language: "TypeScript",
    license: "MIT",
    pushedAt: "2026-08-25T09:00:00.000Z",
    url: "https://github.com/luminary-dev/console",
    syncedAt: "2026-08-26T09:00:00.000Z",
    ...overrides,
  };
}

function pr(overrides: Partial<PullRequestEntity> = {}): PullRequestEntity {
  return {
    id: 1,
    repo: "luminary-dev/console",
    number: 7,
    title: "Add a thing",
    state: "open",
    draft: false,
    author: { id: 10, login: "dhanika" },
    assignees: [],
    requestedReviewers: [],
    labels: [],
    headRef: "feat/thing",
    headSha: "abc1234def567",
    baseRef: "main",
    fromFork: false,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-25T09:00:00.000Z",
    mergeable: true,
    url: "https://github.com/luminary-dev/console/pull/7",
    reviews: [],
    checks: [],
    syncedAt: "2026-08-26T09:00:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRunEntity> = {}): WorkflowRunEntity {
  return {
    id: 100,
    repo: "luminary-dev/console",
    name: "build",
    headSha: "abc1234",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-25T09:00:00.000Z",
    updatedAt: "2026-08-25T09:05:00.000Z",
    durationMs: 300_000,
    ...overrides,
  };
}

/** Fixture overrides. Explicit `undefined` is meaningful here: a secret
 *  scanning alert genuinely has no severity, so the fixture must be able to
 *  CLEAR the default rather than only replace it. Partial<AlertEntity> under
 *  exactOptionalPropertyTypes rejects an explicit undefined, which would
 *  silently leave the default "critical" in place and make the sort test
 *  prove nothing. */
type AlertOverrides = Omit<Partial<AlertEntity>, "severity"> & { severity?: string | undefined };

function alert(overrides: AlertOverrides = {}): AlertEntity {
  const { severity, ...rest } = {
    repo: "luminary-dev/console",
    kind: "dependabot" as AlertEntity["kind"],
    number: 1,
    state: "open",
    severity: "critical" as string | undefined,
    title: "Critical advisory in a dependency",
    createdAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
  // An override of `severity: undefined` means the alert carries no severity,
  // which is an ABSENT property rather than a present undefined one.
  return { ...rest, ...(severity !== undefined ? { severity } : {}) };
}

const flake = (overrides: Partial<FlakeStat> = {}): FlakeStat => ({
  name: "unit tests",
  runs: 10,
  failures: 4,
  failureRate: 0.4,
  flaky: true,
  ...overrides,
});

/** Every icon must be decorative and sit beside the same fact in words. */
function noBareIcons(container: HTMLElement) {
  const icons = [...container.querySelectorAll("svg")];
  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) {
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    const words = icon.parentElement?.textContent?.trim() ?? "";
    expect(words.length).toBeGreaterThan(0);
  }
}

/** The value rendered for a labelled metric, read the way a reader sees it. */
function metricValue(label: string): string {
  const term = screen.getByText(label);
  return term.nextElementSibling?.textContent?.trim() ?? "";
}

// === flaky versus broken ===

describe("flaky versus broken", () => {
  const flakes = [
    flake({ name: "flaky-suite", flaky: true, failures: 4, failureRate: 0.4 }),
    flake({ name: "broken-build", flaky: false, failures: 10, failureRate: 1 }),
  ];

  it("diagnoses each one by name rather than calling both failing", () => {
    render(<FlakeLeaderboard flakes={flakes} />);
    expect(screen.getByText("Flaky")).toBeTruthy();
    expect(screen.getByText("Broken")).toBeTruthy();
  });

  it("gives them different actions, because re-running fixes neither", () => {
    render(<FlakeLeaderboard flakes={flakes} />);
    const flaky = screen.getByRole("row", { name: /flaky-suite/ });
    const broken = screen.getByRole("row", { name: /broken-build/ });

    expect(within(flaky).getByText(/Quarantine or fix the test/)).toBeTruthy();
    expect(within(flaky).getByText(/passed and failed on the same commit/i)).toBeTruthy();
    expect(within(broken).getByText(/Fails consistently/)).toBeTruthy();
    expect(within(broken).getByText(/Re-running will not turn it green/)).toBeTruthy();
  });

  it("draws them in different tones, and never in tone alone", () => {
    const { container } = render(<FlakeLeaderboard flakes={flakes} />);
    const flaky = screen.getByRole("row", { name: /flaky-suite/ });
    const broken = screen.getByRole("row", { name: /broken-build/ });

    expect(flaky.querySelector(".gh-status.is-warn")).not.toBeNull();
    expect(broken.querySelector(".gh-status.is-bad")).not.toBeNull();
    // The words carry it too, so the tone is a reinforcement and not the fact.
    noBareIcons(container);
  });

  it("says so plainly when no check has failed at all", () => {
    render(<FlakeLeaderboard flakes={[]} />);
    expect(screen.getByText(/No check has failed in the stored run history/)).toBeTruthy();
  });
});

// === absent metrics say so ===

describe("insights never print 0 for an absent metric", () => {
  it("renders 'not enough data' for every null, and a real 0 for a real zero", () => {
    // No pull requests and no runs at all: every percentile is null, but the
    // throughput counts are genuinely zero.
    render(<InsightPanel insights={buildInsights([], [], NOW)} />);

    expect(metricValue("Open to merge, median")).toBe("not enough data");
    expect(metricValue("Open to merge, p90")).toBe("not enough data");
    expect(metricValue("Open to first review, median")).toBe("not enough data");
    expect(metricValue("Open to first review, p90")).toBe("not enough data");
    expect(metricValue("Oldest wait")).toBe("not enough data");
    expect(metricValue("Median lines changed")).toBe("not enough data");

    // Counted, not sampled: zero merged really is zero merged.
    expect(metricValue("Merged")).toBe("0");
    expect(metricValue("Opened")).toBe("0");
    expect(metricValue("Waiting on review")).toBe("0");
  });

  it("keeps the median absent when line counts were never synced", () => {
    // additions and deletions absent means the projection came from the list
    // endpoint, which omits them. Counting those as zero would fake a pile of
    // tiny pull requests.
    const merged = pr({ state: "merged", mergedAt: "2026-08-24T09:00:00.000Z" });
    render(<InsightPanel insights={buildInsights([merged], [], NOW)} />);
    expect(metricValue("Median lines changed")).toBe("not enough data");
    expect(metricValue("Open to merge, median")).not.toBe("not enough data");
  });

  it("says 'not enough data' rather than an empty duration table", () => {
    render(<DurationTable durations={[]} />);
    expect(screen.getByText(/not enough data to trend yet/)).toBeTruthy();
  });
});

// === no per-person metric, ever ===

describe("no screen carries a per-person metric", () => {
  it("names no author anywhere on the insights panel", () => {
    const prs = [
      pr({ number: 1, author: { id: 1, login: "dhanika" }, state: "merged", mergedAt: "2026-08-24T09:00:00.000Z", additions: 40, deletions: 5 }),
      pr({ number: 2, author: { id: 2, login: "gaveen" }, state: "merged", mergedAt: "2026-08-25T09:00:00.000Z", additions: 900, deletions: 20 }),
      pr({ number: 3, author: { id: 3, login: "shash" } }),
    ];
    const { container } = render(<InsightPanel insights={buildInsights(prs, [run()], NOW)} />);
    const text = container.textContent ?? "";

    for (const login of ["dhanika", "gaveen", "shash"]) {
      expect(text.includes(login)).toBe(false);
    }
    // And it says out loud that the omission is a decision.
    expect(screen.getByText(/no per-person metric here and there will not be one/i)).toBeTruthy();
  });

  it("keeps the only leaderboard pointed at checks, not people", () => {
    render(<FlakeLeaderboard flakes={[flake({ name: "unit tests" })]} />);
    const row = screen.getByRole("row", { name: /unit tests/ });
    // The row header is the check name: the subject of the ranking.
    expect(within(row).getByRole("rowheader").textContent).toContain("unit tests");
  });

  it("keeps person-shaped identifiers out of the metric surfaces entirely", () => {
    // A source-level gate, because the cheap way to reintroduce a scoreboard
    // is to add one column to a table that already aggregates.
    for (const file of [
      "components/github/InsightPanel.tsx",
      "components/github/RepoHealth.tsx",
    ]) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/\.login\b/);
      expect(source).not.toMatch(/\.author\b/);
      expect(source).not.toMatch(/\bcreator\b/);
    }
  });

  it("shows repository health without an author column", () => {
    const rows = repoHealthRows([repo()], [pr()], [run()], []);
    render(<RepoHealth rows={rows} now={NOW} />);
    expect(screen.queryByRole("columnheader", { name: /author/i })).toBeNull();
    expect(screen.queryByText("dhanika")).toBeNull();
  });
});

// === leaked secrets outrank everything ===

describe("secret scanning sorts to the top", () => {
  const leaked = alert({
    kind: "secret_scanning",
    number: 9,
    title: "GitHub personal access token committed",
    // No severity: secret scanning does not rate them, and that must not push
    // it below a scored advisory.
    severity: undefined,
  });
  const critical = alert({ kind: "dependabot", number: 1, severity: "critical" });
  const codeScan = alert({
    kind: "code_scanning",
    number: 2,
    severity: "high",
    title: "Possible injection",
  });

  it("puts an open leaked secret above an open critical advisory", () => {
    const sorted = sortAlerts([critical, codeScan, leaked]);
    expect(atIndex(sorted, 0).kind).toBe("secret_scanning");
    expect(atIndex(sorted, 1).severity).toBe("critical");
  });

  it("does not let a CLOSED secret alert outrank anything still open", () => {
    const closedSecret = { ...leaked, state: "resolved" };
    const sorted = sortAlerts([closedSecret, critical]);
    expect(atIndex(sorted, 0).kind).toBe("dependabot");
    expect(atIndex(sorted, 1).state).toBe("resolved");
  });

  it("renders the leaked secret in the first row and calls it out above the table", () => {
    const { container } = render(<AlertList alerts={[critical, codeScan, leaked]} />);

    const rows = screen.getAllByRole("row");
    // rows[0] is the header row.
    expect(atIndex(rows, 1).textContent).toContain("GitHub personal access token committed");
    expect(screen.getByText(/1 leaked secret to revoke now/)).toBeTruthy();
    expect(screen.getByText(/revoke and rotate first/i)).toBeTruthy();
    noBareIcons(container);
  });

  it("labels a secret alert's missing severity rather than leaving the cell blank", () => {
    render(<AlertList alerts={[leaked]} />);
    expect(screen.getByText("leaked secret")).toBeTruthy();
  });

  it("does not shout when no secret is open", () => {
    const { container } = render(<AlertList alerts={[critical]} />);
    expect(container.querySelector(".gh-urgent")).toBeNull();
    expect(screen.queryByText(/to revoke now/)).toBeNull();
  });
});

// === status is never colour alone ===

describe("every status has words beside its icon", () => {
  it("spells out CI pass rate and alert counts on the repository table", () => {
    const rows = repoHealthRows(
      [repo(), repo({ id: 2, name: "site", fullName: "luminary-dev/site" })],
      [pr()],
      [
        run({ id: 1, conclusion: "success" }),
        run({ id: 2, conclusion: "failure" }),
        run({ id: 3, conclusion: "success" }),
      ],
      [alert()],
    );
    const { container } = render(<RepoHealth rows={rows} now={NOW} />);

    expect(screen.getByText("67% passed, 3 runs")).toBeTruthy();
    expect(screen.getByText("1 open")).toBeTruthy();
    expect(screen.getByText("none open")).toBeTruthy();
    noBareIcons(container);
  });

  it("says 'not enough data' for a repository with no decided run", () => {
    const rows = repoHealthRows([repo()], [], [run({ conclusion: "cancelled" })], []);
    // A cancelled run is excluded from both sides of the fraction, so the rate
    // is unknown rather than zero.
    expect(atIndex(rows, 0).passRate).toBeNull();
    render(<RepoHealth rows={rows} now={NOW} />);
    expect(screen.getByText("not enough data")).toBeTruthy();
  });

  it("exposes aria-sort on the column it sorted", async () => {
    const user = userEvent.setup();
    const rows = repoHealthRows(
      [repo(), repo({ id: 2, name: "site", fullName: "luminary-dev/site" })],
      [],
      [],
      [],
    );
    render(<RepoHealth rows={rows} now={NOW} />);

    const header = screen.getByRole("columnheader", { name: /Open PRs/ });
    expect(header.getAttribute("aria-sort")).toBe("none");
    await user.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("descending");
    await user.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
  });
});

// === section navigation ===

describe("section navigation", () => {
  it("marks exactly one link as the current page", () => {
    const { container } = render(<GithubNav current="/github/security" />);
    const marked = [...container.querySelectorAll("[aria-current]")];
    expect(marked).toHaveLength(1);
    expect(atIndex(marked, 0).textContent).toBe("Security");
  });

  it("links every section, including the pull request inbox", () => {
    render(<GithubNav current="/github/repos" />);
    for (const section of GITHUB_SECTIONS) {
      expect(screen.getByRole("link", { name: section.label }).getAttribute("href")).toBe(
        section.href,
      );
    }
  });

  it("appears on every screen it belongs to, marked with that screen's own href", () => {
    // The nav is server rendered per page, so the marking is a source fact.
    const pages: [string, string][] = [
      ["app/github/repos/page.tsx", "/github/repos"],
      ["app/github/ci/page.tsx", "/github/ci"],
      ["app/github/deployments/page.tsx", "/github/deployments"],
      ["app/github/releases/page.tsx", "/github/releases"],
      ["app/github/security/page.tsx", "/github/security"],
      ["app/github/insights/page.tsx", "/github/insights"],
      ["app/github/activity/page.tsx", "/github/activity"],
    ];
    for (const [file, href] of pages) {
      const source = sourceOf(file);
      expect(source).toContain(`<GithubNav current="${href}" />`);
      // Exactly one h1 per page, which is the heading-order rule that is
      // easiest to break by copying a section between screens.
      expect(source.match(/className="gh-h1"/g) ?? []).toHaveLength(1);
    }
  });
});

// === empty states name the first action ===

describe("empty states", () => {
  it("distinguishes an unconfigured GitHub from an unsynced one", () => {
    const { unmount } = render(
      <GithubEmpty title="No deployments stored yet" configured={false}>
        Run a backfill to pull recent deployments in.
      </GithubEmpty>,
    );
    expect(screen.getByText(/No GitHub credential is configured/)).toBeTruthy();
    expect(screen.getByText("GITHUB_APP_ID")).toBeTruthy();
    unmount();

    render(
      <GithubEmpty title="No deployments stored yet" configured>
        Run a backfill to pull recent deployments in.
      </GithubEmpty>,
    );
    expect(screen.getByText(/no backfill has run/)).toBeTruthy();
    expect(screen.queryByText(/No GitHub credential is configured/)).toBeNull();
  });
});

// === release notes are never rendered as markup ===

describe("release notes are plain text", () => {
  it("keeps the untrusted body out of the HTML parser", () => {
    // Not a render test: the page renders {release.body} as a text child, and
    // this asserts nothing on the release screen ever reaches for the escape
    // hatch that would change that.
    const source = sourceOf("app/github/releases/page.tsx");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    // The body is a text child of a pre-wrap block, so the line breaks survive
    // without anything being parsed as markup.
    expect(source).toContain("{release.body}");
    expect(source).toContain('className="gh-release-body"');
    expect(sourceOf("components/github/github-views.css")).toMatch(
      /\.gh-release-body\s*\{[^}]*white-space:\s*pre-wrap/,
    );
  });

  it("never reaches for the HTML escape hatch anywhere in these screens", () => {
    for (const file of [
      "app/github/repos/page.tsx",
      "app/github/ci/page.tsx",
      "app/github/deployments/page.tsx",
      "app/github/releases/page.tsx",
      "app/github/security/page.tsx",
      "app/github/insights/page.tsx",
      "app/github/activity/page.tsx",
      "components/github/AlertList.tsx",
      "components/github/GithubNav.tsx",
      "components/github/InsightPanel.tsx",
      "components/github/RepoHealth.tsx",
    ]) {
      expect(sourceOf(file)).not.toContain("dangerouslySetInnerHTML");
    }
  });
});

// === deployments make a failure unmissable ===

describe("deployments", () => {
  it("has no per-environment ambiguity about what is live after a failure", async () => {
    const { deploymentFailed, groupByEnvironment } = await import(
      "@/app/github/deployments/page"
    );
    const live: DeploymentEntity = {
      id: 1,
      repo: "luminary-dev/console",
      environment: "production",
      ref: "v1.2.0",
      sha: "aaaaaaabbbb",
      state: "success",
      createdAt: "2026-08-24T09:00:00.000Z",
      creator: { id: 1, login: "dhanika" },
    };
    const failed: DeploymentEntity = {
      ...live,
      id: 2,
      ref: "v1.3.0",
      sha: "cccccccdddd",
      state: "failure",
      createdAt: "2026-08-25T09:00:00.000Z",
    };

    const group = atIndex(groupByEnvironment([live, failed]), 0);
    // The newest deployment failed, so it is NOT what is live: the previous
    // success still is, and the screen has to be able to say both.
    expect(group.latest.ref).toBe("v1.3.0");
    expect(group.live?.ref).toBe("v1.2.0");
    expect(deploymentFailed(group.latest)).toBe(true);
    expect(group.live ? deploymentFailed(group.live) : true).toBe(false);
  });
});
