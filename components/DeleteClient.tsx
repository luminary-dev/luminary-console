"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./ConfirmDialog";

export default function DeleteClient({ slug, company }: { slug: string; company: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    // Irreversible → re-authenticate: the console password is required again.
    const password = await confirm({
      title: `Delete ${company}?`,
      danger: true,
      confirmLabel: "Delete forever",
      password: true,
      message: (
        <>
          Every document (PDFs of all docs, invoices, receipts and questionnaire answers) is first
          emailed to the studio as an archive, then the documents, subdomain and DNS record are
          removed. <b>This cannot be undone.</b> Enter the console password to confirm:
        </>
      ),
    });
    if (!password) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${slug}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error || `Delete failed (${res.status})`);
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ borderColor: "rgba(239,68,68,.35)" }}>
      <h3 style={{ color: "var(--danger)" }}>Danger zone</h3>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        When a project is finished, delete the client to remove all documents, the questionnaire
        answers, the subdomain and its DNS record.
      </p>
      {error && <div className="form-error">{error}</div>}
      <button
        className="btn ghost small"
        style={{ marginTop: 12, borderColor: "rgba(239,68,68,.5)", color: "var(--danger)" }}
        disabled={busy}
        onClick={run}
      >
        {busy ? "Deleting…" : "Delete client & subdomain"}
      </button>
      {dialog}
    </div>
  );
}
