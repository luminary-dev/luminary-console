// Reviews on one pull request, plus the one-line tally the inbox row uses.
//
// Same pairing as CheckList: the row's summary and the detail list come from
// one function, so they cannot drift.
import type { ActorRef, ReviewSummary } from "@/lib/github/entities";
import { StatusIcon, type StatusTone } from "./MergeVerdict";

export type ReviewTally = {
  approved: number;
  changesRequested: number;
  commented: number;
  /** Dismissed reviews stay in the timeline but gate nothing. */
  dismissed: number;
  pending: number;
};

export function tallyReviews(reviews: ReviewSummary[]): ReviewTally {
  const tally: ReviewTally = {
    approved: 0,
    changesRequested: 0,
    commented: 0,
    dismissed: 0,
    pending: 0,
  };
  for (const r of reviews) {
    if (r.dismissed) tally.dismissed++;
    else if (r.state === "APPROVED") tally.approved++;
    else if (r.state === "CHANGES_REQUESTED") tally.changesRequested++;
    else if (r.state === "PENDING") tally.pending++;
    else tally.commented++;
  }
  return tally;
}

export function reviewsLabel(tally: ReviewTally, requested: number): string {
  const parts: string[] = [];
  if (tally.changesRequested) parts.push(`${tally.changesRequested} requested changes`);
  if (tally.approved) parts.push(`${tally.approved} approved`);
  if (tally.commented) parts.push(`${tally.commented} commented`);
  if (parts.length === 0) {
    return requested > 0 ? `Waiting on ${requested}` : "No reviews yet";
  }
  return parts.join(", ");
}

export function reviewsTone(tally: ReviewTally, requested: number): StatusTone {
  if (tally.changesRequested) return "bad";
  if (tally.approved) return "ok";
  if (requested > 0) return "warn";
  return "idle";
}

const STATE_LABEL: Record<ReviewSummary["state"], string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "review in progress",
};

function reviewTone(review: ReviewSummary): StatusTone {
  if (review.dismissed) return "idle";
  if (review.state === "APPROVED") return "ok";
  if (review.state === "CHANGES_REQUESTED") return "bad";
  return "idle";
}

/** The compact tally, for a list row. */
export function ReviewsSummary({
  reviews,
  requested,
}: {
  reviews: ReviewSummary[];
  requested: ActorRef[];
}) {
  const tally = tallyReviews(reviews);
  const tone = reviewsTone(tally, requested.length);
  return (
    <span className={`gh-status is-${tone}`}>
      <StatusIcon tone={tone} />
      <span>
        <span className="sr-only">Reviews: </span>
        {reviewsLabel(tally, requested.length)}
      </span>
    </span>
  );
}

export default function ReviewList({
  reviews,
  requested,
}: {
  reviews: ReviewSummary[];
  requested: ActorRef[];
}) {
  // Someone who has already reviewed can still sit in the requested list on
  // GitHub, and showing them twice makes the ball look like it is in their
  // court when it is not.
  const reviewed = new Set(reviews.filter((r) => !r.dismissed).map((r) => r.author?.login));
  const outstanding = requested.filter((r) => !reviewed.has(r.login));

  if (reviews.length === 0 && outstanding.length === 0) {
    return (
      <p className="gh-note">
        No reviews and nobody requested. Request a reviewer on GitHub if this needs a second pair
        of eyes.
      </p>
    );
  }

  return (
    <ul className="gh-lines">
      {reviews.map((review) => {
        const tone = reviewTone(review);
        return (
          <li className="gh-line" key={review.id}>
            <span className={`gh-status is-${tone}`}>
              <StatusIcon tone={tone} />
              <span>
                {STATE_LABEL[review.state]}
                {review.dismissed && review.state !== "DISMISSED" ? ", since dismissed" : ""}
              </span>
            </span>
            <span className="gh-line-name">{review.author?.login ?? "ghost"}</span>
            {review.submittedAt ? (
              <span className="gh-line-meta">{review.submittedAt.slice(0, 10)}</span>
            ) : null}
          </li>
        );
      })}
      {outstanding.map((actor) => (
        <li className="gh-line" key={`requested-${actor.id}-${actor.login}`}>
          <span className="gh-status is-warn">
            <StatusIcon tone="warn" />
            <span>review requested</span>
          </span>
          <span className="gh-line-name">{actor.login}</span>
          <span className="gh-line-meta">not started</span>
        </li>
      ))}
    </ul>
  );
}
