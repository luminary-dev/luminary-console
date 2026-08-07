"use client";

// The studio assistant: ask a question about this client and get an answer
// grounded in their record. Operator-only — the output is text on this page
// and nothing here ever contacts the client. A drafted email comes back for
// the operator to copy into their mail client and send themselves, which is
// why the only action on the answer is Copy.
import { useState } from "react";

const PRESETS = [
  "Summarise the questionnaire answers",
  "Draft a follow-up email about the outstanding balance",
  "What's missing before I can quote?",
  "Explain this client's money position",
];

const MAX_PROMPT = 4000;

export default function AssistantCard({ slug }: { slug: string }) {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setCopied(false);
    setAsked(q);
    try {
      const res = await fetch(`/api/clients/${slug}/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.text) {
        setError(data?.error || `That didn't work (${res.status}). Try again.`);
      } else {
        setAnswer(data.text);
      }
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy automatically — select the text and copy it manually.");
    }
  };

  const runPreset = (p: string) => {
    setPrompt(p);
    ask(p);
  };

  const tooLong = prompt.length > MAX_PROMPT;

  return (
    <div className="card">
      <div className="ask-head">
        <h3>Studio assistant</h3>
        {busy && <span className="save-state on">Thinking…</span>}
      </div>
      <p className="empty-note" style={{ marginTop: 4 }}>
        Ask anything about this client — their answers, documents, money or what to do next. Answers
        are for you only: nothing here is sent to the client, and drafted emails come back as text to
        copy and send yourself.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {PRESETS.map((p) => (
          <button key={p} className="btn ghost small" disabled={busy} onClick={() => runPreset(p)}>
            {p}
          </button>
        ))}
      </div>

      <textarea
        className="q-box"
        rows={3}
        style={{ width: "100%", marginTop: 12 }}
        placeholder="e.g. Draft a short check-in email asking for the logo files they haven't sent."
        value={prompt}
        disabled={busy}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter sends — the box is multi-line, so plain Enter must not.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask(prompt);
        }}
      />

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <button className="btn small" disabled={busy || !prompt.trim() || tooLong} onClick={() => ask(prompt)}>
          {busy ? "Working… ~20s" : "Ask"}
        </button>
        <span className="save-state">
          {tooLong
            ? `${prompt.length.toLocaleString("en-US")} / ${MAX_PROMPT.toLocaleString("en-US")} — too long`
            : "⌘ + Enter"}
        </span>
      </div>

      {error && <div className="form-error">{error}</div>}

      {answer && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div className="ask-head">
            <span className="k">Answer</span>
            <button className="btn ghost small" style={{ padding: "2px 10px", fontSize: 11 }} onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          {asked && (
            <div className="log-meta" style={{ marginTop: 6 }}>
              You asked: {asked}
            </div>
          )}
          <div
            style={{
              marginTop: 10,
              fontSize: 13.5,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {answer}
          </div>
        </div>
      )}
    </div>
  );
}
