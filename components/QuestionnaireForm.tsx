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
import { useEffect, useId, useRef, useState } from "react";
import { assetUrl } from "@/lib/assets";
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

// LC-021: the form tells the client it takes 25 to 30 minutes, and until now
// every answer lived in React state only, so a refresh, a back-navigation or
// a crashed tab lost the lot. Answers are autosaved per client slug and
// restored on mount. Every localStorage call is guarded: Safari private mode
// throws on setItem, and a form that cannot save a draft must still submit.
const DRAFT_PREFIX = "luminary-questionnaire-draft:";
const DRAFT_SAVE_MS = 500;

type Draft = { slug: string; at: string; answers: Answers };

function draftKey(slug: string): string {
  return DRAFT_PREFIX + slug;
}

function readDraft(slug: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(slug));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const d = parsed as Partial<Draft>;
    // The stored slug is checked as well as the key it was found under: a
    // hand-edited or stale value must never pour one client's answers into
    // another client's form.
    if (d.slug !== slug) return null;
    if (!d.answers || typeof d.answers !== "object" || Array.isArray(d.answers)) return null;
    const answers = d.answers as Answers;
    if (Object.keys(answers).length === 0) return null;
    return { slug, at: typeof d.at === "string" ? d.at : "", answers };
  } catch {
    // Unreadable or unparseable: treat it as no draft at all.
    return null;
  }
}

function writeDraft(slug: string, answers: Answers): void {
  try {
    if (Object.keys(answers).length === 0) {
      window.localStorage.removeItem(draftKey(slug));
      return;
    }
    window.localStorage.setItem(
      draftKey(slug),
      JSON.stringify({ slug, at: new Date().toISOString(), answers } satisfies Draft),
    );
  } catch {
    // Private mode or a full quota. The form keeps working in memory.
  }
}

function clearDraft(slug: string): void {
  try {
    window.localStorage.removeItem(draftKey(slug));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

// Content types the upload route whitelists; anything else (and anything
// markup-ish) uploads as a plain binary so nothing stored can render.
function safeContentType(raw: string): string {
  // Lowercased because the presigned PUT signs this exact string — the header
  // the browser sends has to match byte for byte.
  const type = (raw || "").toLowerCase();
  if (!type || /html|xml|javascript|svg/i.test(type)) return "application/octet-stream";
  if (/^(image|video|audio|font|application)\//.test(type)) return type;
  if (["text/plain", "text/csv", "text/markdown", "text/rtf"].includes(type)) return type;
  return "application/octet-stream";
}

// Files upload straight from the browser to R2 (the sibling "upload" endpoint
// only mints a presigned PUT scoped to this client's attachments folder —
// routing bytes through a function would cap files at 4.5 MB); each uploaded
// file becomes a JSON-encoded ref in answers[field.id] (see lib/attachments).
// The signed PUT pins content type AND length, so the header below must match
// what was sent to the signing route exactly.
function UploadControl({
  field,
  answers,
  setAnswer,
  lang,
  labelId,
  describedBy,
}: {
  field: Field;
  answers: Answers;
  setAnswer: (id: string, value: string | string[]) => void;
  lang: Lang;
  labelId: string;
  describedBy?: string;
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
      setErr(`Up to ${MAX_FILES_PER_FIELD} files per question. Remove one first, or email the rest to support@luminary-dev.xyz.`);
      return;
    }
    const queue = picked.slice(0, room);
    if (picked.length > room) {
      setErr(`Only the first ${room} of those fit: up to ${MAX_FILES_PER_FIELD} files per question.`);
    }
    setUploading(queue.length);
    const added: string[] = [];
    for (const f of queue) {
      if (f.size > MAX_FILE_BYTES) {
        setErr(`"${f.name}" is over 15 MB. Please compress it, or email it to support@luminary-dev.xyz.`);
        setUploading((n) => n - 1);
        continue;
      }
      try {
        const name = (f.name || "attachment").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120) || "attachment";
        const contentType = safeContentType(f.type);
        const signRes = await fetch("upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, contentType, size: f.size }),
        });
        const signed = await signRes.json().catch(() => null);
        if (!signRes.ok || !signed?.url || !signed?.key) {
          throw new Error(signed?.error || `Upload failed (${signRes.status}).`);
        }
        const put = await fetch(signed.url, {
          method: "PUT",
          headers: { "Content-Type": signed.contentType || contentType },
          body: f,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
        added.push(JSON.stringify({ n: name, u: assetUrl(signed.key), s: f.size }));
      } catch (e) {
        setErr(
          (e instanceof Error ? e.message : "Upload failed.") +
            ` "${f.name}" wasn't attached, please try again.`,
        );
      }
      setUploading((n) => n - 1);
    }
    if (added.length) setAnswer(field.id, [...stored, ...added]);
  };

  return (
    <div className="q-files" role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
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
      {/* Upload progress and failures are async: without a live region the
          client gets no announcement either way (LC-043). */}
      <span className="sr-only" aria-live="polite">
        {uploading > 0 ? t.uploading(uploading) : ""}
      </span>
      {err && <div className="q-file-err" role="alert">{err}</div>}
    </div>
  );
}

function FieldControl({
  field,
  answers,
  setAnswer,
  lang,
  placeholder,
  controlId,
  labelId,
  describedBy,
}: {
  field: Field;
  answers: Answers;
  setAnswer: (id: string, value: string | string[]) => void;
  lang: Lang;
  placeholder?: string;
  /** id of the single control, for the label's htmlFor. */
  controlId: string;
  /** id of the label text, for grouped controls that have no single input. */
  labelId: string;
  describedBy?: string;
}) {
  if (field.type === "upload") {
    return (
      <UploadControl
        field={field}
        answers={answers}
        setAnswer={setAnswer}
        lang={lang}
        labelId={labelId}
        {...(describedBy !== undefined ? { describedBy } : {})}
      />
    );
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
      <div
        className={`q-checks${field.grid ? " grid" : ""}`}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
      >
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
              aria-label={strings(lang).other}
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
        id={controlId}
        aria-describedby={describedBy}
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
      id={controlId}
      aria-describedby={describedBy}
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
  const uid = useId();
  const [answers, setAnswers] = useState<Answers>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sendCopy, setSendCopy] = useState(false);
  const [copyEmails, setCopyEmails] = useState("");
  const [copySent, setCopySent] = useState(false);
  const [company, setCompany] = useState(""); // honeypot
  const [restored, setRestored] = useState(false);
  /** Nothing is written back until the restore pass has run, so an empty
   *  first render cannot wipe the draft it is about to load. */
  const hydrated = useRef(false);
  /** Turned off the moment the answers reach the studio, so a debounced write
   *  already in flight cannot resurrect a submitted draft. */
  const saving = useRef(true);

  const setAnswer = (id: string, value: string | string[]) =>
    setAnswers((a) => ({ ...a, [id]: value }));

  useEffect(() => {
    const draft = readDraft(slug);
    if (draft) {
      setAnswers(draft.answers);
      setRestored(true);
    }
    hydrated.current = true;
  }, [slug]);

  useEffect(() => {
    if (!hydrated.current) return;
    const id = setTimeout(() => { if (saving.current) writeDraft(slug, answers); }, DRAFT_SAVE_MS);
    return () => clearTimeout(id);
  }, [answers, slug]);

  // The honeypot is deliberately absent from the draft: it must be empty on
  // every real submission, and persisting it would defeat the trap.
  const discardDraft = () => {
    clearDraft(slug);
    setAnswers({});
    setRestored(false);
  };

  const submit = async () => {
    setError(null);
    const name = ((answers.contactName as string) || "").trim();
    if (!name) {
      setError(t.errName);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // The schema marks three questions required and each renders a star, but
    // only the name was ever checked — so "describe" and "services", the two
    // answers the whole drafting pipeline is built on, could be submitted
    // blank while the form implied they could not.
    const missing = sections
      .flatMap((s) => s.fields)
      .filter((f) => "required" in f && f.required && f.id !== "contactName")
      .filter((f) => {
        const v = answers[f.id];
        return Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim();
      });
    if (missing.length) {
      setError(t.errRequired + missing.map((f) => fieldText(f, lang, co).label).join(" · "));
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
      // The answers are with the studio now, so the local draft has done its
      // job. Cleared before the done screen renders so a reload cannot
      // resurrect a submitted form.
      saving.current = false;
      clearDraft(slug);
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

      {restored && (
        <div className="notice notice--row" role="status">
          <span>{t.draftRestored}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn ghost small" onClick={() => setRestored(false)}>
              {t.draftKeep}
            </button>
            <button type="button" className="btn ghost small" onClick={discardDraft}>
              {t.draftDiscard}
            </button>
          </span>
        </div>
      )}

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
                const controlId = `${uid}-${field.id}`;
                const labelId = `${controlId}-label`;
                const hintId = ft.hint ? `${controlId}-hint` : undefined;
                // Checkbox sets and upload controls have no single input to
                // point a <label> at, so they are labelled groups instead of
                // an adjacent span nobody is told about (LC-043).
                const grouped = field.type === "checks" || field.type === "upload";
                const labelBody = (
                  <>
                    {ft.label}
                    {"required" in field && field.required && <span className="req"> *</span>}
                  </>
                );
                return (
                  <div className={`q-field${"width" in field && field.width === "half" ? " half" : ""}`} key={field.id}>
                    <div>
                      {grouped ? (
                        <span className="q-label" id={labelId}>{labelBody}</span>
                      ) : (
                        <label className="q-label" id={labelId} htmlFor={controlId}>{labelBody}</label>
                      )}
                      {ft.hint && <div className="q-hint" id={hintId}>{ft.hint}</div>}
                    </div>
                    <FieldControl
                      field={field}
                      answers={answers}
                      setAnswer={setAnswer}
                      lang={lang}
                      {...(ft.placeholder !== undefined ? { placeholder: ft.placeholder } : {})}
                      controlId={controlId}
                      labelId={labelId}
                      {...(hintId !== undefined ? { describedBy: hintId } : {})}
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
              <label className="q-label" htmlFor={`${uid}-copy`}>{t.copyTo}</label>
              <div className="q-hint" id={`${uid}-copy-hint`}>{t.copyHint}</div>
            </div>
            <input
              id={`${uid}-copy`}
              aria-describedby={`${uid}-copy-hint`}
              className="q-line"
              type="text"
              value={copyEmails}
              onChange={(e) => setCopyEmails(e.target.value)}
              placeholder="you@company.com, colleague@company.com"
            />
          </div>
        )}
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="submit-bar">
        <div className="submit-note">{t.submitNote}</div>
        {/* The button's own label changes, but a disabled control that has
            just taken the click announces nothing (LC-043). */}
        <span className="sr-only" aria-live="polite">{status === "sending" ? t.sending : ""}</span>
        <button className="btn" type="submit" disabled={status === "sending"}>
          {status === "sending" ? t.sending : t.submit}
        </button>
      </div>
    </form>
  );
}
