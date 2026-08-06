"use client";

// The payment arc, in one card: generate the advance invoice → receipt →
// (change orders accumulate meanwhile) → final invoice (balance + change
// orders) → final receipt. Each doc can be previewed, revised, published.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BillingDoc } from "@/lib/types";

const STAGE_LABEL: Record<string, string> = { advance: "Advance", final: "Final", other: "Additional" };

import EmailDocButton from "./EmailDocButton";
import { useConfirm } from "./ConfirmDialog";

export default function BillingCard({
  slug,
  billing,
  hasQuotation,
  email,
}: {
  slug: string;
  billing: BillingDoc[];
  hasQuotation: boolean;
  email?: string;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [otherFor, setOtherFor] = useState<"invoice" | "receipt" | null>(null);
  const [otherText, setOtherText] = useState("");

  const call = async (payload: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    const res = await fetch(`/api/clients/${slug}/billing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setError(data?.error || `Failed (${res.status})`);
      return false;
    }
    setReviseFor(null);
    setInstructions("");
    setOtherFor(null);
    setOtherText("");
    router.refresh();
    return true;
  };

  // Deleting is for mistakes only, so it's deliberately slow: a published
  // document must be unpublished first (confirmed), then deletion itself is
  // confirmed again; a draft just confirms once.
  const remove = async (b: BillingDoc) => {
    const label = `the ${STAGE_LABEL[b.stage].toLowerCase()} ${b.kind} ${b.no}`;
    if (b.status === "published") {
      const step1 = await confirm({
        title: "Unpublish first",
        danger: true,
        confirmLabel: "Unpublish",
        message: (
          <>
            <b>{b.no}</b> is <b>published</b> — it must be unpublished before it can be deleted.
            Unpublish it now?
          </>
        ),
      });
      if (!step1) return;
      if (!(await call({ action: "unpublish", doc: b.slug }, `unpub-${b.slug}`))) return;
      const step2 = await confirm({
        title: "Delete document",
        danger: true,
        confirmLabel: "Delete permanently",
        message: (
          <>
            <b>{b.no}</b> is now unpublished. Permanently delete {label}? This cannot be undone.
          </>
        ),
      });
      if (!step2) return;
    } else {
      const sure = await confirm({
        title: "Delete document",
        danger: true,
        confirmLabel: "Delete permanently",
        message: <>Permanently delete {label}? This cannot be undone.</>,
      });
      if (!sure) return;
    }
    await call({ action: "delete", doc: b.slug }, `del-${b.slug}`);
  };

  const gen = (kind: string, stage: string, label: string) => (
    <button
      key={label}
      className="btn ghost small"
      disabled={!!busy || !hasQuotation}
      onClick={async () => {
        // Advance/final normally exist once — a duplicate is usually a mis-click.
        const dup = billing.find((b) => b.kind === kind && b.stage === stage);
        if (dup) {
          const ok = await confirm({
            title: "Already generated",
            confirmLabel: "Generate another",
            message: (
              <>
                {stage === "advance" ? "An advance" : "A final"} {kind} already exists (
                <b>{dup.no}</b>). For extra work billed after the project settled, use{" "}
                <b>Additional {kind}</b> instead. Generate another {stage} {kind} anyway?
              </>
            ),
          });
          if (!ok) return;
        }
        call({ action: "generate", kind, stage }, label);
      }}
    >
      {busy === label ? "Working… ~20s" : label}
    </button>
  );

  return (
    <div className="card">
      <h3>Billing</h3>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
        The payment arc: advance invoice when the quotation is accepted → receipt when paid →
        final invoice at delivery (remaining balance + any change orders) → final receipt. Work
        requested <i>after</i> the account is settled gets its own additional invoice/receipt.
        {!hasQuotation && " Available once a quotation exists."}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {gen("invoice", "advance", "Generate advance invoice")}
        {gen("receipt", "advance", "Generate advance receipt")}
        {gen("invoice", "final", "Generate final invoice")}
        {gen("receipt", "final", "Generate final receipt")}
        <button
          className="btn ghost small"
          disabled={!!busy || !hasQuotation}
          onClick={() => setOtherFor(otherFor === "invoice" ? null : "invoice")}
        >
          Additional invoice
        </button>
        <button
          className="btn ghost small"
          disabled={!!busy || !hasQuotation}
          onClick={() => setOtherFor(otherFor === "receipt" ? null : "receipt")}
        >
          Additional receipt
        </button>
      </div>
      {otherFor && (
        <div style={{ marginTop: 12 }}>
          <textarea
            className="q-box"
            rows={2}
            placeholder={
              otherFor === "invoice"
                ? "What extra work is being billed, and for how much? e.g. “New careers page requested after launch — LKR 25,000”"
                : "Which payment was received? e.g. “Payment received in full for additional invoice LUM-INV-0044-03”"
            }
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
          />
          <button
            className="btn small"
            style={{ marginTop: 8 }}
            disabled={!!busy || !otherText.trim()}
            onClick={() => call({ action: "generate", kind: otherFor, stage: "other", instructions: otherText }, `other-${otherFor}`)}
          >
            {busy === `other-${otherFor}` ? "Working… ~20s" : `Generate additional ${otherFor}`}
          </button>
        </div>
      )}

      {billing.length > 0 && (
        <div className="table-scroll">
          <table className="list">
            <thead>
              <tr>
                <th>Document</th>
                <th>No.</th>
                <th>Status</th>
                <th>Preview</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {billing.map((b) => (
                <tr key={b.slug}>
                  <td style={{ fontWeight: 600 }}>
                    {STAGE_LABEL[b.stage]} {b.kind}
                  </td>
                  <td className="mono">{b.no}</td>
                  <td>
                    <span className={`pill${b.status === "draft" ? " grey" : ""}`}>
                      <i />
                      {b.status}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a href={`/preview/${slug}/${b.slug}`} target="_blank" rel="noopener noreferrer">
                      Preview
                    </a>
                    {" · "}
                    <a href={b.htmlUrl} title="Download the HTML file">
                      HTML ↓
                    </a>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {b.status === "draft" ? (
                        <button className="btn small" disabled={!!busy} onClick={() => call({ action: "publish", doc: b.slug }, `pub-${b.slug}`)}>
                          {busy === `pub-${b.slug}` ? "…" : "Publish"}
                        </button>
                      ) : (
                        <button className="btn ghost small" disabled={!!busy} onClick={() => call({ action: "unpublish", doc: b.slug }, `unpub-${b.slug}`)}>
                          {busy === `unpub-${b.slug}` ? "…" : "Unpublish"}
                        </button>
                      )}
                      <button className="btn ghost small" disabled={!!busy} onClick={() => setReviseFor(reviseFor === b.slug ? null : b.slug)}>
                        Revise
                      </button>
                      <EmailDocButton slug={slug} docKey={b.slug} label={`${STAGE_LABEL[b.stage].toLowerCase()} ${b.kind}`} email={email} />
                      <button
                        className="btn ghost small"
                        style={{ color: "#ef4444", borderColor: "rgba(239,68,68,.35)" }}
                        disabled={!!busy}
                        onClick={() => remove(b)}
                      >
                        {busy === `del-${b.slug}` ? "…" : "Delete"}
                      </button>
                    </div>
                    {reviseFor === b.slug && (
                      <div style={{ marginTop: 10 }}>
                        <textarea
                          className="q-box"
                          rows={2}
                          placeholder="Revision instructions"
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                        />
                        <button
                          className="btn small"
                          style={{ marginTop: 8 }}
                          disabled={!!busy || !instructions.trim()}
                          onClick={() => call({ action: "regenerate", doc: b.slug, instructions }, `rev-${b.slug}`)}
                        >
                          {busy === `rev-${b.slug}` ? "Working… ~20s" : "Regenerate"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {dialog}
    </div>
  );
}
