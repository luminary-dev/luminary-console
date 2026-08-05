"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RetryStage2({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/clients/${slug}/docs/quotation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "retry-stage2" }),
          });
          setBusy(false);
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            setError(data?.error || "Retry failed");
            return;
          }
          router.refresh();
        }}
      >
        {busy ? "Drafting… (takes ~1–2 min)" : "Draft now"}
      </button>
      {error && <span style={{ color: "var(--danger)", marginLeft: 8 }}>{error}</span>}
    </>
  );
}
