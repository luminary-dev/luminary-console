"use client";

// Per-document "Email" action: confirms, then sends that single document
// (PDF attached; page link included when published) to the client.
import { useState } from "react";

export default function EmailDocButton({
  slug,
  docKey,
  label,
  email,
}: {
  slug: string;
  docKey: string;
  label: string;
  email?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  if (!email) return null;

  const run = async () => {
    if (!window.confirm(`Email the ${label} (PDF attached) to ${email}?`)) return;
    setBusy(true);
    setState("idle");
    const res = await fetch(`/api/clients/${slug}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docs: [docKey] }),
    });
    setBusy(false);
    setState(res.ok ? "sent" : "error");
    if (res.ok) setTimeout(() => setState("idle"), 2500);
  };

  return (
    <button className="btn ghost small" disabled={busy} onClick={run}>
      {busy ? "…" : state === "sent" ? "Sent ✓" : state === "error" ? "Failed — retry" : "Email"}
    </button>
  );
}
