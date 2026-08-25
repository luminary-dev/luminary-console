// The pull request inbox: the centrepiece of the GitHub console.
//
// It reads the stored projection rather than GitHub, so the page renders at
// store speed and a GitHub outage degrades to "this data is a few minutes
// old" instead of a blank screen. The read is wrapped in Suspense so the shell
// and the keyboard hint paint immediately and only the list waits.
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { fetchRateLimit } from "@/lib/github/api";
import { githubConfigured } from "@/lib/github/config";
import { listAllPullRequests } from "@/lib/github/projection";
import { groupFailures, viewCounts } from "@/lib/github/views";
import FailureGroups from "@/components/github/FailureGroups";
import PrInbox from "@/components/github/PrInbox";
import { PrRowSkeleton } from "@/components/github/PrRow";
import RateLimitBadge, { type RateLimitInfo } from "@/components/github/RateLimitBadge";
import "@/components/github/github.css";

export const metadata = { title: "Pull requests" };
export const dynamic = "force-dynamic";

export default function GitHubInboxPage() {
  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Pull requests</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Pull requests</h1>
          <p className="gh-lede">
            Every open pull request across the organisation, with one merge verdict each and the
            specific thing blocking it. Read from the stored projection, so it is as fresh as the
            last sync.
          </p>
        </div>
      </div>

      <Suspense fallback={<InboxSkeleton />}>
        <InboxData />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function InboxData() {
  let prs;
  try {
    prs = await listAllPullRequests();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return (
      <section className="card" aria-labelledby="gh-error-title">
        <h2 className="gh-card-title" id="gh-error-title">
          Could not read the pull request projection
        </h2>
        <p className="gh-note">
          The store did not answer, so nothing can be shown rather than something stale being
          passed off as current. Reload to retry. If it keeps failing, the object store is the
          place to look: the console reads every GitHub entity from it.
        </p>
        <p className="form-error">{detail}</p>
      </section>
    );
  }

  // One clock for the whole render, so a row's age is identical on the server
  // and after hydration.
  const now = Date.now();
  const counts = viewCounts(prs, { now });
  const groups = groupFailures(prs);
  const configured = githubConfigured();
  const rate = configured ? await readRateLimit() : null;
  const lastSync = prs.reduce((latest, pr) => (pr.syncedAt > latest ? pr.syncedAt : latest), "");

  return (
    <>
      <PrInbox prs={prs} counts={counts} now={now} githubConfigured={configured} />

      <section className="card" aria-labelledby="gh-failures-title">
        <h2 className="gh-card-title" id="gh-failures-title">
          Grouped CI failures
        </h2>
        <FailureGroups groups={groups} />
      </section>

      <section className="card" aria-labelledby="gh-sync-title">
        <h2 className="gh-card-title" id="gh-sync-title">
          Sync
        </h2>
        <p className="gh-note">
          {prs.length} pull {prs.length === 1 ? "request" : "requests"} stored
          {lastSync ? `, most recently reconciled ${lastSync.slice(0, 16).replace("T", " ")} UTC` : ""}.
          Webhooks keep this current; a backfill fills any gap a missed delivery leaves.
        </p>
        <div className="gh-links">
          <RateLimitBadge info={rate} />
        </div>
        {configured && !rate ? (
          <p className="gh-note">
            The live budget check did not answer. That affects nothing on this page, which reads
            the store, but it is the first thing to look at if syncs have stopped landing.
          </p>
        ) : null}
      </section>
    </>
  );
}

/** The rate limit is a nicety, never a reason to fail the page. */
async function readRateLimit(): Promise<RateLimitInfo | null> {
  try {
    const resources = await fetchRateLimit();
    const core = resources.core;
    if (!core) return null;
    return { limit: core.limit, remaining: core.remaining, reset: core.reset };
  } catch {
    return null;
  }
}

/** Row-shaped placeholders in the real table, so nothing shifts when the
 *  projection lands. */
function InboxSkeleton() {
  return (
    <section className="card" aria-labelledby="gh-loading-title">
      <h2 className="gh-card-title" id="gh-loading-title">
        Loading pull requests
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored pull requests.
      </p>
      <div className="gh-scroll">
        <table className="gh-table">
          <caption className="sr-only">Pull requests, loading.</caption>
          <thead>
            <tr>
              <th scope="col">Pull request</th>
              <th scope="col">Author</th>
              <th scope="col">Merge readiness</th>
              <th scope="col">Reviews</th>
              <th scope="col">Checks</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <PrRowSkeleton key={i} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
