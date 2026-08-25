// Repository health derivation.
//
// This lives in lib rather than beside the component that renders it because
// the /github/repos page is a SERVER component and computes these rows before
// handing them down. A pure function exported from a "use client" module
// cannot be called from the server: React refuses at runtime, the page's
// error boundary catches it, and the route still answers 200 while rendering
// nothing useful. Keeping the derivation server-safe is what stops that.
//
// Every number here comes from the stored projection rather than from GitHub,
// so this screen costs no API budget and cannot disagree with the pull
// request inbox about how many pull requests are open.
import { isFailingConclusion } from "./entities";
import type {
  AlertEntity,
  PullRequestEntity,
  RepoEntity,
  WorkflowRunEntity,
} from "./entities";

export type RepoHealthRow = {
  repo: RepoEntity;
  openPrs: number;
  /** Runs that ended in a clear pass or a clear failure. */
  decidedRuns: number;
  passedRuns: number;
  /** null when no run has produced a verdict yet, which is NOT the same as a
   *  zero percent pass rate. */
  passRate: number | null;
  openAlerts: number;
};

/**
 * Fold the projection lists into one row per repository.
 *
 * Cancelled, skipped, neutral and stale runs are excluded from the pass rate
 * on both sides of the fraction. A cancelled run says nothing about whether
 * the repository is healthy, and counting it either way would move a number
 * people are meant to act on.
 */
export function repoHealthRows(
  repos: RepoEntity[],
  prs: PullRequestEntity[],
  runs: WorkflowRunEntity[],
  alerts: AlertEntity[],
): RepoHealthRow[] {
  return repos.map((repo) => {
    const openPrs = prs.filter((p) => p.repo === repo.fullName && p.state === "open").length;

    let decidedRuns = 0;
    let passedRuns = 0;
    for (const run of runs) {
      if (run.repo !== repo.fullName || run.status !== "completed") continue;
      if (run.conclusion === "success") {
        decidedRuns++;
        passedRuns++;
      } else if (isFailingConclusion(run.conclusion)) {
        decidedRuns++;
      }
    }

    const openAlerts = alerts.filter(
      (a) => a.repo === repo.fullName && a.state === "open",
    ).length;

    return {
      repo,
      openPrs,
      decidedRuns,
      passedRuns,
      passRate: decidedRuns === 0 ? null : passedRuns / decidedRuns,
      openAlerts,
    };
  });
}

export function passRateLabel(row: RepoHealthRow): string {
  if (row.passRate === null) return "not enough data";
  return `${Math.round(row.passRate * 100)}% passed, ${row.decidedRuns} runs`;
}
