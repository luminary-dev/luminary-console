"use client";

import { useState } from "react";

export default function SendToClient({
  slug,
  email,
  publishedCount,
}: {
  slug: string;
  email?: string;
  publishedCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (
      !window.confirm(
        `Email ${email} the questionnaire link and ${publishedCount} published document${publishedCount === 1 ? "" : "s"} (links + PDFs)?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await fetch(`/api/clients/${slug}/send`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) setDone(`Sent to ${data.sentTo}`);
    else setError(data?.error || `Failed (${res.status})`);
  };

  return (
    <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn small" disabled={busy || !email} onClick={run}>
        {busy ? "Sending…" : "Email to client"}
      </button>
      {!email && <span style={{ fontSize: 12, color: "var(--muted)" }}>No client email on record.</span>}
      {done && <span style={{ fontSize: 12.5, color: "var(--a-text)" }}>{done} ✓</span>}
      {error && <span style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}
