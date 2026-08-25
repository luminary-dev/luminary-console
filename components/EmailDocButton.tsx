"use client";

// Per-document "Email" action: confirms, then sends that single document
// (PDF attached; page link included when published) to the client.
import { useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { opsFetch } from "@/lib/ops-fetch";

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
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  if (!email) return null;

  const run = async () => {
    const ok = await confirm({
      title: "Email to client",
      confirmLabel: "Send email",
      message: (
        <>
          Email the <b>{label}</b> (PDF attached) to <b>{email}</b>?
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    setState("idle");
    const res = await opsFetch(`/api/clients/${slug}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docs: [docKey] }),
    });
    setBusy(false);
    setState(res.ok ? "sent" : "error");
    if (res.ok) setTimeout(() => setState("idle"), 2500);
  };

  return (
    <>
      <button className="btn ghost small" disabled={busy} onClick={run}>
        {busy ? "…" : state === "sent" ? "Sent ✓" : state === "error" ? "Failed: retry" : "Email"}
      </button>
      {dialog}
    </>
  );
}
