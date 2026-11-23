"use client";

// The board's shared progress, held in the browser between taps.
//
// A tap is sent to the server and the record it answers with replaces the
// local one, so what is on screen is always what was stored. When the server
// refuses (most often: a teammate recorded that message a moment ago) the
// reason is shown and the whole board is re-read, because a refusal means the
// screen was out of date. The board also re-reads when the tab comes back into
// view, which is how one operator sees another's work without reloading.
import { useCallback, useEffect, useState } from "react";
import type { Action, Progress, ProgressMap } from "@/lib/sales";

export function useSalesProgress(initial: ProgressMap) {
  const [progress, setProgress] = useState<ProgressMap>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/sales", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { progress?: ProgressMap } | null) : null;
    if (data?.progress) setProgress(data.progress);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  /** Returns true when the change was stored. */
  const act = useCallback(
    async (id: string, action: Action): Promise<boolean> => {
      setBusy(true);
      setError(null);
      const res = await fetch("/api/sales/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).catch(() => null);
      const data = res
        ? ((await res.json().catch(() => null)) as { progress?: Progress; error?: string } | null)
        : null;
      setBusy(false);
      if (!res?.ok || !data?.progress) {
        setError(data?.error || "That did not save. Check your connection and try again.");
        void refresh();
        return false;
      }
      const stored = data.progress;
      setProgress((current) => ({ ...current, [id]: stored }));
      return true;
    },
    [refresh],
  );

  return { progress, busy, error, act, refresh, clearError: () => setError(null) };
}
