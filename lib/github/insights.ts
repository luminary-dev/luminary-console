// Team health metrics.
//
// The mandate is explicit about the framing, and it is a design constraint,
// not a preference: "Present these as team health signals, framed for
// improving the process. Explicitly do not build individual productivity
// scoreboards; with three people that is corrosive and useless."
//
// So every function here aggregates across the TEAM. Nothing is keyed by
// author, nothing ranks people, and the one place a person appears (review
// latency) is deliberately aggregated rather than attributed. See
// docs/adr/0002-team-health-not-individual-scoreboards.md.
import type { PullRequestEntity, WorkflowRunEntity } from "./entities";

const DAY_MS = 86_400_000;

/** Percentile of a numeric series. Median and p90 say more about a workflow
 *  than a mean, which one outlier drags around. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank, which needs no interpolation and is stable on small samples,
  // and this team's samples are small.
  // Clamped at both ends: a caller asking for a percentile outside 0..100
  // would otherwise index past the series and read undefined as if it were a
  // real measurement.
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

export const median = (values: number[]): number | null => percentile(values, 50);

export type Throughput = {
  /** Pull requests merged in the window. */
  merged: number;
  /** Pull requests opened in the window. */
  opened: number;
  /** Merged minus opened. Negative means the backlog is growing, which is the
   *  actual signal; the raw counts alone hide it. */
  net: number;
  windowDays: number;
};

export function throughput(
  prs: PullRequestEntity[],
  windowDays = 7,
  now = Date.now(),
): Throughput {
  const since = now - windowDays * DAY_MS;
  const inWindow = (iso?: string) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= since;
  };
  const merged = prs.filter((p) => p.state === "merged" && inWindow(p.mergedAt)).length;
  const opened = prs.filter((p) => inWindow(p.createdAt)).length;
  return { merged, opened, net: merged - opened, windowDays };
}

export type CycleTime = {
  /** Hours from opening a pull request to merging it. */
  openToMergeHours: { median: number | null; p90: number | null; count: number };
  /** Hours from opening to the first review. Long values here are the usual
   *  cause of a slow cycle, and they are the team's to fix, not an
   *  individual's. */
  openToFirstReviewHours: { median: number | null; p90: number | null; count: number };
};

export function cycleTime(prs: PullRequestEntity[]): CycleTime {
  const toMerge: number[] = [];
  const toReview: number[] = [];

  for (const pr of prs) {
    const opened = Date.parse(pr.createdAt);
    if (!Number.isFinite(opened)) continue;

    if (pr.state === "merged" && pr.mergedAt) {
      const merged = Date.parse(pr.mergedAt);
      // A negative interval means the timestamps disagree, which happens with
      // imported or backdated data. Dropping it beats charting a negative.
      if (Number.isFinite(merged) && merged >= opened) {
        toMerge.push((merged - opened) / 3_600_000);
      }
    }

    const firstReview = pr.reviews
      .map((r) => (r.submittedAt ? Date.parse(r.submittedAt) : NaN))
      .filter((t) => Number.isFinite(t) && t >= opened)
      .sort((a, b) => a - b)[0];
    if (firstReview !== undefined) {
      toReview.push((firstReview - opened) / 3_600_000);
    }
  }

  return {
    openToMergeHours: {
      median: median(toMerge),
      p90: percentile(toMerge, 90),
      count: toMerge.length,
    },
    openToFirstReviewHours: {
      median: median(toReview),
      p90: percentile(toReview, 90),
      count: toReview.length,
    },
  };
}

export type SizeDistribution = {
  /** Buckets by lines changed. Small pull requests get reviewed faster, so
   *  this is a process signal the team can act on. */
  buckets: { label: string; max: number; count: number }[];
  medianLinesChanged: number | null;
};

export function sizeDistribution(prs: PullRequestEntity[]): SizeDistribution {
  // Named separately so the catch-all below is the bucket object itself rather
  // than an index into the list, which cannot be proven to exist.
  const veryLarge = { label: "Very large, 1000 or more", max: Infinity, count: 0 };
  const buckets = [
    { label: "Tiny, under 10 lines", max: 10, count: 0 },
    { label: "Small, under 100", max: 100, count: 0 },
    { label: "Medium, under 500", max: 500, count: 0 },
    { label: "Large, under 1000", max: 1000, count: 0 },
    veryLarge,
  ];
  const sizes: number[] = [];

  for (const pr of prs) {
    // Absent counts mean the projection came from the list endpoint, which
    // omits them. Counting those as zero would fake a pile of tiny PRs.
    if (pr.additions === undefined && pr.deletions === undefined) continue;
    const changed = (pr.additions ?? 0) + (pr.deletions ?? 0);
    sizes.push(changed);
    const bucket = buckets.find((b) => changed < b.max) ?? veryLarge;
    bucket.count += 1;
  }

  return { buckets, medianLinesChanged: median(sizes) };
}

export type FlakeStat = {
  name: string;
  runs: number;
  failures: number;
  /** Failures divided by runs. A check that fails half the time is either
   *  broken or flaky, and either way it is costing everyone. */
  failureRate: number;
  /** True when the same check both passed and failed on the same commit,
   *  which is the strongest available evidence of flakiness rather than a
   *  genuine failure. */
  flaky: boolean;
};

/**
 * Flake leaderboard across workflow runs.
 *
 * This ranks CHECKS, never people. A check that passes and fails on the same
 * head SHA is flaky by definition, and that is the signal worth surfacing.
 */
export function flakeStats(runs: WorkflowRunEntity[]): FlakeStat[] {
  type Acc = { runs: number; failures: number; bySha: Map<string, Set<string>> };
  const byName = new Map<string, Acc>();

  for (const run of runs) {
    if (run.status !== "completed") continue;
    const acc = byName.get(run.name) ?? { runs: 0, failures: 0, bySha: new Map() };
    acc.runs += 1;
    const failed = run.conclusion === "failure" || run.conclusion === "timed_out";
    if (failed) acc.failures += 1;
    const outcomes = acc.bySha.get(run.headSha) ?? new Set<string>();
    outcomes.add(failed ? "fail" : "pass");
    acc.bySha.set(run.headSha, outcomes);
    byName.set(run.name, acc);
  }

  return [...byName.entries()]
    .map(([name, acc]) => ({
      name,
      runs: acc.runs,
      failures: acc.failures,
      failureRate: acc.runs ? acc.failures / acc.runs : 0,
      // Both outcomes on one commit means the code did not change between
      // them, so the check did.
      flaky: [...acc.bySha.values()].some((outcomes) => outcomes.size > 1),
    }))
    .filter((s) => s.failures > 0)
    .sort((a, b) => b.failureRate - a.failureRate || b.failures - a.failures);
}

export type DurationTrend = {
  name: string;
  runs: number;
  medianMs: number | null;
  p90Ms: number | null;
};

export function durationTrends(runs: WorkflowRunEntity[]): DurationTrend[] {
  const byName = new Map<string, number[]>();
  for (const run of runs) {
    if (run.durationMs === undefined || run.durationMs <= 0) continue;
    const list = byName.get(run.name) ?? [];
    list.push(run.durationMs);
    byName.set(run.name, list);
  }
  return [...byName.entries()]
    .map(([name, durations]) => ({
      name,
      runs: durations.length,
      medianMs: median(durations),
      p90Ms: percentile(durations, 90),
    }))
    .sort((a, b) => (b.medianMs ?? 0) - (a.medianMs ?? 0));
}

export type ReviewLoad = {
  /** How many open pull requests are waiting on a review right now. A queue
   *  length, not a per-person score. */
  awaitingReview: number;
  /** The oldest wait, in hours. */
  oldestWaitHours: number | null;
};

export function reviewLoad(prs: PullRequestEntity[], now = Date.now()): ReviewLoad {
  const waiting = prs.filter(
    (p) =>
      p.state === "open" &&
      !p.draft &&
      p.requestedReviewers.length > 0 &&
      !p.reviews.some((r) => !r.dismissed && r.state === "APPROVED"),
  );
  const waits = waiting
    .map((p) => (now - Date.parse(p.updatedAt)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  return {
    awaitingReview: waiting.length,
    oldestWaitHours: waits.length ? Math.max(...waits) : null,
  };
}

export type Insights = {
  throughput: Throughput;
  cycleTime: CycleTime;
  size: SizeDistribution;
  flakes: FlakeStat[];
  durations: DurationTrend[];
  reviewLoad: ReviewLoad;
  generatedAt: string;
};

export function buildInsights(
  prs: PullRequestEntity[],
  runs: WorkflowRunEntity[],
  now = Date.now(),
): Insights {
  return {
    throughput: throughput(prs, 7, now),
    cycleTime: cycleTime(prs),
    size: sizeDistribution(prs),
    flakes: flakeStats(runs).slice(0, 10),
    durations: durationTrends(runs).slice(0, 10),
    reviewLoad: reviewLoad(prs, now),
    generatedAt: new Date(now).toISOString(),
  };
}

/** Format a duration for display. Kept here so the same rounding is used by
 *  every surface that shows one. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "not enough data";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return "not enough data";
  return formatDuration(hours * 3_600_000);
}
