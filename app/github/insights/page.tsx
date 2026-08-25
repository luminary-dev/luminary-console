// Team health signals.
//
// Bound by docs/adr/0002-team-health-not-individual-scoreboards.md: everything
// here aggregates across the team, nothing is keyed by a person, and the only
// leaderboard ranks checks. The ADR explains why, and the last card on the
// screen says so out loud, so nobody has to go looking for the reason a
// per-person number is missing.
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { githubConfigured } from "@/lib/github/config";
import { buildInsights } from "@/lib/github/insights";
import { listAllPullRequests, listAllWorkflowRuns } from "@/lib/github/projection";
import GithubNav, { GithubEmpty, GithubError } from "@/components/github/GithubNav";
import InsightPanel from "@/components/github/InsightPanel";
import "@/components/github/github.css";
import "@/components/github/github-views.css";

export const metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

export default function InsightsPage() {
  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Insights</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <GithubNav current="/github/insights" />

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Insights</h1>
          <p className="gh-lede">
            Team health, framed for changing the process rather than ranking the people in it.
            Throughput, cycle time, review queue, pull request size, flaky checks and workflow
            durations. A metric with no sample says so instead of printing zero.
          </p>
        </div>
      </div>

      <Suspense fallback={<InsightsSkeleton />}>
        <InsightsData />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function InsightsData() {
  let prs;
  let runs;
  try {
    [prs, runs] = await Promise.all([listAllPullRequests(), listAllWorkflowRuns()]);
  } catch (error) {
    return (
      <GithubError
        title="Could not read the projection these metrics are built from"
        detail={error instanceof Error ? error.message : String(error)}
      >
        Every number on this screen is derived from stored pull requests and workflow runs, so a
        store failure means no metric can be computed. Showing the last known figures would be
        worse than showing none, since a stale trend reads as a current one.
      </GithubError>
    );
  }

  if (prs.length === 0 && runs.length === 0) {
    return (
      <GithubEmpty title="Nothing to measure yet" configured={githubConfigured()}>
        These signals are computed from stored pull requests and workflow runs, and there are none
        of either. Run a backfill to pull recent history in, then reload. Cycle time and size need
        merged pull requests specifically, so a fresh organisation will show &quot;not enough
        data&quot; for those until something merges.
      </GithubEmpty>
    );
  }

  const insights = buildInsights(prs, runs);

  return <InsightPanel insights={insights} />;
}

function InsightsSkeleton() {
  return (
    <section className="card" aria-labelledby="ins-loading">
      <h2 className="gh-card-title" id="ins-loading">
        Loading insights
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored pull requests and workflow runs, then computing the team health signals.
      </p>
      <dl className="gh-metrics" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i}>
            <dt className="gh-metric-k">
              <span className="gh-skel gh-skel--half" />
            </dt>
            <dd className="gh-metric-v">
              <span className="gh-skel gh-skel--half" />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
