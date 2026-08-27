// Timestamp formatting shared by the console's log views. Both helpers are
// pure and take the ISO string straight off the record, so they work in
// server components without any client-side hydration.

/** "07 Aug 2026, 14:32" in Colombo time — the studio's clock, not the
 *  server's UTC, so an entry's time matches what the operator remembers. */
export function whenLabel(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "just now" / "14m ago" / "3h ago" / "2d ago" / an absolute date past a
 *  fortnight, where "how long ago" stops being the useful question. */
export function relTime(at: string, now = Date.now()): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  const diff = now - ms;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 14) return `${days}d ago`;
  return new Date(ms).toLocaleDateString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** How long to wait before `relTime` could produce a different label, in ms,
 *  or null once it never will again. Cheap when the label is minutes old and
 *  quiet once it is counting days, so a tab left open all afternoon stays
 *  honest without waking up every second (components/RelativeTime.tsx). */
export function relTickMs(at: string, now = Date.now()): number | null {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const diff = now - ms;
  // A clock-skewed future timestamp reads "just now" and will cross into the
  // past soon, so keep checking.
  if (diff < 0) return 30_000;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return 15_000;
  if (mins < 60 * 24) return 5 * 60_000;
  if (mins <= 60 * 24 * 14) return 60 * 60_000;
  // Past a fortnight the label is an absolute date: it is done changing.
  return null;
}

/**
 * "15 Aug, 23:53" in Colombo time. Same clock as whenLabel, without the year,
 * for lists where the year is noise.
 *
 * The timeZone is the whole point. Two components carried their own copy of
 * this formatter with no timeZone, so the SERVER rendered UTC and the BROWSER
 * rendered the viewer's local zone: 18:23 against 23:53 for the same instant
 * from Colombo. That is a React hydration mismatch (error #418) and, worse, a
 * timestamp an operator could read five and a half hours wrong depending on
 * whether hydration had finished. Formatting a date without pinning a zone is
 * never safe in a server-rendered component, so it lives here once.
 */
export function shortWhenLabel(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
