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

export default function AssistantCard({ slug, email }: { slug: string; email?: string }) {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Handoff state: compose an email from the draft, or save it as a task.
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [handoff, setHandoff] = useState<string | null>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setCopied(false);
    setComposing(false);
    setHandoff(null);
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

  const startCompose = () => {
    if (!answer) return;
    setSubject("A quick update from Luminary");
    setEmailBody(answer);
    setComposing(true);
    setHandoff(null);
  };

  const sendEmail = async () => {
    setBusy(true);
    setError(null);
    setHandoff(null);
    const res = await fetch(`/api/clients/${slug}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body: emailBody }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setError(data?.error || "Couldn't send — try again.");
      return;
    }
    setComposing(false);
    setHandoff(`Sent to ${data?.to ?? "the client"}.`);
  };

  const addAsTask = async () => {
    if (!answer) return;
    const text = answer.split("\n").find((l) => l.trim())?.trim().slice(0, 300) || "Follow up";
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${slug}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", text }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("Couldn't add the task — try again.");
      return;
    }
    setHandoff(`Added a task: "${text}". Refresh to see it in the Tasks card.`);
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
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {email && (
                <button className="btn ghost small" style={{ padding: "2px 10px", fontSize: 11 }} disabled={busy} onClick={startCompose}>
                  Use as email
                </button>
              )}
              <button className="btn ghost small" style={{ padding: "2px 10px", fontSize: 11 }} disabled={busy} onClick={addAsTask}>
                Add as task
              </button>
              <button className="btn ghost small" style={{ padding: "2px 10px", fontSize: 11 }} onClick={copy}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </span>
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

          {handoff && (
            <p className="ask-sent" style={{ marginTop: 10 }}>
              <span aria-hidden="true">✓</span> {handoff}
            </p>
          )}

          {composing && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <div className="k">Email to {email}</div>
              <input
                className="q-line"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                style={{ width: "100%", marginTop: 8 }}
              />
              <textarea
                className="q-box"
                rows={6}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                style={{ width: "100%", marginTop: 8 }}
              />
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                <button className="btn small" disabled={busy || !subject.trim() || !emailBody.trim()} onClick={sendEmail}>
                  {busy ? "Sending…" : "Send to client"}
                </button>
                <button className="btn ghost small" disabled={busy} onClick={() => setComposing(false)}>
                  Cancel
                </button>
                <span className="save-state">Reviewed by you before it sends.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
