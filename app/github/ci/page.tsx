// Continuous integration: run history, duration trends, and the one
// distinction that decides what an operator should do next.
//
// A check that both passed and failed on the SAME commit is flaky: the code
// did not change between the two runs, so the check did. A check that fails
// every time is broken. Re-running is the right answer to neither, but for
// opposite reasons, so this screen never lumps them together under "failing".
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { githubConfigured } from "@/lib/github/config";
import { isFailingConclusion, type WorkflowRunEntity } from "@/lib/github/entities";
import { durationTrends, flakeStats, formatDuration } from "@/lib/github/insights";
import { listAllPullRequests, listAllWorkflowRuns } from "@/lib/github/projection";
import { groupFailures } from "@/lib/github/views";
import GithubNav, { GithubEmpty, GithubError } from "@/components/github/GithubNav";
import FailureGroups from "@/components/github/FailureGroups";
import { DurationTable, FlakeLeaderboard } from "@/components/github/InsightPanel";
import { StatusIcon, type StatusTone } from "@/components/github/MergeVerdict";
import { shortAge } from "@/components/github/PrRow";
import "@/components/github/github.css";
import "@/components/github/github-views.css";

export const metadata = { title: "CI" };
export const dynamic = "force-dynamic";

/** How many runs the history table shows. Enough to see a pattern, few enough
 *  that the page stays one screen of scroll rather than five. */
const HISTORY_LIMIT = 50;
/** A worst-first table stops being useful long before the tail ends: an org
 *  of this size produces around 150 distinct workflow names. Both tables are
 *  capped, and both say how many rows were left out rather than truncating
 *  silently, which would read as "that is all of them". */
const FLAKE_LIMIT = 15;
const DURATION_LIMIT = 15;

/** One run's outcome as a word plus the tone that word is drawn in. Never a
 *  colour on its own. */
export function runState(run: WorkflowRunEntity): { label: string; tone: StatusTone } {
  if (run.status !== "completed") {
    return { label: run.status.replace(/_/g, " "), tone: "warn" };
  }
  if (run.conclusion === "success") return { label: "passed", tone: "ok" };
  if (isFailingConclusion(run.conclusion)) {
    return { label: (run.conclusion ?? "failure").replace(/_/g, " "), tone: "bad" };
  }
  return { label: (run.conclusion ?? "unknown").replace(/_/g, " "), tone: "idle" };
}

export default function CiPage() {
  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>CI</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <GithubNav current="/github/ci" />

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">CI</h1>
          <p className="gh-lede">
            Workflow run history, how long each workflow takes, which checks fail and whether they
            are flaky or genuinely broken. Read from the stored projection, so it is as fresh as
            the last sync.
          </p>
        </div>
      </div>

      <Suspense fallback={<CiSkeleton />}>
        <CiData />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function CiData() {
  let runs;
  let prs;
  try {
    [runs, prs] = await Promise.all([listAllWorkflowRuns(), listAllPullRequests()]);
  } catch (error) {
    return (
      <GithubError
        title="Could not read the workflow run projection"
        detail={error instanceof Error ? error.message : String(error)}
      >
        Run history, duration trends and the flake leaderboard are all derived from the same stored
        list, so they are all missing rather than partly wrong.
      </GithubError>
    );
  }

  if (runs.length === 0) {
    return (
      <GithubEmpty title="No workflow runs stored yet" configured={githubConfigured()}>
        This screen needs workflow run history to say anything: durations, pass rates and the flaky
        versus broken diagnosis all come from comparing runs to each other. Run a backfill to pull
        recent runs in, then reload.
      </GithubEmpty>
    );
  }

  const allFlakes = flakeStats(runs);
  const allDurations = durationTrends(runs);
  const flakes = allFlakes.slice(0, FLAKE_LIMIT);
  const durations = allDurations.slice(0, DURATION_LIMIT);
  const groups = groupFailures(prs);
  const history = runs.slice(0, HISTORY_LIMIT);
  const now = Date.now();
  const flakyCount = flakes.filter((f) => f.flaky).length;
  const brokenCount = flakes.length - flakyCount;

  return (
    <>
      <section className="card" aria-labelledby="ci-diagnosis">
        <h2 className="gh-card-title" id="ci-diagnosis">
          Flaky or broken
        </h2>
        <p className="gh-note">
          These are not the same problem and they do not have the same fix.
        </p>
        <ul className="gh-blockers">
          <li className="is-warn">
            <StatusIcon tone="warn" />
            <span>
              <b>Flaky</b>: the check passed and failed on the same commit. The code did not change
              between those two runs, so the check did. Re-running turns it green and teaches
              everyone to ignore red, which is the actual cost. Quarantine or fix the test.{" "}
              {flakyCount} {flakyCount === 1 ? "check is" : "checks are"} flaky right now.
            </span>
          </li>
          <li className="is-bad">
            <StatusIcon tone="bad" />
            <span>
              <b>Broken</b>: the check fails consistently, so it is reporting a real fault. Fix the
              cause. Re-running will not turn it green and every re-run costs a build.{" "}
              {brokenCount} {brokenCount === 1 ? "check is" : "checks are"} consistently broken.
            </span>
          </li>
        </ul>
      </section>

      <section className="card" aria-labelledby="ci-flakes">
        <h2 className="gh-card-title" id="ci-flakes">
          Failing checks, ranked
        </h2>
        <FlakeLeaderboard flakes={flakes} />
        {allFlakes.length > flakes.length && (
          <p className="gh-note">
            Showing the {flakes.length} worst of {allFlakes.length} checks that
            have failed at least once. The rest are further down the same list.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="ci-groups">
        <h2 className="gh-card-title" id="ci-groups">
          The same failure across pull requests
        </h2>
        <FailureGroups groups={groups} />
      </section>

      <section className="card" aria-labelledby="ci-durations">
        <h2 className="gh-card-title" id="ci-durations">
          Duration trends
        </h2>
        <DurationTable durations={durations} />
        {allDurations.length > durations.length && (
          <p className="gh-note">
            Showing the {durations.length} slowest of {allDurations.length}
            {" "}workflows with a measured duration.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="ci-history">
        <h2 className="gh-card-title" id="ci-history">
          Run history
        </h2>
        <p className="gh-note">
          The {history.length} most recent runs of {runs.length} stored, newest first.
        </p>
        <div className="gh-scroll">
          <table className="gh-table">
            <caption className="sr-only">
              Recent workflow runs with repository, branch, trigger, outcome, duration and age.
            </caption>
            <thead>
              <tr>
                <th scope="col">Workflow</th>
                <th scope="col">Repository</th>
                <th scope="col">Branch</th>
                <th scope="col">Outcome</th>
                <th scope="col" className="gh-num">
                  Duration
                </th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => {
                const state = runState(run);
                return (
                  <tr className="gh-row" key={`${run.repo}-${run.id}`}>
                    <th scope="row">
                      {run.url ? (
                        <a
                          className="gh-row-link"
                          href={run.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {run.name}
                        </a>
                      ) : (
                        <span className="gh-row-link">{run.name}</span>
                      )}
                      <span className="gh-row-meta">
                        <span>{run.event ?? "unknown trigger"}</span>
                        <span>{run.headSha.slice(0, 7)}</span>
                        {run.attempt && run.attempt > 1 ? (
                          <span>attempt {run.attempt}</span>
                        ) : null}
                      </span>
                    </th>
                    <td className="gh-cell-mono">{run.repo}</td>
                    <td className="gh-cell-mono">{run.headBranch ?? "unknown"}</td>
                    <td>
                      <span className={`gh-status is-${state.tone}`}>
                        <StatusIcon tone={state.tone} />
                        <span>
                          <span className="sr-only">Outcome: </span>
                          {state.label}
                        </span>
                      </span>
                    </td>
                    <td className="gh-num">
                      {run.durationMs === undefined ? "unknown" : formatDuration(run.durationMs)}
                    </td>
                    <td className="gh-cell-mono">
                      <span title={run.createdAt}>{shortAge(run.createdAt, now)} ago</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function CiSkeleton() {
  return (
    <section className="card" aria-labelledby="ci-loading">
      <h2 className="gh-card-title" id="ci-loading">
        Loading CI history
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored workflow runs and pull requests.
      </p>
      <div className="gh-scroll">
        <table className="gh-table">
          <caption className="sr-only">Workflow runs, loading.</caption>
          <thead>
            <tr>
              <th scope="col">Workflow</th>
              <th scope="col">Repository</th>
              <th scope="col">Branch</th>
              <th scope="col">Outcome</th>
              <th scope="col">Duration</th>
              <th scope="col">Started</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <tr className="gh-row" key={i} aria-hidden="true">
                <th scope="row">
                  <span className="gh-skel gh-skel--wide" />
                  <span className="gh-skel gh-skel--half" />
                </th>
                <td><span className="gh-skel gh-skel--wide" /></td>
                <td><span className="gh-skel gh-skel--wide" /></td>
                <td><span className="gh-skel gh-skel--wide" /></td>
                <td><span className="gh-skel gh-skel--wide" /></td>
                <td><span className="gh-skel gh-skel--wide" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
