"use client";

// Per-document action row on the client detail page: publish/unpublish,
// regenerate with instructions, generate billing docs, retry drafting.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DocActions({
  slug,
  type,
  exists,
  status,
  billing,
}: {
  slug: string;
  type: string;
  exists: boolean;
  status?: string;
  billing?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRevise, setShowRevise] = useState(false);
  const [instructions, setInstructions] = useState("");

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/clients/${slug}/docs/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setError(data?.error || `Failed (${res.status})`);
      return;
    }
    setShowRevise(false);
    setInstructions("");
    router.refresh();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {exists && status === "draft" && (
          <button className="btn small" disabled={!!busy} onClick={() => act("publish")}>
            {busy === "publish" ? "…" : "Publish"}
          </button>
        )}
        {exists && status === "published" && (
          <button className="btn ghost small" disabled={!!busy} onClick={() => act("unpublish")}>
            {busy === "unpublish" ? "…" : "Unpublish"}
          </button>
        )}
        {exists && (
          <button className="btn ghost small" disabled={!!busy} onClick={() => setShowRevise((s) => !s)}>
            Revise…
          </button>
        )}
        {!exists && billing && (
          <button className="btn small" disabled={!!busy} onClick={() => setShowRevise((s) => !s)}>
            Generate…
          </button>
        )}
      </div>
      {showRevise && (
        <div style={{ marginTop: 10 }}>
          <textarea
            className="q-box"
            rows={2}
            placeholder={
              exists
                ? "Revision instructions for Claude — e.g. 'drop the total to 40,000 and add a maintenance line'"
                : "What to bill — e.g. '50% advance against the quotation' or 'receipt for 22,500 received today by bank transfer'"
            }
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <button
            className="btn small"
            style={{ marginTop: 8 }}
            disabled={!!busy || (exists && !instructions.trim())}
            onClick={() => act(exists ? "regenerate" : "generate", { instructions })}
          >
            {busy ? "Working… (takes ~30s)" : exists ? "Regenerate with Claude" : "Generate with Claude"}
          </button>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
