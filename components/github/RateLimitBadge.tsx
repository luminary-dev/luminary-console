// What is left of the GitHub API budget.
//
// The inbox is read from the stored projection, so it costs nothing, but the
// backfills and reconciles behind it do. Showing the remaining budget turns
// "why did the sync stop" from a mystery into a number that was visible all
// along. GitHub does not charge the /rate_limit read against the limit, so
// looking is free.

export type RateLimitInfo = {
  limit: number;
  remaining: number;
  /** Unix seconds, as GitHub reports it. */
  reset: number;
};

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Colombo time, matching every other clock in the console. */
function resetLabel(reset: number): string {
  const ms = reset * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  return new Date(ms).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RateLimitBadge({ info }: { info: RateLimitInfo | null }) {
  if (!info) {
    return (
      <span className="gh-badge">
        <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" />
          <path d="M12 17.2h.01" />
        </svg>
        API budget not read
      </span>
    );
  }

  // Under a tenth left is where a backfill starts getting throttled, which is
  // early enough to notice and late enough not to cry wolf.
  const low = info.limit > 0 && info.remaining / info.limit < 0.1;
  return (
    <span className={`gh-badge${low ? " is-low" : ""}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.4V12l3 1.8" />
      </svg>
      API budget{" "}
      <span className="gh-badge-n">
        {info.remaining.toLocaleString("en-GB")} of {info.limit.toLocaleString("en-GB")}
      </span>{" "}
      left{low ? ", running low" : ""}, resets {resetLabel(info.reset)}
    </span>
  );
}
