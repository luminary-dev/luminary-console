"use client";

// The payment arc, in one card: generate the advance invoice → receipt →
// (change orders accumulate meanwhile) → final invoice (balance + change
// orders) → final receipt. Each doc can be previewed, revised, published.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BillingDoc } from "@/lib/types";

const STAGE_LABEL: Record<string, string> = { advance: "Advance", final: "Final", other: "" };

import EmailDocButton from "./EmailDocButton";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  const call = async (payload: Record<string, unknown>, key: string) => {
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
      return;
    }
    setReviseFor(null);
    setInstructions("");
    router.refresh();
  };

  const gen = (kind: string, stage: string, label: string) => (
    <button
      key={label}
      className="btn ghost small"
      disabled={!!busy || !hasQuotation}
      onClick={() => call({ action: "generate", kind, stage }, label)}
    >
      {busy === label ? "Working… ~20s" : label}
    </button>
  );

  return (
    <div className="card">
      <h3>Billing</h3>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
        The payment arc: advance invoice when the quotation is accepted → receipt when paid →
        final invoice at delivery (remaining balance + any change orders) → final receipt.
        {!hasQuotation && " Available once a quotation exists."}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {gen("invoice", "advance", "Generate advance invoice")}
        {gen("receipt", "advance", "Generate advance receipt")}
        {gen("invoice", "final", "Generate final invoice")}
        {gen("receipt", "final", "Generate final receipt")}
      </div>

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
                  <td>
                    <a href={b.htmlUrl} target="_blank" rel="noopener noreferrer">
                      Preview
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
    </div>
  );
}
