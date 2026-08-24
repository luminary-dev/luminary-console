"use client";

// Manual lifecycle-stage override — the small dropdown in the client header
// card. The pipeline auto-advances the stage (publish quotation → quoted,
// acceptance → accepted, payment → development, final receipt → delivered);
// this is for corrections.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientStage } from "@/lib/types";
import { STAGES, STAGE_LABELS } from "@/lib/stage";
import { opsFetch } from "@/lib/ops-fetch";

export default function StageSelect({ slug, stage }: { slug: string; stage: ClientStage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span className="k">Stage</span>
      <select
        className="q-line"
        aria-label="Lifecycle stage"
        style={{ width: "auto", fontSize: 13, padding: "4px 2px" }}
        value={stage}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          const res = await opsFetch(`/api/clients/${slug}/stage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage: e.target.value }),
          });
          const data = await res.json().catch(() => null);
          setBusy(false);
          if (!res.ok) {
            setError(data?.error || `Failed (${res.status})`);
            return;
          }
          router.refresh();
        }}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      {error && <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
