// One pull request as an inbox row, and the skeleton that stands in for it
// while the projection loads.
//
// The row is a table row rather than a card because the inbox is a comparison
// screen: the question is "which of these needs me first", and columns answer
// that far faster than stacked cards do.
import Link from "next/link";
import { GHOST_ACTOR, type PullRequestEntity } from "@/lib/github/entities";
import MergeVerdict from "./MergeVerdict";
import { ChecksSummary } from "./CheckList";
import { ReviewsSummary } from "./ReviewList";

/** repo is "owner/name", so this lands on /github/owner/name/7. */
export const prHref = (pr: PullRequestEntity): string => `/github/${pr.repo}/${pr.number}`;

/**
 * Age as a short mono token.
 *
 * Deliberately coarser than the console's activity log: on a pull request the
 * useful question is "has this been sitting", so anything past a fortnight
 * collapses to weeks rather than turning into a date the eye has to decode.
 */
export function shortAge(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const mins = Math.floor(Math.max(0, now - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export type PrRowProps = {
  pr: PullRequestEntity;
  now: number;
  selected: boolean;
  /** The list's single tab stop. With nothing selected that is the first row,
   *  so Tab still reaches the list instead of skipping past it. */
  tabbable: boolean;
  index: number;
  onSelect: (index: number) => void;
  linkRef: (el: HTMLAnchorElement | null) => void;
};

export default function PrRow({
  pr,
  now,
  selected,
  tabbable,
  index,
  onSelect,
  linkRef,
}: PrRowProps) {
  const author = pr.author ?? GHOST_ACTOR;
  const [, repoName] = pr.repo.split("/");

  return (
    <tr
      className={`gh-row${selected ? " is-selected" : ""}`}
      data-gh-row={index}
      // aria-current, not aria-selected: this is a table, not a grid widget,
      // and "current row" is exactly what the selection means here.
      aria-current={selected ? "true" : undefined}
    >
      <th scope="row">
        <Link
          className="gh-row-link"
          href={prHref(pr)}
          ref={linkRef}
          // Roving tabindex: one tab stop for the whole list, and j/k move it.
          tabIndex={tabbable ? 0 : -1}
          onFocus={() => onSelect(index)}
        >
          <span className="gh-row-no">
            {repoName ?? pr.repo} #{pr.number}
          </span>
          {pr.title}
        </Link>
        <span className="gh-row-meta">
          <span>
            <b>{pr.headRef}</b> into {pr.baseRef}
          </span>
          {pr.draft ? <span>draft</span> : null}
          {pr.fromFork ? <span>from a fork</span> : null}
          {pr.labels.slice(0, 3).map((l) => (
            <span key={l.name}>{l.name}</span>
          ))}
        </span>
      </th>
      <td className="gh-cell-mono">{author.login}</td>
      <td>
        <MergeVerdict pr={pr} />
      </td>
      <td>
        <ReviewsSummary reviews={pr.reviews} requested={pr.requestedReviewers} />
      </td>
      <td>
        <ChecksSummary checks={pr.checks} />
      </td>
      <td className="gh-cell-mono">
        <span title={pr.updatedAt}>{shortAge(pr.updatedAt, now)}</span>
      </td>
    </tr>
  );
}

/** A row-shaped placeholder, so the list does not jump when data lands. It is
 *  hidden from assistive technology: the live region announces the load. */
export function PrRowSkeleton() {
  return (
    <tr className="gh-row" aria-hidden="true">
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
  );
}
