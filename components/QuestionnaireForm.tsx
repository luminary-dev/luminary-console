"use client";

// The client-facing questionnaire form. Schema-driven: sections arrive as
// props from the server (per-client, with Claude's extra questions spliced
// in), and submission posts to the relative "submit" endpoint so the same
// component works on the client subdomain and in console preview.
import { useState } from "react";
import type { Field, Section } from "@/lib/questions";
import type { Answers } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function FieldControl({
  field,
  answers,
  setAnswer,
}: {
  field: Field;
  answers: Answers;
  setAnswer: (id: string, value: string | string[]) => void;
}) {
  if (field.type === "checks") {
    const selected = (answers[field.id] as string[] | undefined) ?? [];
    const otherValue = (answers[`${field.id}Other`] as string | undefined) ?? "";
    const toggle = (option: string) =>
      setAnswer(
        field.id,
        selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option],
      );
    return (
      <div className={`q-checks${field.grid ? " grid" : ""}`}>
        {field.options.map((option) => (
          <label className="q-check" key={option}>
            <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
            {option}
          </label>
        ))}
        {field.other && (
          <span className="q-other">
            <label className="q-check">
              <input type="checkbox" checked={otherValue.length > 0} readOnly />
              Other:
            </label>
            <input
              className="q-line"
              type="text"
              value={otherValue}
              onChange={(e) => setAnswer(`${field.id}Other`, e.target.value)}
            />
          </span>
        )}
      </div>
    );
  }

  const value = (answers[field.id] as string | undefined) ?? "";
  if (field.type === "textarea") {
    return (
      <textarea
        className="q-box"
        rows={field.rows ?? 3}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => setAnswer(field.id, e.target.value)}
        onInput={(e) => {
          const t = e.currentTarget;
          t.style.height = "auto";
          t.style.height = `${t.scrollHeight + 2}px`;
        }}
      />
    );
  }
  return (
    <input
      className="q-line"
      type="text"
      placeholder={field.placeholder}
      value={value}
      onChange={(e) => setAnswer(field.id, e.target.value)}
    />
  );
}

export default function QuestionnaireForm({ sections }: { sections: Section[] }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sendCopy, setSendCopy] = useState(false);
  const [copyEmails, setCopyEmails] = useState("");
  const [copySent, setCopySent] = useState(false);
  const [company, setCompany] = useState(""); // honeypot

  const setAnswer = (id: string, value: string | string[]) =>
    setAnswers((a) => ({ ...a, [id]: value }));

  const submit = async () => {
    setError(null);
    const name = ((answers.contactName as string) || "").trim();
    if (!name) {
      setError("Please tell us your name (first question) so we know who to reply to.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (sendCopy) {
      const valid = copyEmails.split(/[,;\s]+/).filter((e) => EMAIL_RE.test(e.trim()));
      if (valid.length === 0) {
        setError("You asked for a copy — please enter at least one valid email address for it.");
        return;
      }
    }
    setStatus("sending");
    try {
      const res = await fetch("submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, company, sendCopy, copyEmails }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status}).`);
      setCopySent(data?.copySent === true);
      setStatus("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setStatus("idle");
      setError(
        (e instanceof Error ? e.message : "Something went wrong.") +
          " Your answers are still here — please try again, or email us at support@luminary-dev.xyz.",
      );
    }
  };

  if (status === "done") {
    return (
      <div className="done">
        <div className="done-mark">✓</div>
        <h2>Thank you — we&apos;ve got it.</h2>
        <p>
          Your answers are with the studio as a PDF. We&apos;ll review them and come back within one
          business day with the confirmed scope and fixed quotation. Logos, photos or screenshots can
          be emailed to <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a> any time.
        </p>
        {copySent && (
          <p>
            A copy of your answers is on its way to <strong>{copyEmails}</strong> — check the inbox
            (and spam, the first time).
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
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

      {sections.map((section) => (
        <section className="q-section" key={section.id}>
          <div className="q-eyebrow">{section.eyebrow}</div>
          <h2 className="q-h">{section.title}</h2>
          {section.sub && <p className="q-sub">{section.sub}</p>}
          <div className="q-fields">
            {section.fields.map((field) => (
              <div className={`q-field${"width" in field && field.width === "half" ? " half" : ""}`} key={field.id}>
                <div>
                  <span className="q-label">
                    {field.label}
                    {"required" in field && field.required && <span className="req"> *</span>}
                  </span>
                  {field.hint && <div className="q-hint">{field.hint}</div>}
                </div>
                <FieldControl field={field} answers={answers} setAnswer={setAnswer} />
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="copy-block">
        <label className="q-check">
          <input
            type="checkbox"
            checked={sendCopy}
            onChange={(e) => {
              setSendCopy(e.target.checked);
              if (e.target.checked && !copyEmails.trim()) {
                setCopyEmails(((answers.contactEmail as string) || "").trim());
              }
            }}
          />
          Email a copy of my answers (PDF) to me / my team
        </label>
        {sendCopy && (
          <div className="q-field" style={{ marginTop: 14 }}>
            <div>
              <span className="q-label">Send the copy to</span>
              <div className="q-hint">One or more email addresses, separated by commas.</div>
            </div>
            <input
              className="q-line"
              type="text"
              value={copyEmails}
              onChange={(e) => setCopyEmails(e.target.value)}
              placeholder="you@company.com, colleague@company.com"
            />
          </div>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="submit-bar">
        <div className="submit-note">
          Pressing submit sends your answers directly to Luminary Studio as a PDF. Nothing is
          published anywhere.
        </div>
        <button className="btn" type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Submit questionnaire"}
        </button>
      </div>
    </form>
  );
}
