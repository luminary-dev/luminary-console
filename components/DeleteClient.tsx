"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./ConfirmDialog";
import { opsFetch } from "@/lib/ops-fetch";

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
    const res = await opsFetch(`/api/clients/${slug}`, {
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
    <div className="card" style={{ borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)" }}>
      <h3 style={{ color: "var(--danger)" }}>Delete this client</h3>
      <p className="empty-note" style={{ marginTop: 6 }}>
        This removes everything for good: every document, their answers to the questions form and
        their web address. It cannot be undone. Use it only when a project is finished and you no
        longer need the record.
      </p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button
        className="btn ghost small"
        style={{ marginTop: 12, borderColor: "color-mix(in srgb, var(--danger) 50%, transparent)", color: "var(--danger)" }}
        disabled={busy}
        onClick={run}
      >
        {busy ? "Deleting…" : "Delete this client and their web address"}
      </button>
      {dialog}
    </div>
  );
}
