"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteClient({ slug, company }: { slug: string; company: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (
      !window.confirm(
        `Delete ${company} completely?\n\nThis removes every document, the questionnaire answers, the ${slug}.luminary-dev.xyz subdomain and its DNS record. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${slug}`, { method: "DELETE" });
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
    </div>
  );
}
