// Repository health across the organisation.
//
// Every figure is folded out of the stored projection lists rather than read
// from GitHub, so this screen costs no API budget and can never disagree with
// the pull request inbox about what is open. The read is wrapped in Suspense
// so the shell and the navigation paint immediately and only the table waits.
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { githubConfigured } from "@/lib/github/config";
import {
  listAllAlerts,
  listAllPullRequests,
  listAllWorkflowRuns,
  listRepos,
} from "@/lib/github/projection";
import GithubNav, { GithubEmpty, GithubError } from "@/components/github/GithubNav";
import RepoHealth, { RepoHealthSkeleton } from "@/components/github/RepoHealth";
import { repoHealthRows } from "@/lib/github/repo-health";
import "@/components/github/github.css";
import "@/components/github/github-views.css";

export const metadata = { title: "Repositories" };
export const dynamic = "force-dynamic";

export default function ReposPage() {
  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Repositories</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <GithubNav current="/github/repos" />

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Repositories</h1>
          <p className="gh-lede">
            One row per repository, with the numbers that say whether it needs attention: open
            pull requests, how often CI passes, open security alerts and how long since anyone
            pushed. Sortable on every one of those.
          </p>
        </div>
      </div>

      <Suspense fallback={<ReposSkeleton />}>
        <ReposData />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function ReposData() {
  let repos;
  let prs;
  let runs;
  let alerts;
  try {
    [repos, prs, runs, alerts] = await Promise.all([
      listRepos(),
      listAllPullRequests(),
      listAllWorkflowRuns(),
      listAllAlerts(),
    ]);
  } catch (error) {
    return (
      <GithubError
        title="Could not read the repository projection"
        detail={error instanceof Error ? error.message : String(error)}
      >
        This screen folds four projection lists together, so any one of them failing empties it.
        The pull request inbox reads the same store and will fail the same way if the store is the
        problem.
      </GithubError>
    );
  }

  if (repos.length === 0) {
    return (
      <GithubEmpty title="No repositories stored yet" configured={githubConfigured()}>
        This screen reads the stored projection, not GitHub directly, so it stays empty until a
        backfill or a webhook has written a repository into it.
      </GithubEmpty>
    );
  }

  const rows = repoHealthRows(repos, prs, runs, alerts);
  const now = Date.now();
  const archived = rows.filter((r) => r.repo.archived).length;
  const noRuns = rows.filter((r) => r.passRate === null).length;

  return (
    <>
      <section className="card" aria-labelledby="repos-title">
        <h2 className="gh-card-title" id="repos-title">
          Health by repository
        </h2>
        <p className="gh-note">
          CI pass rate counts only runs that ended in a clear pass or a clear failure. Cancelled,
          skipped and neutral runs are left out of both sides of the fraction, because a cancelled
          run says nothing about whether the repository is healthy.
        </p>
        <RepoHealth rows={rows} now={now} />
      </section>

      <section className="card" aria-labelledby="repos-sync">
        <h2 className="gh-card-title" id="repos-sync">
          Coverage
        </h2>
        <p className="gh-note">
          {rows.length} {rows.length === 1 ? "repository" : "repositories"} stored,{" "}
          {archived} archived. {noRuns > 0
            ? `${noRuns} ${noRuns === 1 ? "repository has" : "repositories have"} no completed workflow run in the projection, so their pass rate reads "not enough data" rather than zero.`
            : "Every repository has at least one completed workflow run to rate."}
        </p>
      </section>
    </>
  );
}

function ReposSkeleton() {
  return (
    <section className="card" aria-labelledby="repos-loading">
      <h2 className="gh-card-title" id="repos-loading">
        Loading repositories
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored repositories, pull requests, workflow runs and alerts.
      </p>
      <RepoHealthSkeleton />
    </section>
  );
}
