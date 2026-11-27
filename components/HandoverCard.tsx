"use client";

// Generate the end-of-project handover pack. The document itself lands in the
// Billing card's table (it is stored as a billing document so it inherits
// preview / publish / email / delete), so this card is only the trigger and
// the explanation of when it applies.
import { sentenceCase } from "@/lib/sentence-case";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./ConfirmDialog";
import { opsFetch } from "@/lib/ops-fetch";
import HowItWorks from "./HowItWorks";

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
            <b>{existing.no}</b> already exists. Rebuilding it re-reads the record (documents,
            dates and payment totals) and replaces the current render.
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
      <p className="empty-note" style={{ marginTop: 4 }}>
        The document that closes the project: what was built, every document we issued, the logins
        to hand over, the 30-day warranty{deliveredOn ? ` (running from ${deliveredOn.slice(0, 10)})` : ""}{" "}
        and a summary of payments. Once made it appears under <b>Money</b>, where you publish and
        email it like any other document.
      </p>
      <HowItWorks>
        <p>
          It is built straight from this client&apos;s record, with nothing to draft, so making it
          again after a late payment or a new document costs nothing. It also carries the care-plan
          offer. The logins table is left for you to fill in at handover.
        </p>
      </HowItWorks>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <span
          // A disabled button swallows its own tooltip in most browsers, so the
          // title lives on the wrapper.
          title={
            eligible
              ? undefined
              : "You can make this once the project is delivered: publish the receipt for the 70%, or set the stage to Delivered."
          }
        >
          <button className="btn small" disabled={!eligible || busy} onClick={run}>
            {busy
              ? "Working…"
              : existing
                ? "Make it again"
                : "Make the handover pack"}
          </button>
        </span>
        {existing ? (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            <b className="mono" style={{ color: "var(--text)" }}>{existing.no}</b> ·{" "}
            <span className={`pill${existing.status === "draft" ? " grey" : ""}`}>
              <i />
              {sentenceCase(existing.status)}
            </span>{" "}
            ·{" "}
            <a href={`/preview/${slug}/${existing.slug}`} target="_blank" rel="noopener noreferrer">
              Preview
            </a>
          </span>
        ) : (
          !eligible && (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              You can make this once the project is delivered: publish the receipt for the 70%, or
              set the stage to <b>Delivered</b>.
            </span>
          )
        )}
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {dialog}
    </div>
  );
}
