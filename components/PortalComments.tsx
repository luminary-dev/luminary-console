"use client";

// Portal question box. One box with a document picker rather than a box per
// row: at 390px six stacked forms would bury the documents themselves, and
// the client almost always has one question at a time. The endpoint is
// passed in (`base` + "/comment") rather than resolved relatively: from the
// console preview path /c/<slug> — no trailing slash — a relative "comment"
// resolves to /c/comment and 404s.
import { useState } from "react";

export type PortalDoc = { key: string; label: string; no: string };

export default function PortalComments({
  docs,
  initialDoc,
  base = "",
}: {
  docs: PortalDoc[];
  /** Preselected document — the newest thing they were sent. */
  initialDoc?: string;
  /** "" on the client subdomain, "/c/<slug>" in the console preview. */
  base?: string;
}) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState(initialDoc ?? docs[0]?.key ?? "");
  const [by, setBy] = useState("");
  const [text, setText] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (docs.length === 0) return null;

  const send = async () => {
    setError(null);
    if (!by.trim()) return setError("Please add your name so we know who's asking.");
    if (!text.trim()) return setError("Please type your question.");
    setStatus("sending");
    try {
      const res = await fetch(`${base}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc, by, text, company }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status}).`);
      setStatus("sent");
      setText("");
    } catch (e) {
      setStatus("idle");
      setError(
        (e instanceof Error ? e.message : "Something went wrong.") +
          " You can also email us at support@luminary-dev.xyz.",
      );
    }
  };

  return (
    <div className="card">
      <div className="ask-head">
        <h3>Question about a document?</h3>
        <button type="button" className="btn ghost small" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Ask us"}
        </button>
      </div>
      {status === "sent" ? (
        <p className="ask-sent">
          <span aria-hidden="true">✓</span> Thanks — your question is with the studio. We reply
          within one business day.{" "}
          <button
            type="button"
            className="ask-again"
            onClick={() => {
              setStatus("idle");
              setOpen(true);
            }}
          >
            Ask another
          </button>
        </p>
      ) : !open ? (
        <p className="ask-intro">
          Pick a document, type your question and it lands straight in the studio inbox — no
          account, no login.
        </p>
      ) : (
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
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
          <label className="ask-field">
            <span className="q-label">Which document?</span>
            <select className="q-line" value={doc} onChange={(e) => setDoc(e.target.value)}>
              {docs.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} · {d.no}
                </option>
              ))}
            </select>
          </label>
          <label className="ask-field">
            <span className="q-label">Your name</span>
            <input className="q-line" type="text" value={by} onChange={(e) => setBy(e.target.value)} />
          </label>
          <label className="ask-field">
            <span className="q-label">Your question</span>
            <textarea
              className="q-box"
              rows={3}
              maxLength={2000}
              placeholder="e.g. Does the quotation include the Sinhala version of the pages?"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn" type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send question"}
          </button>
        </form>
      )}
    </div>
  );
}
