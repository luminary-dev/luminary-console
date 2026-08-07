"use client";

// The client-facing questionnaire form. Schema-driven: sections arrive as
// props from the server (per-client, with Claude's extra questions spliced
// in), and submission posts to the relative "submit" endpoint so the same
// component works on the client subdomain and in console preview.
//
// Bilingual: `lang` swaps every visible string through lib/questions.i18n
// (labels/hints by field id, checkbox labels by English option text). The
// ANSWERS never change — they're keyed by field id and checkbox values stay
// English — so switching language mid-form is lossless and the generation
// pipeline sees identical data either way.
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { Field, Section } from "@/lib/questions";
import {
  fieldText,
  hasExtras,
  optionText,
  sectionText,
  strings,
  type Lang,
} from "@/lib/questions.i18n";
import type { Answers } from "@/lib/types";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_FIELD,
  fmtSize,
  parseAttachment,
  type AttachmentRef,
} from "@/lib/attachments";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Content types the upload token whitelists; anything else (and anything
// markup-ish) uploads as a plain binary so the blob host never renders it.
function safeContentType(type: string): string {
  if (!type || /html|xml|javascript/i.test(type)) return "application/octet-stream";
  if (/^(image|video|audio|font|application)\//.test(type)) return type;
  if (["text/plain", "text/csv", "text/markdown", "text/rtf"].includes(type)) return type;
  return "application/octet-stream";
}

// Files upload straight from the browser to Blob (the sibling "upload"
// endpoint only signs a token scoped to this client's attachments folder —
// routing bytes through a function would cap files at 4.5 MB); each uploaded
// file becomes a JSON-encoded ref in answers[field.id] (see lib/attachments).
function UploadControl({
  slug,
  field,
  answers,
  setAnswer,
  lang,
}: {
  slug: string;
  field: Field;
  answers: Answers;
  setAnswer: (id: string, value: string | string[]) => void;
  lang: Lang;
}) {
  const t = strings(lang);
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
        const name = (f.name || "attachment").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120) || "attachment";
        const blob = await upload(`console/clients/${slug}/attachments/${name}`, f, {
          access: "public",
          handleUploadUrl: "upload",
          contentType: safeContentType(f.type),
        });
        added.push(JSON.stringify({ n: name, u: blob.url, s: f.size }));
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
                aria-label={t.removeFile(f.n)}
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
        {uploading > 0 ? t.uploading(uploading) : files.length > 0 ? t.attachMore : t.attach}
      </button>
      <span className="q-file-note">{t.fileNote}</span>
      {err && <div className="q-file-err">{err}</div>}
    </div>
  );
}

function FieldControl({
  slug,
  field,
  answers,
  setAnswer,
  lang,
  placeholder,
}: {
  slug: string;
  field: Field;
  answers: Answers;
  setAnswer: (id: string, value: string | string[]) => void;
  lang: Lang;
  placeholder?: string;
}) {
  if (field.type === "upload") {
    return <UploadControl slug={slug} field={field} answers={answers} setAnswer={setAnswer} lang={lang} />;
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
            {optionText(option, lang)}
          </label>
        ))}
        {field.other && (
          <span className="q-other">
            <label className="q-check">
              <input type="checkbox" checked={otherValue.length > 0} readOnly />
              {strings(lang).other}
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
        placeholder={placeholder}
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
      placeholder={placeholder}
      value={value}
      onChange={(e) => setAnswer(field.id, e.target.value)}
    />
  );
}

export default function QuestionnaireForm({
  slug,
  sections,
  lang = "en",
  co = "",
}: {
  slug: string;
  sections: Section[];
  lang?: Lang;
  /** Short company name — fills the {co} slot in translated labels. */
  co?: string;
}) {
  const t = strings(lang);
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
      setError(t.errName);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (sendCopy) {
      const valid = copyEmails.split(/[,;\s]+/).filter((e) => EMAIL_RE.test(e.trim()));
      if (valid.length === 0) {
        setError(t.errCopy);
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
      setError((e instanceof Error ? e.message : t.errGeneric) + t.errSuffix);
    }
  };

  if (status === "done") {
    return (
      <div className="done">
        <div className="done-mark">✓</div>
        <h2>{t.doneTitle}</h2>
        <p>
          {t.doneBody}
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>
          {t.doneBodyEnd}
        </p>
        {copySent && (
          <p>
            {t.doneCopy1}
            <strong>{copyEmails}</strong>
            {t.doneCopy2}
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

      {sections.map((section) => {
        const st = sectionText(section, lang, co);
        return (
          <section className="q-section" key={section.id}>
            <div className="q-eyebrow">{st.eyebrow}</div>
            <h2 className="q-h">{st.title}</h2>
            {st.sub && <p className="q-sub">{st.sub}</p>}
            {lang === "si" && hasExtras(section) && <p className="q-sub">{t.langNote}</p>}
            <div className="q-fields">
              {section.fields.map((field) => {
                const ft = fieldText(field, lang, co);
                return (
                  <div className={`q-field${"width" in field && field.width === "half" ? " half" : ""}`} key={field.id}>
                    <div>
                      <span className="q-label">
                        {ft.label}
                        {"required" in field && field.required && <span className="req"> *</span>}
                      </span>
                      {ft.hint && <div className="q-hint">{ft.hint}</div>}
                    </div>
                    <FieldControl
                      slug={slug}
                      field={field}
                      answers={answers}
                      setAnswer={setAnswer}
                      lang={lang}
                      placeholder={ft.placeholder}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

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
          {t.copyLabel}
        </label>
        {sendCopy && (
          <div className="q-field" style={{ marginTop: 14 }}>
            <div>
              <span className="q-label">{t.copyTo}</span>
              <div className="q-hint">{t.copyHint}</div>
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
        <div className="submit-note">{t.submitNote}</div>
        <button className="btn" type="submit" disabled={status === "sending"}>
          {status === "sending" ? t.sending : t.submit}
        </button>
      </div>
    </form>
  );
}
