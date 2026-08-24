"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Mark all as read" for the dashboard's Recent updates card.
export default function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await fetch("/api/activity/read", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn ghost small" onClick={run} disabled={busy}>
      {busy ? "Marking…" : "Mark all as read"}
    </button>
  );
}
