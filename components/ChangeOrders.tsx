"use client";

// Log of client-requested changes after the cost was finalised. These are
// billed automatically as line items on the final invoice.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeOrder } from "@/lib/types";
import { opsFetch } from "@/lib/ops-fetch";

export default function ChangeOrders({
  slug,
  changeOrders,
}: {
  slug: string;
  changeOrders: ChangeOrder[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await opsFetch(`/api/clients/${slug}/change-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || `Failed (${res.status})`);
      return;
    }
    setDesc("");
    setAmount("");
    router.refresh();
  };

  return (
    <div className="card">
      <h3>Change orders</h3>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
        Changes the client requests after the quotation is accepted. Log them here as they're
        approved: each one is billed as its own line on the <b>final invoice</b>.
      </p>

      {changeOrders.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {changeOrders.map((co, i) => (
            <div
              key={i}
              style={{
                display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap",
                padding: "9px 0", borderTop: "1px solid var(--border)",
              }}
            >
              <span style={{ flex: "1 1 260px", fontSize: 13.5 }}>{co.desc}</span>
              <span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>LKR {co.amount}</span>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{co.at}</span>
              <button
                className="btn ghost small"
                style={{ padding: "2px 10px", fontSize: 11 }}
                disabled={busy}
                onClick={() => call({ action: "remove", index: i })}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
            Total change orders:{" "}
            <b className="mono">
              LKR{" "}
              {changeOrders
                .reduce((sum, co) => sum + (parseInt(co.amount.replace(/[^0-9]/g, ""), 10) || 0), 0)
                .toLocaleString("en-US")}
            </b>
          </div>
        </div>
      )}

      <div className="q-fields" style={{ marginTop: 6 }}>
        <div className="q-field" style={{ gridColumn: "1 / span 1" }}>
          <span className="q-label">What changed</span>
          <input className="q-line" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Added a second enquiry form for the Kandy branch" />
        </div>
        <div className="q-field half">
          <span className="q-label">Amount (LKR)</span>
          <input className="q-line" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Leave blank to price automatically" />
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
        Leave the amount blank to apply the aftercare default: the first 5 change requests are free,
        then LKR 6,000 each. Enter an amount to override (e.g. a larger change quoted first).
      </p>
      {error && <div className="form-error">{error}</div>}
      <button
        className="btn small"
        style={{ marginTop: 14 }}
        disabled={busy || !desc.trim()}
        onClick={() => call({ action: "add", desc, amount })}
      >
        {busy ? "Saving…" : "Add change order"}
      </button>
    </div>
  );
}
