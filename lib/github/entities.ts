// The projected GitHub entities the console reads.
//
// These are OUR shapes, not GitHub's. Two reasons. First, a view model that
// mirrors an upstream payload inherits every upstream change; ours changes
// when our screens change. Second, merge readiness and CI health are derived
// facts we compute once here rather than re-deriving in each component, so
// the PR list and the PR detail can never disagree about whether something is
// mergeable.
import type { GhCheckRun, GhPullRequest, GhUser, GhWorkflowRun } from "./schema";

export type ActorRef = {
  id: number;
  login: string;
  avatarUrl?: string;
};

/** A GitHub account can be deleted while we still hold references to its
 *  work, so every actor is optional at the edges and this renders the
 *  tombstone case rather than throwing. */
export function toActor(user: GhUser | null | undefined): ActorRef | undefined {
  if (!user) return undefined;
  return {
    id: user.id,
    login: user.login,
    ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
  };
}

export const GHOST_ACTOR: ActorRef = { id: 0, login: "ghost" };

export type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"
  | "startup_failure"
  | null;

export type CheckSummary = {
  id: number;
  name: string;
  status: string;
  conclusion: CheckConclusion;
  /** Required by branch protection. Unknown until we read protection rules,
   *  so absence means "we do not know", not "not required". */
  required?: boolean;
  url?: string;
  startedAt?: string;
  completedAt?: string;
};

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export type ReviewSummary = {
  id: number;
  state: ReviewState;
  author?: ActorRef;
  submittedAt?: string;
  /** A dismissed review no longer counts toward approval but still belongs
   *  in the timeline. */
  dismissed: boolean;
};

/** Why a PR cannot merge right now. Ordered by how we surface it: the first
 *  blocker is the one the row names. */
export type MergeBlocker =
  | "draft"
  | "conflicts"
  | "failing_checks"
  | "pending_checks"
  | "changes_requested"
  | "review_required"
  | "unresolved_conversations"
  | "behind_base"
  | "blocked_by_protection"
  | "closed";

export type MergeReadiness = {
  ready: boolean;
  /** Every blocker found, so the detail view can list them all. */
  blockers: MergeBlocker[];
  /** The one the list view names, plainly worded. */
  summary: string;
};

export type PullRequestEntity = {
  id: number;
  nodeId?: string;
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  author?: ActorRef;
  assignees: ActorRef[];
  requestedReviewers: ActorRef[];
  labels: { name: string; color?: string }[];
  headRef: string;
  headSha: string;
  baseRef: string;
  /** True when the head repo differs from the base repo. A fork PR runs with
   *  restricted secrets and its checks behave differently, so the UI says so
   *  rather than leaving someone puzzled by missing checks. */
  fromFork: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  mergedAt?: string;
  /** null means GitHub has not computed mergeability yet, which is different
   *  from "has conflicts". */
  mergeable: boolean | null;
  mergeableState?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  comments?: number;
  url: string;
  reviews: ReviewSummary[];
  checks: CheckSummary[];
  unresolvedThreads?: number;
  /** Commits the base branch has that this head does not. */
  behindBy?: number;
  /** When we last reconciled this against the API. */
  syncedAt: string;
};

export type RepoEntity = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  description?: string;
  language?: string;
  license?: string;
  openIssues?: number;
  pushedAt?: string;
  url: string;
  syncedAt: string;
};

export type WorkflowRunEntity = {
  id: number;
  repo: string;
  name: string;
  headBranch?: string;
  headSha: string;
  status: string;
  conclusion: CheckConclusion;
  event?: string;
  runNumber?: number;
  attempt?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  /** Milliseconds, computed once so trend charts do not re-derive it. */
  durationMs?: number;
  actor?: ActorRef;
  url?: string;
};

export type DeploymentEntity = {
  id: number;
  repo: string;
  environment: string;
  ref: string;
  sha: string;
  state: string;
  description?: string;
  environmentUrl?: string;
  createdAt: string;
  updatedAt?: string;
  creator?: ActorRef;
};

export type ReleaseEntity = {
  id: number;
  repo: string;
  tagName: string;
  name?: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt?: string;
  url?: string;
  author?: ActorRef;
};

export type AlertEntity = {
  repo: string;
  kind: "dependabot" | "code_scanning" | "secret_scanning";
  number: number;
  state: string;
  severity?: string;
  title: string;
  createdAt?: string;
  url?: string;
};

// ——— derivation ———

const FAILING: CheckConclusion[] = ["failure", "timed_out", "startup_failure", "action_required"];

/** "neutral" and "skipped" are NOT failures. Treating them as red is a
 *  classic misread that makes a healthy PR look broken. */
export const isFailingConclusion = (c: CheckConclusion): boolean => FAILING.includes(c);

export const isPendingCheck = (c: CheckSummary): boolean =>
  c.status !== "completed" && c.conclusion === null;

/** Map a raw check run onto our summary. */
export function toCheckSummary(run: GhCheckRun): CheckSummary {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: (run.conclusion ?? null) as CheckConclusion,
    ...(run.html_url ? { url: run.html_url } : {}),
    ...(run.started_at ? { startedAt: run.started_at } : {}),
    ...(run.completed_at ? { completedAt: run.completed_at } : {}),
  };
}

export function toWorkflowRunEntity(repo: string, run: GhWorkflowRun): WorkflowRunEntity {
  const started = Date.parse(run.run_started_at ?? run.created_at);
  const finished = Date.parse(run.updated_at);
  const durationMs =
    Number.isFinite(started) && Number.isFinite(finished) && finished >= started
      ? finished - started
      : undefined;
  const actor = toActor(run.actor);
  return {
    id: run.id,
    repo,
    name: run.name ?? "workflow",
    ...(run.head_branch ? { headBranch: run.head_branch } : {}),
    headSha: run.head_sha,
    status: run.status,
    conclusion: (run.conclusion ?? null) as CheckConclusion,
    ...(run.event ? { event: run.event } : {}),
    ...(run.run_number !== undefined ? { runNumber: run.run_number } : {}),
    ...(run.run_attempt !== undefined ? { attempt: run.run_attempt } : {}),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    ...(run.run_started_at ? { startedAt: run.run_started_at } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(actor ? { actor } : {}),
    ...(run.html_url ? { url: run.html_url } : {}),
  };
}

/** Project a raw pull request onto our entity. Review and check data are
 *  supplied separately because they come from different calls. */
export function toPullRequestEntity(
  repo: string,
  pr: GhPullRequest,
  extra: {
    reviews?: ReviewSummary[];
    checks?: CheckSummary[];
    unresolvedThreads?: number;
    behindBy?: number;
  } = {},
): PullRequestEntity {
  const headRepo = pr.head.repo?.full_name;
  const baseRepo = pr.base.repo?.full_name ?? repo;
  const author = toActor(pr.user);
  return {
    id: pr.id,
    ...(pr.node_id ? { nodeId: pr.node_id } : {}),
    repo,
    number: pr.number,
    title: pr.title,
    state: pr.merged || pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open",
    draft: pr.draft === true,
    ...(author ? { author } : {}),
    assignees: (pr.assignees ?? []).map(toActor).filter((a): a is ActorRef => !!a),
    requestedReviewers: (pr.requested_reviewers ?? [])
      .map(toActor)
      .filter((a): a is ActorRef => !!a),
    labels: (pr.labels ?? []).map((l) => ({
      name: l.name,
      ...(l.color ? { color: l.color } : {}),
    })),
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    // A deleted fork leaves head.repo null; that is still a fork PR, and
    // treating an unknown head repo as "same repo" would wrongly promise that
    // secrets were available to its checks.
    fromFork: headRepo === undefined ? pr.head.repo === null : headRepo !== baseRepo,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    ...(pr.closed_at ? { closedAt: pr.closed_at } : {}),
    ...(pr.merged_at ? { mergedAt: pr.merged_at } : {}),
    mergeable: pr.mergeable ?? null,
    ...(pr.mergeable_state ? { mergeableState: pr.mergeable_state } : {}),
    ...(pr.additions !== undefined ? { additions: pr.additions } : {}),
    ...(pr.deletions !== undefined ? { deletions: pr.deletions } : {}),
    ...(pr.changed_files !== undefined ? { changedFiles: pr.changed_files } : {}),
    ...(pr.comments !== undefined ? { comments: pr.comments } : {}),
    url: pr.html_url ?? `https://github.com/${repo}/pull/${pr.number}`,
    reviews: extra.reviews ?? [],
    checks: extra.checks ?? [],
    ...(extra.unresolvedThreads !== undefined
      ? { unresolvedThreads: extra.unresolvedThreads }
      : {}),
    ...(extra.behindBy !== undefined ? { behindBy: extra.behindBy } : {}),
    syncedAt: new Date().toISOString(),
  };
}

/**
 * The single merge verdict, with the specific blocker named.
 *
 * The rule the mandate sets is "a single clear verdict with the specific
 * blocker named", so this returns an ordered blocker list and one sentence.
 * Order matters: a draft PR with failing checks is blocked by being a draft,
 * because that is the thing the author would fix first.
 */
export function mergeReadiness(pr: PullRequestEntity): MergeReadiness {
  const blockers: MergeBlocker[] = [];

  if (pr.state !== "open") blockers.push("closed");
  if (pr.draft) blockers.push("draft");
  // mergeable === null means GitHub is still computing it. Reporting
  // "conflicts" then would be a lie that resolves itself a second later.
  if (pr.mergeable === false) blockers.push("conflicts");

  const failing = pr.checks.filter((c) => isFailingConclusion(c.conclusion));
  const pending = pr.checks.filter(isPendingCheck);
  if (failing.length) blockers.push("failing_checks");
  if (pending.length) blockers.push("pending_checks");

  const live = pr.reviews.filter((r) => !r.dismissed);
  if (live.some((r) => r.state === "CHANGES_REQUESTED")) blockers.push("changes_requested");
  else if (!live.some((r) => r.state === "APPROVED") && pr.requestedReviewers.length > 0) {
    blockers.push("review_required");
  }

  if ((pr.unresolvedThreads ?? 0) > 0) blockers.push("unresolved_conversations");
  if ((pr.behindBy ?? 0) > 0) blockers.push("behind_base");
  if (pr.mergeableState === "blocked") blockers.push("blocked_by_protection");

  // No blockers is its own answer, and keeping it out of the switch leaves the
  // switch over MergeBlocker alone, where the compiler enforces that every
  // blocker has a sentence.
  const first = blockers[0];
  const summary =
    first === undefined
      ? "Ready to merge"
      : ((): string => {
          switch (first) {
            case "closed":
              return pr.state === "merged" ? "Merged" : "Closed";
            case "draft":
              return "Draft, not ready for review";
            case "conflicts":
              return "Conflicts with the base branch";
            case "failing_checks": {
              const only = failing.length === 1 ? failing[0] : undefined;
              return only ? `Check failing: ${only.name}` : `${failing.length} checks failing`;
            }
            case "pending_checks": {
              const only = pending.length === 1 ? pending[0] : undefined;
              return only ? `Waiting on ${only.name}` : `Waiting on ${pending.length} checks`;
            }
            case "changes_requested":
              return "Changes requested";
            case "review_required":
              return "Waiting on review";
            case "unresolved_conversations":
              return `${pr.unresolvedThreads} unresolved conversation${pr.unresolvedThreads === 1 ? "" : "s"}`;
            case "behind_base":
              return `Behind ${pr.baseRef} by ${pr.behindBy} commit${pr.behindBy === 1 ? "" : "s"}`;
            case "blocked_by_protection":
              return "Blocked by branch protection";
          }
        })();

  return { ready: blockers.length === 0, blockers, summary };
}

/** Age in whole days, for stale detection. */
export function ageInDays(iso: string, now = Date.now()): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((now - t) / 86_400_000);
}

/** A PR nobody has touched for `threshold` days, excluding drafts (a draft is
 *  parked on purpose, not neglected). */
export function isStale(pr: PullRequestEntity, threshold = 3, now = Date.now()): boolean {
  return pr.state === "open" && !pr.draft && ageInDays(pr.updatedAt, now) >= threshold;
}
