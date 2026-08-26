// One chronological stream of everything the console knows about.
//
// The other screens each answer a specific question. This one answers "what
// has been happening", which is the question you have when you come back from
// a day off and do not yet know what to ask. Pull requests, workflow runs,
// deployments, releases and security alerts are merged and sorted by time.
//
// The filters are URL state rather than component state on purpose: a filtered
// stream is a thing people paste into a chat message, and rebuilding it from
// the address means the link carries what the sender was looking at.
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { githubConfigured } from "@/lib/github/config";
import { isFailingConclusion } from "@/lib/github/entities";
import type {
  AlertEntity,
  DeploymentEntity,
  PullRequestEntity,
  ReleaseEntity,
  WorkflowRunEntity,
} from "@/lib/github/entities";
import {
  listAllAlerts,
  listAllDeployments,
  listAllPullRequests,
  listAllReleases,
  listAllWorkflowRuns,
} from "@/lib/github/projection";
import GithubNav, { GithubEmpty, GithubError } from "@/components/github/GithubNav";
import { StatusIcon, type StatusTone } from "@/components/github/MergeVerdict";
import { shortAge } from "@/components/github/PrRow";
import "@/components/github/github.css";
import "@/components/github/github-views.css";

export const metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const KINDS = ["pull_request", "run", "deployment", "release", "alert"] as const;
export type ActivityKind = (typeof KINDS)[number];

const KIND_LABELS: Record<ActivityKind, string> = {
  pull_request: "Pull request",
  run: "CI run",
  deployment: "Deployment",
  release: "Release",
  alert: "Alert",
};

export type ActivityEvent = {
  key: string;
  kind: ActivityKind;
  /** ISO timestamp the stream is sorted by. */
  at: string;
  repo: string;
  title: string;
  /** The status word, always shown beside an icon and never alone as a hue. */
  status: string;
  tone: StatusTone;
  detail: string;
  href?: string;
};

/** How many events the stream shows.
 *
 *  200 rows measured at roughly 13,000px, which is a scroll test rather than a
 *  feed. 100 also matches the point at which the rest of this console
 *  virtualizes a list, so it is the honest ceiling for an unvirtualized one.
 *  The count that was left out is always stated below the stream: a silently
 *  truncated feed reads as "that is everything that happened", which for an
 *  activity stream is exactly the wrong impression. */
const STREAM_LIMIT = 100;

function prEvent(pr: PullRequestEntity): ActivityEvent {
  const status =
    pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open";
  const tone: StatusTone =
    pr.state === "merged" ? "ok" : pr.state === "closed" ? "idle" : pr.draft ? "idle" : "warn";
  return {
    key: `pr-${pr.repo}-${pr.number}`,
    kind: "pull_request",
    at: pr.updatedAt,
    repo: pr.repo,
    title: `#${pr.number} ${pr.title}`,
    status,
    tone,
    detail: `opened by ${pr.author?.login ?? "a deleted account"}, ${pr.headRef} into ${pr.baseRef}`,
    href: `/github/${pr.repo}/${pr.number}`,
  };
}

function runEvent(run: WorkflowRunEntity): ActivityEvent {
  const tone: StatusTone =
    run.status !== "completed"
      ? "warn"
      : run.conclusion === "success"
        ? "ok"
        : isFailingConclusion(run.conclusion)
          ? "bad"
          : "idle";
  const status =
    run.status !== "completed"
      ? run.status.replace(/_/g, " ")
      : (run.conclusion ?? "unknown").replace(/_/g, " ");
  return {
    key: `run-${run.repo}-${run.id}`,
    kind: "run",
    at: run.createdAt,
    repo: run.repo,
    title: run.name,
    status,
    tone,
    detail: `${run.headBranch ?? "unknown branch"} at ${run.headSha.slice(0, 7)}, triggered by ${run.event ?? "an unknown event"}`,
    ...(run.url ? { href: run.url } : {}),
  };
}

function deploymentEvent(d: DeploymentEntity): ActivityEvent {
  const state = d.state.toLowerCase();
  const failed = state === "failure" || state === "error";
  const tone: StatusTone = failed
    ? "bad"
    : state === "success"
      ? "ok"
      : state === "inactive"
        ? "idle"
        : "warn";
  return {
    key: `dep-${d.repo}-${d.id}`,
    kind: "deployment",
    at: d.createdAt,
    repo: d.repo,
    title: `${d.environment}: ${d.ref}`,
    status: failed ? `deployment ${state === "error" ? "errored" : "failed"}` : state.replace(/_/g, " "),
    tone,
    detail: `${d.sha.slice(0, 7)} by ${d.creator?.login ?? "an unknown account"}`,
    ...(d.environmentUrl ? { href: d.environmentUrl } : {}),
  };
}

function releaseEvent(r: ReleaseEntity): ActivityEvent {
  return {
    key: `rel-${r.repo}-${r.id}`,
    kind: "release",
    at: r.publishedAt ?? "",
    repo: r.repo,
    title: r.name && r.name !== r.tagName ? `${r.tagName} ${r.name}` : r.tagName,
    status: r.draft ? "draft" : r.prerelease ? "prerelease" : "published",
    tone: r.draft ? "idle" : r.prerelease ? "warn" : "ok",
    detail: `by ${r.author?.login ?? "an unknown account"}`,
    ...(r.url ? { href: r.url } : {}),
  };
}

function alertEvent(a: AlertEntity): ActivityEvent {
  const open = a.state.toLowerCase() === "open";
  const leaked = open && a.kind === "secret_scanning";
  return {
    key: `alert-${a.repo}-${a.kind}-${a.number}`,
    kind: "alert",
    at: a.createdAt ?? "",
    repo: a.repo,
    title: a.title,
    status: leaked ? "leaked secret, open" : `${a.kind.replace(/_/g, " ")}, ${a.state.toLowerCase()}`,
    tone: !open ? "idle" : leaked || ["critical", "high"].includes((a.severity ?? "").toLowerCase()) ? "bad" : "warn",
    detail: a.severity ? `severity ${a.severity.toLowerCase()}` : "no severity rating",
    ...(a.url ? { href: a.url } : {}),
  };
}

/** Merge every projection list into one stream, newest first. Events with no
 *  timestamp at all sort last rather than being dropped: a release with no
 *  publish date still happened. */
export function buildActivity(sources: {
  prs: PullRequestEntity[];
  runs: WorkflowRunEntity[];
  deployments: DeploymentEntity[];
  releases: ReleaseEntity[];
  alerts: AlertEntity[];
}): ActivityEvent[] {
  return [
    ...sources.prs.map(prEvent),
    ...sources.runs.map(runEvent),
    ...sources.deployments.map(deploymentEvent),
    ...sources.releases.map(releaseEvent),
    ...sources.alerts.map(alertEvent),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

const isKind = (value: string): value is ActivityKind =>
  (KINDS as readonly string[]).includes(value);

/** Read one query parameter, tolerating the repeated form the platform allows. */
function readParam(
  params: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() ? value.trim() : undefined;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const kindParam = readParam(params, "kind");
  const kind = kindParam && isKind(kindParam) ? kindParam : undefined;
  const repo = readParam(params, "repo");

  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Activity</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <GithubNav current="/github/activity" />

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Activity</h1>
          <p className="gh-lede">
            Pull requests, CI runs, deployments, releases and security alerts in one stream,
            newest first. Filter by kind or repository; the filters live in the address, so the
            link you copy shows what you were looking at.
          </p>
        </div>
      </div>

      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityData
          {...(kind !== undefined ? { kind } : {})}
          {...(repo !== undefined ? { repo } : {})}
        />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function ActivityData({ kind, repo }: { kind?: ActivityKind; repo?: string }) {
  let events: ActivityEvent[];
  let repos: string[];
  try {
    const [prs, runs, deployments, releases, alerts] = await Promise.all([
      listAllPullRequests(),
      listAllWorkflowRuns(),
      listAllDeployments(),
      listAllReleases(),
      listAllAlerts(),
    ]);
    events = buildActivity({ prs, runs, deployments, releases, alerts });
    repos = [...new Set(events.map((e) => e.repo))].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    return (
      <GithubError
        title="Could not read the activity projection"
        detail={error instanceof Error ? error.message : String(error)}
      >
        This stream merges five stored lists, so any one of them failing takes the whole stream
        with it rather than leaving a gap that reads as a quiet day.
      </GithubError>
    );
  }

  if (events.length === 0) {
    return (
      <GithubEmpty title="Nothing has been recorded yet" configured={githubConfigured()}>
        The stream is built from stored pull requests, workflow runs, deployments, releases and
        alerts, and there are none of any of them. Run a backfill to pull recent history in, then
        reload.
      </GithubEmpty>
    );
  }

  const matching = events
    .filter((e) => (kind ? e.kind === kind : true))
    .filter((e) => (repo ? e.repo === repo : true));
  const filtered = matching.slice(0, STREAM_LIMIT);
  const hidden = matching.length - filtered.length;
  const now = Date.now();

  // The explicit `| undefined` is load-bearing: callers pass `{ kind: undefined }`
  // to CLEAR that filter, and the "kind" in next test below tells that apart
  // from leaving the filter alone. Optional-and-absent means something else here.
  const href = (next: { kind?: string | undefined; repo?: string | undefined }) => {
    const query = new URLSearchParams();
    const nextKind = "kind" in next ? next.kind : kind;
    const nextRepo = "repo" in next ? next.repo : repo;
    if (nextKind) query.set("kind", nextKind);
    if (nextRepo) query.set("repo", nextRepo);
    const q = query.toString();
    return q ? `/github/activity?${q}` : "/github/activity";
  };

  return (
    <>
      <section className="card" aria-labelledby="act-filters">
        <h2 className="gh-card-title" id="act-filters">
          Filters
        </h2>
        <div className="gh-filters">
          <nav className="gh-filter-group" aria-label="Filter by kind">
            <span className="gh-filter-legend">Kind</span>
            <div className="gh-chips">
              <Link
                className="gh-chip"
                href={href({ kind: undefined })}
                aria-current={kind === undefined ? "true" : undefined}
              >
                All kinds
              </Link>
              {KINDS.map((k) => (
                <Link
                  key={k}
                  className="gh-chip"
                  href={href({ kind: k })}
                  aria-current={kind === k ? "true" : undefined}
                >
                  {KIND_LABELS[k]}
                  <span className="gh-chip-n">
                    {events.filter((e) => e.kind === k && (repo ? e.repo === repo : true)).length}
                  </span>
                </Link>
              ))}
            </div>
          </nav>

          <nav className="gh-filter-group" aria-label="Filter by repository">
            <span className="gh-filter-legend">Repository</span>
            <div className="gh-chips">
              <Link
                className="gh-chip"
                href={href({ repo: undefined })}
                aria-current={repo === undefined ? "true" : undefined}
              >
                All repositories
              </Link>
              {repos.map((name) => (
                <Link
                  key={name}
                  className="gh-chip"
                  href={href({ repo: name })}
                  aria-current={repo === name ? "true" : undefined}
                >
                  {name}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      </section>

      <section className="card" aria-labelledby="act-stream">
        <h2 className="gh-card-title" id="act-stream">
          Stream
        </h2>
        <p className="gh-note" aria-live="polite">
          {filtered.length} of {events.length} events shown
          {kind ? `, kind ${KIND_LABELS[kind].toLowerCase()}` : ", every kind"}
          {repo ? `, repository ${repo}` : ", every repository"}.
          {/* Keyed off what this filtered view actually dropped, not off the
              unfiltered total: a narrow filter can match fewer than the cap
              while the total exceeds it, and claiming truncation then would
              send someone hunting for events that are already all here. */}
          {hidden > 0
            ? ` ${hidden} older ${hidden === 1 ? "event is" : "events are"} not shown; narrow it with a filter to see further back.`
            : ""}
        </p>

        {filtered.length === 0 ? (
          <p className="gh-note">
            Nothing matches this filter.{" "}
            <Link href="/github/activity">Clear the filters</Link> to see the whole stream.
          </p>
        ) : (
          <ul className="gh-stream">
            {filtered.map((event) => (
              <li className="gh-stream-item" key={event.key}>
                <span className="gh-stream-when">
                  {event.at ? (
                    <span title={event.at}>{shortAge(event.at, now)} ago</span>
                  ) : (
                    "undated"
                  )}
                </span>
                <span className="gh-stream-kind">{KIND_LABELS[event.kind]}</span>
                <span className="gh-stream-body">
                  <span className={`gh-status is-${event.tone}`}>
                    <StatusIcon tone={event.tone} />
                    <span>
                      <b>
                        {event.href ? (
                          event.href.startsWith("/") ? (
                            <Link href={event.href}>{event.title}</Link>
                          ) : (
                            <a href={event.href} target="_blank" rel="noopener noreferrer">
                              {event.title}
                            </a>
                          )
                        ) : (
                          event.title
                        )}
                      </b>
                      <span className="gh-sub">
                        {event.repo} &middot; {event.status} &middot; {event.detail}
                      </span>
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ActivitySkeleton() {
  return (
    <section className="card" aria-labelledby="act-loading">
      <h2 className="gh-card-title" id="act-loading">
        Loading activity
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored pull requests, workflow runs, deployments, releases and alerts.
      </p>
      <ul className="gh-stream">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li className="gh-stream-item" key={i} aria-hidden="true">
            <span className="gh-skel gh-skel--wide" />
            <span className="gh-skel gh-skel--wide" />
            <span className="gh-skel gh-skel--half" />
          </li>
        ))}
      </ul>
    </section>
  );
}
