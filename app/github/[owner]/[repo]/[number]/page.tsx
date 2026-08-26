// One pull request, in full.
//
// The list names the first blocker; this page names every one of them, because
// clearing the first only to discover two more is the thing that makes a
// review console feel like a liar. Everything here is the stored projection,
// never a live read, so opening a pull request costs no API budget.
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { getPullRequest } from "@/lib/github/projection";
import { mergeReadiness, type PullRequestEntity } from "@/lib/github/entities";
import CheckList, { checksLabel, tallyChecks } from "@/components/github/CheckList";
import MergeVerdict from "@/components/github/MergeVerdict";
import ReviewList, { reviewsLabel, tallyReviews } from "@/components/github/ReviewList";
import { shortAge } from "@/components/github/PrRow";
import "@/components/github/github.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ owner: string; repo: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { owner, repo, number } = await params;
  return { title: `${owner}/${repo} #${number}` };
}

/** The projection is keyed by repo full name and number; a bad number is a bad
 *  URL, not a store failure, so it takes the same "not synced" path. */
async function readPr(owner: string, repo: string, number: string) {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    return await getPullRequest(`${owner}/${repo}`, n);
  } catch {
    return null;
  }
}

export default async function PullRequestPage({ params }: { params: Params }) {
  const { owner, repo, number } = await params;
  const full = `${owner}/${repo}`;
  const pr = await readPr(owner, repo, number);

  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Pull request</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/github">
            <span aria-hidden="true">← </span>Pull requests
          </Link>
        </div>
      </div>

      {pr ? <Loaded pr={pr} /> : <NotSynced full={full} number={number} />}

      <AppTabBar />
    </main>
  );
}

function Loaded({ pr }: { pr: PullRequestEntity }) {
  const verdict = mergeReadiness(pr);
  const checks = tallyChecks(pr.checks);
  const reviews = tallyReviews(pr.reviews);
  const now = Date.now();
  const stateLabel =
    pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open";
  const stateIsQuiet = pr.state !== "open" || pr.draft;

  return (
    <>
      <div className="gh-head">
        <div>
          <p className="gh-crumb">
            {pr.repo} #{pr.number}
          </p>
          <h1 className="gh-h1" style={{ marginTop: 4 }}>
            {pr.title}
          </h1>
          <p className="gh-lede">
            Opened by {pr.author?.login ?? "ghost"}, {shortAge(pr.createdAt, now)} old, last updated{" "}
            {shortAge(pr.updatedAt, now)} ago.
          </p>
        </div>
        <span className={`pill${stateIsQuiet ? " grey" : ""}`}>
          <i />
          {stateLabel}
        </span>
      </div>

      <section className="card" aria-labelledby="pr-verdict">
        <h2 className="gh-card-title" id="pr-verdict">
          Merge readiness
        </h2>
        <div style={{ marginTop: 10 }}>
          <MergeVerdict pr={pr} detailed />
        </div>
        {pr.mergeable === null && pr.state === "open" ? (
          <p className="gh-note">
            GitHub has not finished working out whether this merges cleanly. That answer usually
            lands within a few seconds of a push; reload to pick it up.
          </p>
        ) : null}
        {pr.fromFork ? (
          <p className="gh-note">
            This branch is on a fork. Its workflows run without the repository secrets, so a check
            that passes here may not have run the same steps as one on an internal branch.
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="pr-checks">
        <h2 className="gh-card-title" id="pr-checks">
          Checks
        </h2>
        {checks.total > 0 ? (
          <p className="gh-note" style={{ marginTop: 4 }}>
            {checksLabel(checks)}, from {checks.total}{" "}
            {checks.total === 1 ? "check" : "checks"} reported for commit{" "}
            <span className="mono">{pr.headSha.slice(0, 7)}</span>.
          </p>
        ) : null}
        <CheckList checks={pr.checks} />
      </section>

      <section className="card" aria-labelledby="pr-reviews">
        <h2 className="gh-card-title" id="pr-reviews">
          Reviews
        </h2>
        {pr.reviews.length > 0 || pr.requestedReviewers.length > 0 ? (
          <p className="gh-note" style={{ marginTop: 4 }}>
            {reviewsLabel(reviews, pr.requestedReviewers.length)}
            {reviews.dismissed > 0
              ? `, and ${reviews.dismissed} dismissed ${reviews.dismissed === 1 ? "review" : "reviews"} that no longer gate the merge.`
              : "."}
          </p>
        ) : null}
        <ReviewList reviews={pr.reviews} requested={pr.requestedReviewers} />
      </section>

      <section className="card" aria-labelledby="pr-detail">
        <h2 className="gh-card-title" id="pr-detail">
          Detail
        </h2>
        <dl className="gh-facts">
          <Fact k="Author" v={pr.author?.login ?? "ghost"} mono />
          <Fact k="Branch" v={`${pr.headRef} into ${pr.baseRef}`} mono />
          <Fact k="Head commit" v={pr.headSha.slice(0, 12)} mono />
          <Fact k="Opened" v={pr.createdAt.slice(0, 10)} mono />
          <Fact k="Last updated" v={pr.updatedAt.slice(0, 10)} mono />
          <Fact k="Projection synced" v={pr.syncedAt.slice(0, 16).replace("T", " ") + " UTC"} mono />
          {pr.changedFiles !== undefined ? (
            <Fact k="Files changed" v={String(pr.changedFiles)} mono />
          ) : null}
          {pr.additions !== undefined || pr.deletions !== undefined ? (
            <Fact k="Lines" v={`+${pr.additions ?? 0} / -${pr.deletions ?? 0}`} mono />
          ) : null}
          {pr.behindBy !== undefined ? (
            <Fact k={`Behind ${pr.baseRef}`} v={`${pr.behindBy} commits`} mono />
          ) : null}
          {pr.mergedAt ? <Fact k="Merged" v={pr.mergedAt.slice(0, 10)} mono /> : null}
        </dl>

        <p className="k" style={{ marginTop: 18 }}>
          Labels
        </p>
        {pr.labels.length === 0 ? (
          <p className="gh-note" style={{ marginTop: 4 }}>
            None.
          </p>
        ) : (
          <div className="gh-tags">
            {pr.labels.map((l) => (
              <span className="gh-tag" key={l.name}>
                {l.name}
              </span>
            ))}
          </div>
        )}

        <p className="k" style={{ marginTop: 18 }}>
          Reviewers requested
        </p>
        {pr.requestedReviewers.length === 0 ? (
          <p className="gh-note" style={{ marginTop: 4 }}>
            Nobody requested.
          </p>
        ) : (
          <div className="gh-tags">
            {pr.requestedReviewers.map((r) => (
              <span className="gh-tag" key={`${r.id}-${r.login}`}>
                {r.login}
              </span>
            ))}
          </div>
        )}

        {pr.assignees.length > 0 ? (
          <>
            <p className="k" style={{ marginTop: 18 }}>
              Assignees
            </p>
            <div className="gh-tags">
              {pr.assignees.map((a) => (
                <span className="gh-tag" key={`${a.id}-${a.login}`}>
                  {a.login}
                </span>
              ))}
            </div>
          </>
        ) : null}

        <p className="gh-links">
          <a href={pr.url} target="_blank" rel="noopener noreferrer">
            Open on GitHub
          </a>
          <a href={`${pr.url}/files`} target="_blank" rel="noopener noreferrer">
            Files changed
          </a>
          <a href={`${pr.url}/checks`} target="_blank" rel="noopener noreferrer">
            Checks on GitHub
          </a>
          <Link href="/github">Back to the inbox</Link>
        </p>
        <p className="gh-note">
          The console is read-only for pull requests: approving, merging and closing all happen on
          GitHub. The verdict above says {verdict.ready ? "this one can merge" : "what is in the way"}.
        </p>
      </section>
    </>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="gh-fact">
      <dt>{k}</dt>
      <dd className={`gh-fact-v${mono ? " mono" : ""}`}>{v}</dd>
    </div>
  );
}

function NotSynced({ full, number }: { full: string; number: string }) {
  return (
    <>
      <div className="gh-head">
        <div>
          <p className="gh-crumb">
            {full} #{number}
          </p>
          <h1 className="gh-h1" style={{ marginTop: 4 }}>
            Not synced yet
          </h1>
        </div>
      </div>
      <section className="card" aria-labelledby="pr-missing">
        <h2 className="gh-card-title" id="pr-missing">
          This pull request is not in the projection
        </h2>
        <p className="gh-note">
          The console only knows about pull requests a webhook or a backfill has written into the
          store. This one is missing from it, which means one of three things: it was opened before
          the last backfill ran, its delivery was missed, or the owner, repository or number in the
          address is wrong.
        </p>
        <p className="gh-note">
          Run a backfill for <b>{full}</b> and reload. It may also simply not exist on GitHub, which
          the link below settles in one click.
        </p>
        <p className="gh-links">
          <a
            href={`https://github.com/${full}/pull/${number}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Check it on GitHub
          </a>
          <Link href="/github">Back to the inbox</Link>
        </p>
      </section>
    </>
  );
}
