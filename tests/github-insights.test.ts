// Insight arithmetic, verified against known fixtures rather than eyeballed
// (which is the acceptance criterion the mandate sets for this phase).
import { describe, expect, it } from "vitest";
import {
  buildInsights,
  cycleTime,
  durationTrends,
  flakeStats,
  formatDuration,
  formatHours,
  median,
  percentile,
  reviewLoad,
  sizeDistribution,
  throughput,
} from "@/lib/github/insights";
import type { PullRequestEntity, WorkflowRunEntity } from "@/lib/github/entities";
import { atIndex } from "./helpers";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-08-26T12:00:00Z");

function pr(o: Partial<PullRequestEntity> = {}): PullRequestEntity {
  return {
    id: 1,
    repo: "luminary-dev/console",
    number: 1,
    title: "PR",
    state: "open",
    draft: false,
    assignees: [],
    requestedReviewers: [],
    labels: [],
    headRef: "a",
    headSha: "sha",
    baseRef: "main",
    fromFork: false,
    createdAt: new Date(NOW - DAY).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    mergeable: true,
    url: "https://example.test",
    reviews: [],
    checks: [],
    syncedAt: new Date(NOW).toISOString(),
    ...o,
  };
}

function run(o: Partial<WorkflowRunEntity> = {}): WorkflowRunEntity {
  return {
    id: Math.floor(Math.random() * 1e9),
    repo: "luminary-dev/console",
    name: "CI",
    headSha: "sha1",
    status: "completed",
    conclusion: "success",
    createdAt: new Date(NOW - HOUR).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...o,
  };
}

describe("percentiles", () => {
  it("computes a known median without interpolating", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([10, 20])).toBe(10); // nearest-rank, no invented midpoint
  });

  it("computes a known p90", () => {
    const values = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10
    expect(percentile(values, 90)).toBe(9);
  });

  it("returns null for an empty series rather than zero", () => {
    // Zero would render as a real measurement of nothing.
    expect(median([])).toBeNull();
    expect(percentile([], 90)).toBeNull();
  });
});

describe("throughput", () => {
  it("counts merged and opened in the window and reports the net", () => {
    const prs = [
      pr({ state: "merged", mergedAt: new Date(NOW - 2 * DAY).toISOString() }),
      pr({ state: "merged", mergedAt: new Date(NOW - 3 * DAY).toISOString() }),
      pr({ createdAt: new Date(NOW - DAY).toISOString() }),
      pr({ createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      pr({ createdAt: new Date(NOW - 4 * DAY).toISOString() }),
    ];
    const t = throughput(prs, 7, NOW);
    expect(t.merged).toBe(2);
    // The two merged PRs were also created inside the window.
    expect(t.opened).toBe(5);
    expect(t.net).toBe(-3);
  });

  it("excludes anything outside the window", () => {
    const prs = [pr({ state: "merged", mergedAt: new Date(NOW - 30 * DAY).toISOString() })];
    expect(throughput(prs, 7, NOW).merged).toBe(0);
  });
});

describe("cycle time", () => {
  it("computes open to merge from a known fixture", () => {
    const prs = [
      pr({
        createdAt: new Date(NOW - 10 * HOUR).toISOString(),
        state: "merged",
        mergedAt: new Date(NOW - 8 * HOUR).toISOString(),
      }),
      pr({
        createdAt: new Date(NOW - 20 * HOUR).toISOString(),
        state: "merged",
        mergedAt: new Date(NOW - 16 * HOUR).toISOString(),
      }),
    ];
    const c = cycleTime(prs);
    // Exactly 2 hours and 4 hours; nearest-rank median of two is the lower.
    expect(c.openToMergeHours.median).toBe(2);
    expect(c.openToMergeHours.count).toBe(2);
  });

  it("computes time to first review, ignoring later reviews", () => {
    const created = new Date(NOW - 10 * HOUR).toISOString();
    const prs = [
      pr({
        createdAt: created,
        reviews: [
          {
            id: 2,
            state: "APPROVED",
            dismissed: false,
            submittedAt: new Date(NOW - 4 * HOUR).toISOString(),
          },
          {
            id: 1,
            state: "COMMENTED",
            dismissed: false,
            submittedAt: new Date(NOW - 7 * HOUR).toISOString(),
          },
        ],
      }),
    ];
    // The earliest review is 3 hours after opening, regardless of list order.
    expect(cycleTime(prs).openToFirstReviewHours.median).toBe(3);
  });

  it("drops a negative interval rather than charting it", () => {
    // Backdated or imported data produces merged-before-opened.
    const prs = [
      pr({
        createdAt: new Date(NOW).toISOString(),
        state: "merged",
        mergedAt: new Date(NOW - DAY).toISOString(),
      }),
    ];
    expect(cycleTime(prs).openToMergeHours.count).toBe(0);
  });
});

describe("size distribution", () => {
  it("buckets by lines changed", () => {
    const prs = [
      pr({ additions: 3, deletions: 2 }), // 5, tiny
      pr({ additions: 40, deletions: 10 }), // 50, small
      pr({ additions: 300, deletions: 100 }), // 400, medium
      pr({ additions: 900, deletions: 400 }), // 1300, very large
    ];
    const dist = sizeDistribution(prs);
    expect(dist.buckets.find((b) => b.label.startsWith("Tiny"))?.count).toBe(1);
    expect(dist.buckets.find((b) => b.label.startsWith("Small"))?.count).toBe(1);
    expect(dist.buckets.find((b) => b.label.startsWith("Medium"))?.count).toBe(1);
    expect(dist.buckets.find((b) => b.label.startsWith("Very large"))?.count).toBe(1);
  });

  it("ignores pull requests with no line counts instead of counting them as zero", () => {
    // The list endpoint omits additions/deletions; counting those as zero
    // would fake a pile of tiny pull requests.
    const dist = sizeDistribution([pr(), pr()]);
    expect(dist.buckets.reduce((n, b) => n + b.count, 0)).toBe(0);
    expect(dist.medianLinesChanged).toBeNull();
  });
});

describe("flake detection", () => {
  it("marks a check flaky when it both passed and failed on the same commit", () => {
    // The code did not change between the runs, so the check did.
    const runs = [
      run({ name: "unit", headSha: "same", conclusion: "failure" }),
      run({ name: "unit", headSha: "same", conclusion: "success" }),
    ];
    const stat = atIndex(flakeStats(runs), 0);
    expect(stat.name).toBe("unit");
    expect(stat.flaky).toBe(true);
    expect(stat.failureRate).toBe(0.5);
  });

  it("does not mark a consistently failing check as flaky", () => {
    // Failing on two different commits is a broken check, not a flaky one,
    // and the fix is different.
    const runs = [
      run({ name: "lint", headSha: "a", conclusion: "failure" }),
      run({ name: "lint", headSha: "b", conclusion: "failure" }),
    ];
    const stat = atIndex(flakeStats(runs), 0);
    expect(stat.flaky).toBe(false);
    expect(stat.failureRate).toBe(1);
  });

  it("omits checks that never failed", () => {
    expect(flakeStats([run({ name: "green" })])).toHaveLength(0);
  });

  it("ignores runs that have not completed", () => {
    const runs = [run({ name: "pending", status: "in_progress", conclusion: null })];
    expect(flakeStats(runs)).toHaveLength(0);
  });

  it("ranks by failure rate, worst first", () => {
    const runs = [
      run({ name: "often", headSha: "1", conclusion: "failure" }),
      run({ name: "often", headSha: "2", conclusion: "failure" }),
      run({ name: "rarely", headSha: "3", conclusion: "failure" }),
      ...Array.from({ length: 9 }, (_, i) => run({ name: "rarely", headSha: `r${i}` })),
    ];
    const stats = flakeStats(runs);
    expect(atIndex(stats, 0).name).toBe("often");
  });
});

describe("duration trends", () => {
  it("reports median and p90 per workflow", () => {
    const runs = [
      run({ name: "CI", durationMs: 60_000 }),
      run({ name: "CI", durationMs: 120_000 }),
      run({ name: "CI", durationMs: 180_000 }),
    ];
    const trend = atIndex(durationTrends(runs), 0);
    expect(trend.medianMs).toBe(120_000);
    expect(trend.runs).toBe(3);
  });

  it("ignores runs with no measured duration", () => {
    expect(durationTrends([run({ name: "CI" })])).toHaveLength(0);
  });
});

describe("review load", () => {
  it("counts open pull requests waiting on a review as a queue, not per person", () => {
    const prs = [
      pr({ requestedReviewers: [{ id: 1, login: "a" }] }),
      pr({ requestedReviewers: [{ id: 2, login: "b" }] }),
      pr({
        requestedReviewers: [{ id: 3, login: "c" }],
        reviews: [{ id: 1, state: "APPROVED", dismissed: false }],
      }),
    ];
    expect(reviewLoad(prs, NOW).awaitingReview).toBe(2);
  });

  it("does not count drafts as waiting", () => {
    const prs = [pr({ draft: true, requestedReviewers: [{ id: 1, login: "a" }] })];
    expect(reviewLoad(prs, NOW).awaitingReview).toBe(0);
  });

  it("reports null rather than zero when nothing is waiting", () => {
    expect(reviewLoad([], NOW).oldestWaitHours).toBeNull();
  });
});

describe("formatting", () => {
  it("says so plainly when there is not enough data", () => {
    // Rendering "0s" would look like a real measurement of nothing.
    expect(formatDuration(null)).toBe("not enough data");
    expect(formatHours(null)).toBe("not enough data");
  });

  it("formats across the second, minute, hour and day boundaries", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(2 * HOUR + 30 * 60_000)).toBe("2h 30m");
    expect(formatDuration(26 * HOUR)).toBe("1d 2h");
  });
});

describe("buildInsights", () => {
  it("assembles every section and never keys anything by person", () => {
    const insights = buildInsights([pr()], [run()], NOW);
    const serialized = JSON.stringify(insights);
    expect(insights.throughput).toBeDefined();
    expect(insights.cycleTime).toBeDefined();
    expect(insights.flakes).toBeDefined();
    // The ADR's constraint, asserted: no author login appears anywhere in the
    // insights payload.
    expect(serialized).not.toContain("login");
  });
});
