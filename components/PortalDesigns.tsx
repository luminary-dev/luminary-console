"use client";

// Design previews on the portal: each concept can be viewed live, downloaded
// as a laptop-width PDF, and CHOSEN. Selecting one records the client's choice
// and notifies the studio (email + Telegram) via /c/<slug>/select-design.
// `base` is "" on the client subdomain and "/c/<slug>" in the console preview.
import { useState } from "react";

export type PortalDesign = { id: string; title: string; isNew?: boolean };

export default function PortalDesigns({
  base = "",
  designs,
  initialSelectedId,
}: {
  base?: string;
  designs: PortalDesign[];
  initialSelectedId?: string;
}) {
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [by, setBy] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [feedbackFor, setFeedbackFor] = useState<string>("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState<string>("");

  if (designs.length === 0) return null;

  const sendFeedback = async (d: PortalDesign) => {
    if (!feedbackText.trim()) return;
    setBusy(`fb-${d.id}`);
    setError(null);
    try {
      const res = await fetch(`${base}/design-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, text: feedbackText, by, company }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status}).`);
      setFeedbackSent(d.id);
      setFeedbackFor("");
      setFeedbackText("");
    } catch (e) {
      setError((e instanceof Error ? e.message : "Something went wrong.") + " You can also email support@luminary-dev.xyz.");
    } finally {
      setBusy(null);
    }
  };

  const select = async (d: PortalDesign) => {
    setBusy(d.id);
    setError(null);
    try {
      const res = await fetch(`${base}/select-design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, by, company }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status}).`);
      setSelectedId(d.id);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Something went wrong.") +
          " You can also email us at support@luminary-dev.xyz.",
      );
    } finally {
      setBusy(null);
    }
  };

  const selectedTitle = designs.find((d) => d.id === selectedId)?.title;

  return (
    <div className="card">
      <h3>Design previews</h3>
      <p className="ask-intro">
        {selectedTitle ? (
          <>
            You chose <b>{selectedTitle}</b> — we&apos;ll build this direction. You can change your
            choice below any time before development.
          </>
        ) : (
          <>Preview each concept, then choose the one you&apos;d like us to build.</>
        )}
      </p>

      <input
        type="text"
        name="company_website"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }}
      />
      <label className="ask-field" style={{ marginTop: 6 }}>
        <span className="q-label">Your name (optional)</span>
        <input className="q-line" type="text" value={by} onChange={(e) => setBy(e.target.value)} />
      </label>

      <div className="portal-links" style={{ marginTop: 6 }}>
        {designs.map((d) => {
          const chosen = selectedId === d.id;
          const linkBtn = {
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontFamily: "inherit", fontSize: "inherit",
          } as const;
          return (
            <div key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
              <div className="portal-link" style={{ borderTop: "none" }}>
                <span>
                  {d.title}
                  {chosen && <span className="new-pill" style={{ background: "var(--accent)", color: "#0d0d0f" }}>Selected</span>}
                  {!chosen && d.isNew && <span className="new-pill">New</span>}
                </span>
                <span className="no" style={{ display: "inline-flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <a href={`${base}/design/${d.id}`} target="_blank" rel="noopener noreferrer">Preview →</a>
                  <a href={`${base}/design/${d.id}/pdf`}>Download PDF ↓</a>
                  <button
                    type="button"
                    style={{ ...linkBtn, color: "var(--muted)" }}
                    onClick={() => { setFeedbackFor(feedbackFor === d.id ? "" : d.id); setFeedbackText(""); }}
                  >
                    Request changes
                  </button>
                  {chosen ? (
                    <span style={{ color: "var(--a-text)", fontWeight: 700 }}>✓ Selected</span>
                  ) : (
                    <button type="button" onClick={() => select(d)} disabled={!!busy} style={{ ...linkBtn, color: "var(--a-text)", fontWeight: 700 }}>
                      {busy === d.id ? "Selecting…" : "Select this ✓"}
                    </button>
                  )}
                </span>
              </div>
              {feedbackSent === d.id && (
                <p className="ask-sent" style={{ margin: "0 0 10px" }}>
                  <span aria-hidden="true">✓</span> Thanks — your change request is with the studio.
                </p>
              )}
              {feedbackFor === d.id && (
                <div style={{ margin: "0 0 12px" }}>
                  <textarea
                    className="q-box"
                    rows={3}
                    maxLength={2000}
                    placeholder={`What would you like changed on ${d.title}?`}
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                    <button className="btn small" type="button" disabled={busy === `fb-${d.id}` || !feedbackText.trim()} onClick={() => sendFeedback(d)}>
                      {busy === `fb-${d.id}` ? "Sending…" : "Send request"}
                    </button>
                    <button className="btn ghost small" type="button" onClick={() => setFeedbackFor("")}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
