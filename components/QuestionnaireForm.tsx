"use client";

// The client-facing questionnaire form. Schema-driven: sections arrive as
// props from the server (per-client, with Claude's extra questions spliced
// in), and submission posts to the relative "submit" endpoint so the same
// component works on the client subdomain and in console preview.
import { useRef, useState } from "react";
import type { Field, Section } from "@/lib/questions";
import type { Answers } from "@/lib/types";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_FIELD,
  fmtSize,
  parseAttachment,
  type AttachmentRef,
} from "@/lib/attachments";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Uploads go to the sibling "upload" endpoint immediately on pick, so submit
// stays a small JSON POST; each uploaded file becomes a JSON-encoded ref in
// answers[field.id] (see lib/attachments.ts).
function UploadControl({
  field,
  answers,
  setAnswer,
}: {
  field: Field;
  answers: Answers;
  setAnswer: (id: string, value: string | string[]) => void;
}) {
  const stored = (answers[field.id] as string[] | undefined) ?? [];
  const files = stored.map(parseAttachment).filter(Boolean) as AttachmentRef[];
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setErr(null);
    const picked = Array.from(list);
    if (inputRef.current) inputRef.current.value = "";
    const room = MAX_FILES_PER_FIELD - stored.length;
    if (room <= 0) {
      setErr(`Up to ${MAX_FILES_PER_FIELD} files per question — remove one first, or email the rest to support@luminary-dev.xyz.`);
      return;
    }
    const queue = picked.slice(0, room);
    if (picked.length > room) {
      setErr(`Only the first ${room} of those fit — up to ${MAX_FILES_PER_FIELD} files per question.`);
    }
    setUploading(queue.length);
    const added: string[] = [];
    for (const f of queue) {
      if (f.size > MAX_FILE_BYTES) {
        setErr(`"${f.name}" is over 15 MB — please compress it, or email it to support@luminary-dev.xyz.`);
        setUploading((n) => n - 1);
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.url) throw new Error(data?.error || `Upload failed (${res.status}).`);
        added.push(JSON.stringify({ n: data.name, u: data.url, s: data.size }));
      } catch (e) {
        setErr(
          (e instanceof Error ? e.message : "Upload failed.") +
            ` "${f.name}" wasn't attached — please try again.`,
        );
      }
      setUploading((n) => n - 1);
    }
    if (added.length) setAnswer(field.id, [...stored, ...added]);
  };

  return (
    <div className="q-files">
      {files.length > 0 && (
        <ul className="q-file-list">
          {files.map((f, i) => (
            <li key={`${f.u}-${i}`}>
              <span className="q-file-name">{f.n}</span>
              <span className="q-file-size">{fmtSize(f.s)}</span>
              <button
                type="button"
                className="q-file-x"
                aria-label={`Remove ${f.n}`}
                onClick={() => setAnswer(field.id, stored.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <button
        type="button"
        className="q-file-btn"
        disabled={uploading > 0}
        onClick={() => inputRef.current?.click()}
      >
        {uploading > 0
          ? `Uploading ${uploading} file${uploading > 1 ? "s" : ""}…`
          : files.length > 0
            ? "+ Attach more files"
            : "+ Attach files"}
      </button>
      <span className="q-file-note">Any file type · up to 15 MB each</span>
      {err && <div className="q-file-err">{err}</div>}
    </div>
  );
}

function FieldControl({
  field,
  answers,
  setAnswer,
}: {
  field: Field;
  answers: Answers;
  setAnswer: (id: string, value: string | string[]) => void;
}) {
  if (field.type === "upload") {
    return <UploadControl field={field} answers={answers} setAnswer={setAnswer} />;
  }

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
          Your answers — and every file you attached — are with the studio as a PDF. We&apos;ll
          review them and come back within one business day with the confirmed scope and fixed
          quotation. Anything you forgot to attach can be emailed to{" "}
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a> any time.
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
