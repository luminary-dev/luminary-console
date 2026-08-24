"use client";

// Generate the end-of-project handover pack. The document itself lands in the
// Billing card's table (it is stored as a billing document so it inherits
// preview / publish / email / delete), so this card is only the trigger and
// the explanation of when it applies.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./ConfirmDialog";
import { opsFetch } from "@/lib/ops-fetch";

export default function HandoverCard({
  slug,
  eligible,
  existing,
  deliveredOn,
}: {
  slug: string;
  /** Stage ≥ delivered, or a published final receipt. */
  eligible: boolean;
  /** The pack already on the record, if one has been generated. */
  existing?: { no: string; slug: string; status: string };
  /** ISO date the project was delivered, when the record knows it. */
  deliveredOn?: string;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (existing) {
      const ok = await confirm({
        title: "Rebuild handover pack",
        confirmLabel: "Rebuild",
        message: (
          <>
            <b>{existing.no}</b> already exists. Rebuilding it re-reads the record — documents,
            dates and payment totals — and replaces the current render.
            {existing.status === "published" && " It stays published, so the client sees the new version immediately."}{" "}
            The previous render is kept in its version history.
          </>
        ),
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    const res = await opsFetch(`/api/clients/${slug}/handover`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || `Failed (${res.status})`);
      return;
    }
    router.refresh();
  };

  return (
    <div className="card">
      <h3>Handover pack</h3>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
        The document that closes the project out: what was built, every document issued with its
        number and date, a credentials table for you to fill in at handover, the 30-day warranty
        window{deliveredOn ? ` (running from ${deliveredOn.slice(0, 10)})` : ""}, the care-plan
        pitch and a payment summary. Built from the record — no drafting step — so rebuilding it
        after a late payment or a new document costs nothing. It appears in <b>Billing</b> below,
        where you publish, email or delete it like any other document.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <span
          // A disabled button swallows its own tooltip in most browsers, so the
          // title lives on the wrapper.
          title={
            eligible
              ? undefined
              : "Available once the project is delivered — publish the final receipt, or set the stage to Delivered."
          }
        >
          <button className="btn small" disabled={!eligible || busy} onClick={run}>
            {busy
              ? "Working…"
              : existing
                ? "Rebuild handover pack"
                : "Generate handover pack"}
          </button>
        </span>
        {existing ? (
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            <b className="mono" style={{ color: "var(--text)" }}>{existing.no}</b> ·{" "}
            <span className={`pill${existing.status === "draft" ? " grey" : ""}`}>
              <i />
              {existing.status}
            </span>{" "}
            ·{" "}
            <a href={`/preview/${slug}/${existing.slug}`} target="_blank" rel="noopener noreferrer">
              Preview
            </a>
          </span>
        ) : (
          !eligible && (
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Available once the project is delivered — publish the final receipt, or set the stage
              to <b>Delivered</b>.
            </span>
          )
        )}
      </div>

      {error && <div className="form-error">{error}</div>}
      {dialog}
    </div>
  );
}
