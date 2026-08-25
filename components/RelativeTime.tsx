"use client";

// LC-023: relTime() is pure and takes a fixed `now`, so a label rendered on
// the server freezes at render time and a tab left open for hours keeps
// claiming "2m ago". This wrapper paints the server's label first (identical
// markup, so no hydration mismatch and no layout shift) and then re-derives
// it on the cadence relTickMs picks: fast while the minute counter moves,
// hourly once it counts days, never once the label is an absolute date.
import { useEffect, useState } from "react";
import { relTickMs, relTime, whenLabel } from "@/lib/time";

export default function RelativeTime({
  at,
  initial,
  className,
}: {
  /** Absolute ISO timestamp straight off the record. */
  at: string;
  /** The server-rendered label. Omit it and the first paint derives its own,
   *  which is only safe outside a hydrated tree. */
  initial?: string;
  className?: string;
}) {
  const [label, setLabel] = useState(() => initial ?? relTime(at));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setLabel(relTime(at));
      const next = relTickMs(at);
      if (next !== null) timer = setTimeout(tick, next);
    };
    // Re-derive once immediately: on a slow connection the server's label can
    // already be stale by the time this hydrates.
    tick();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [at]);

  return (
    <time className={className} dateTime={at} title={whenLabel(at)}>
      {label}
    </time>
  );
}
