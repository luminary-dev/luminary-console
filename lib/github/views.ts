// Saved views for the pull request inbox.
//
// The mandate names the default set, and they are defined here rather than in
// a component so the same definitions drive the UI, the notification rules
// and the personal home page. A view is a pure predicate over an entity plus
// the viewer, which keeps it testable and keeps "why is this PR in this list"
// answerable.
import { isStale, mergeReadiness, type PullRequestEntity } from "./entities";

export type ViewContext = {
  /** The viewer's GitHub login, so "mine" and "needs my review" mean
   *  something. Absent when we do not know who is looking, in which case the
   *  personal views fall back to empty rather than to everyone's. */
  viewerLogin?: string;
  now?: number;
};

export type SavedView = {
  id: string;
  label: string;
  description: string;
  /** Whether the view depends on knowing who is looking. */
  personal: boolean;
  matches: (pr: PullRequestEntity, ctx: ViewContext) => boolean;
};

const isOpen = (pr: PullRequestEntity) => pr.state === "open";

export const VIEWS: SavedView[] = [
  {
    id: "needs-my-review",
    label: "Needs my review",
    description: "Open pull requests where you are a requested reviewer and have not reviewed yet.",
    personal: true,
    matches: (pr, ctx) => {
      if (!isOpen(pr) || pr.draft || !ctx.viewerLogin) return false;
      const requested = pr.requestedReviewers.some((r) => r.login === ctx.viewerLogin);
      if (!requested) return false;
      // A review already submitted and not dismissed means the ball is not in
      // your court any more, even though GitHub keeps the request listed.
      return !pr.reviews.some(
        (r) => r.author?.login === ctx.viewerLogin && !r.dismissed && r.state !== "PENDING",
      );
    },
  },
  {
    id: "my-prs",
    label: "My pull requests",
    description: "Open pull requests you opened.",
    personal: true,
    matches: (pr, ctx) => isOpen(pr) && !!ctx.viewerLogin && pr.author?.login === ctx.viewerLogin,
  },
  {
    id: "ready-to-merge",
    label: "Approved and ready to merge",
    description: "Open, approved, checks green, no conflicts, nothing blocking.",
    personal: false,
    matches: (pr) => isOpen(pr) && mergeReadiness(pr).ready,
  },
  {
    id: "failing-ci",
    label: "Failing CI",
    description: "Open pull requests with at least one failing check.",
    personal: false,
    matches: (pr) => isOpen(pr) && mergeReadiness(pr).blockers.includes("failing_checks"),
  },
  {
    id: "conflicts",
    label: "Blocked on conflicts",
    description: "Open pull requests that conflict with their base branch.",
    personal: false,
    matches: (pr) => isOpen(pr) && pr.mergeable === false,
  },
  {
    id: "stale",
    label: "Stale over 3 days",
    description: "Open, not a draft, and untouched for three days or more.",
    personal: false,
    matches: (pr, ctx) => isStale(pr, 3, ctx.now),
  },
  {
    id: "drafts",
    label: "Drafts",
    description: "Open drafts, parked on purpose.",
    personal: false,
    matches: (pr) => isOpen(pr) && pr.draft,
  },
  {
    id: "everything",
    label: "Everything",
    description: "Every open pull request across the organisation.",
    personal: false,
    matches: isOpen,
  },
];

export const viewById = (id: string): SavedView | undefined => VIEWS.find((v) => v.id === id);

/** Apply a view. An unknown id falls back to everything rather than to an
 *  empty list, because an empty list reads as "nothing is happening" and that
 *  is the one thing a console must never say wrongly. */
export function applyView(
  prs: PullRequestEntity[],
  viewId: string,
  ctx: ViewContext = {},
): PullRequestEntity[] {
  const view = viewById(viewId) ?? viewById("everything");
  if (!view) return prs;
  return prs.filter((pr) => view.matches(pr, ctx));
}

/** Counts for every view, for the filter chips. Computed in one pass because
 *  the inbox renders all of them at once. */
export function viewCounts(
  prs: PullRequestEntity[],
  ctx: ViewContext = {},
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const view of VIEWS) {
    counts[view.id] = prs.reduce((n, pr) => n + (view.matches(pr, ctx) ? 1 : 0), 0);
  }
  return counts;
}

/**
 * Group identical CI failures across pull requests.
 *
 * The mandate asks for "this same flaky test failed on four PRs today". A
 * check name failing on several PRs at once is almost never four independent
 * bugs; it is one broken thing, and seeing it grouped is the difference
 * between four investigations and one.
 */
export function groupFailures(
  prs: PullRequestEntity[],
): { name: string; count: number; prs: { repo: string; number: number; title: string }[] }[] {
  // Keyed by pull request within each group, not a flat list. One pull
  // request can carry the SAME check name failing more than once (a matrix
  // build reports one run per leg, and a re-run adds another), and counting
  // those separately would report "failed on 5 pull requests" when it failed
  // on 4. The question this panel answers is how many pull requests a check
  // is blocking, so each one counts once.
  const groups = new Map<string, Map<string, { repo: string; number: number; title: string }>>();
  for (const pr of prs) {
    if (pr.state !== "open") continue;
    for (const check of pr.checks) {
      if (!["failure", "timed_out", "startup_failure"].includes(check.conclusion ?? "")) continue;
      const byPr = groups.get(check.name) ?? new Map();
      byPr.set(`${pr.repo}#${pr.number}`, {
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
      });
      groups.set(check.name, byPr);
    }
  }
  return [...groups.entries()]
    .map(([name, byPr]) => ({ name, count: byPr.size, prs: [...byPr.values()] }))
    // Most widespread first: a check failing on five pull requests outranks
    // one failing on a single pull request, because it is more likely to be
    // the shared cause.
    .sort((a, b) => b.count - a.count);
}
