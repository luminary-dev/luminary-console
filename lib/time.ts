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
