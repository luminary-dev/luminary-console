"use client";

import { useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { opsFetch } from "@/lib/ops-fetch";

export default function SendToClient({
  slug,
  email,
  publishedCount,
}: {
  slug: string;
  email?: string;
  publishedCount: number;
}) {
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const ok = await confirm({
      title: "Email to client",
      confirmLabel: "Send email",
      message: (
        <>
          Send <b>{email}</b> ONE email containing:
          <ul style={{ margin: "10px 0 10px 18px", padding: 0, display: "grid", gap: 4 }}>
            <li>the questionnaire link</li>
            <li>
              all {publishedCount} published document{publishedCount === 1 ? "" : "s"} — links + PDF
              attachments
            </li>
          </ul>
          Drafts are never included.
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await opsFetch(`/api/clients/${slug}/send`, { method: "POST" });
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
      {dialog}
    </div>
  );
}
