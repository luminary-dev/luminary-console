// The single merge verdict, plus the status icon vocabulary the rest of the
// workspace shares.
//
// mergeReadiness() already decides what is true; this file only decides how it
// reads. Two rules drive it. Status is never hue alone, so every tone ships an
// icon and words (a red row and an amber row are the same row to a colourblind
// operator, and the same row to a screen reader). And the detail view lists
// EVERY blocker: knowing a PR is blocked on a draft is useless if fixing that
// only reveals two more.
import {
  mergeReadiness,
  type MergeBlocker,
  type PullRequestEntity,
} from "@/lib/github/entities";

export type StatusTone = "ok" | "warn" | "bad" | "idle";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Decorative by contract: every call site puts the same fact in text beside
 *  it, so the icon is hidden from assistive technology rather than duplicated. */
export function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "ok") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12.4 2.6 2.6L16 9.6" />
      </svg>
    );
  }
  if (tone === "bad") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <path d="M12 4.2 21 19.8H3L12 4.2z" />
        <path d="M12 10v4" />
        <path d="M12 17.2h.01" />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.4V12l3 1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

/** How loud each blocker is. "Waiting" is not a fault, so pending checks and
 *  an outstanding review read as warm rather than red. */
export function blockerTone(blocker: MergeBlocker | undefined): StatusTone {
  switch (blocker) {
    case undefined:
      return "ok";
    case "draft":
      return "idle";
    case "closed":
      return "idle";
    case "pending_checks":
    case "review_required":
    case "behind_base":
    case "unresolved_conversations":
      return "warn";
    default:
      return "bad";
  }
}

const names = (list: { name: string }[]) => list.map((c) => c.name).join(", ");
const logins = (list: { login: string }[]) => list.map((a) => a.login).join(", ");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * One blocker, said plainly, with the next action in it.
 *
 * The list view gets mergeReadiness().summary, which names only the first
 * blocker. The detail view needs a sentence per blocker, and each one has to
 * be specific: "checks failing" sends someone to GitHub to find out which.
 */
export function blockerSentence(blocker: MergeBlocker, pr: PullRequestEntity): string {
  const failing = pr.checks.filter((c) =>
    ["failure", "timed_out", "startup_failure", "action_required"].includes(c.conclusion ?? ""),
  );
  const pending = pr.checks.filter((c) => c.status !== "completed" && c.conclusion === null);
  const requestedChanges = pr.reviews.filter(
    (r) => !r.dismissed && r.state === "CHANGES_REQUESTED",
  );

  switch (blocker) {
    case "closed":
      return pr.state === "merged"
        ? "Already merged, so there is nothing left to do here."
        : "Closed without merging. Reopen it on GitHub if that was not intended.";
    case "draft":
      return "Still a draft. Mark it ready for review before it can merge.";
    case "conflicts":
      return `Conflicts with ${pr.baseRef}. Update the branch, resolve the conflicts, and push.`;
    case "failing_checks":
      return `${failing.length} ${plural(failing.length, "check is", "checks are")} failing: ${names(failing)}. Read the log, fix or re-run.`;
    case "pending_checks":
      return `${pending.length} ${plural(pending.length, "check is", "checks are")} still running: ${names(pending)}.`;
    case "changes_requested":
      return requestedChanges.length
        ? `${logins(requestedChanges.map((r) => r.author ?? { login: "a reviewer" }))} requested changes. Address the comments and re-request review.`
        : "A reviewer requested changes. Address the comments and re-request review.";
    case "review_required":
      return pr.requestedReviewers.length
        ? `Review requested from ${logins(pr.requestedReviewers)}, and nobody has approved yet.`
        : "Nobody has approved this yet.";
    case "unresolved_conversations":
      return `${pr.unresolvedThreads} review ${plural(pr.unresolvedThreads ?? 0, "conversation is", "conversations are")} still unresolved.`;
    case "behind_base":
      return `Behind ${pr.baseRef} by ${pr.behindBy} ${plural(pr.behindBy ?? 0, "commit", "commits")}. Update the branch so the checks run against current ${pr.baseRef}.`;
    case "blocked_by_protection":
      return `Branch protection on ${pr.baseRef} is holding the merge. Check its required checks and required reviewers.`;
  }
}

/**
 * The verdict. Compact in a row, exhaustive on the detail page.
 *
 * The compact form is one line because a row that wraps to three lines stops
 * being scannable, which is the whole point of the inbox.
 */
export default function MergeVerdict({
  pr,
  detailed = false,
}: {
  pr: PullRequestEntity;
  detailed?: boolean;
}) {
  const verdict = mergeReadiness(pr);
  const tone = blockerTone(verdict.blockers[0]);

  if (!detailed) {
    return (
      <span className={`gh-status is-${tone}`}>
        <StatusIcon tone={tone} />
        <span className={verdict.ready ? "gh-status-strong" : undefined}>
          <span className="sr-only">Merge readiness: </span>
          {verdict.summary}
        </span>
      </span>
    );
  }

  return (
    <div>
      <p className={`gh-verdict-head gh-status is-${tone}`}>
        <StatusIcon tone={tone} />
        <span>
          <span className="sr-only">Merge readiness: </span>
          {verdict.summary}
        </span>
      </p>
      {verdict.blockers.length === 0 ? (
        <p className="gh-note">
          Nothing is blocking this merge: no conflicts, no failing or pending checks, no
          outstanding review, and the branch is current.
        </p>
      ) : (
        <>
          <p className="k" style={{ marginTop: 14 }}>
            {verdict.blockers.length === 1
              ? "The one thing blocking this merge"
              : `Everything blocking this merge (${verdict.blockers.length})`}
          </p>
          <ul className="gh-blockers">
            {verdict.blockers.map((b) => (
              <li key={b} className={`is-${blockerTone(b)}`}>
                <StatusIcon tone={blockerTone(b)} />
                <span>{blockerSentence(b, pr)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
