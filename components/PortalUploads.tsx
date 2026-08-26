"use client";

// Portal upload box: a persistent place for the client to send us files we
// need to receive over the whole engagement (brand assets, signed contracts,
// photos, references). Bytes go browser → R2 directly through the presigned
// PUT from the "upload" route (routing them through a function would cap at
// 4.5 MB); the ref is then recorded on the record via "files". Mirrors the
// question box: `base` is "" on the client subdomain and "/c/<slug>" in the
// console preview, so a relative path never resolves wrong.
import { useRef, useState } from "react";
import { assetUrl } from "@/lib/assets";
import { fmtSize, MAX_FILE_BYTES, MAX_FILES_PER_FIELD, type AttachmentRef } from "@/lib/attachments";

export type PortalFile = { name: string; size: number; at: string };

// Content types the upload route whitelists; anything else (and anything
// markup-ish) uploads as a plain binary so nothing stored can render.
function safeContentType(type: string): string {
  const t = (type || "").toLowerCase();
  if (!t || /html|xml|javascript|svg/i.test(t)) return "application/octet-stream";
  const ok =
    ["image/", "video/", "audio/", "font/", "application/"].some((p) => t.startsWith(p)) ||
    ["text/plain", "text/csv", "text/markdown", "text/rtf"].includes(t);
  return ok ? t : "application/octet-stream";
}

export default function PortalUploads({
  base = "",
  initial = [],
}: {
  base?: string;
  initial?: PortalFile[];
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PortalFile[]>(initial);
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (!picked.length) return;
    setError(null);
    const queue = picked.slice(0, MAX_FILES_PER_FIELD);
    if (picked.length > queue.length) {
      setError(`Only the first ${queue.length} files were taken: up to ${MAX_FILES_PER_FIELD} at a time.`);
    }
    setBusy(queue.length);
    let sent = 0;
    for (const f of queue) {
      if (f.size > MAX_FILE_BYTES) {
        setError(`"${f.name}" is over 15 MB. Please compress it, or email it to support@luminary-dev.xyz.`);
        setBusy((n) => n - 1);
        continue;
      }
      try {
        const name = (f.name || "file").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120) || "file";
        const contentType = safeContentType(f.type);
        const signRes = await fetch(`${base}/upload`, {
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
        const ref: AttachmentRef = { n: name, u: assetUrl(signed.key), s: f.size };
        const rec = await fetch(`${base}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: ref.n, url: ref.u, size: ref.s, by, note, company }),
        });
        const recData = await rec.json().catch(() => null);
        if (!rec.ok) throw new Error(recData?.error || `Couldn't save (${rec.status}).`);
        setFiles((prev) => [{ name: ref.n, size: ref.s, at: recData?.at ?? new Date(0).toISOString() }, ...prev]);
        sent++;
      } catch (err) {
        setError(
          (err instanceof Error ? err.message : "Upload failed.") +
            ` "${f.name}" wasn't sent. Please try again.`,
        );
      }
      setBusy((n) => n - 1);
    }
    if (sent) {
      setJustSent(sent);
      setNote("");
    }
  };

  return (
    <div className="card">
      <div className="ask-head">
        <h3>Send us files</h3>
        <button type="button" className="btn ghost small" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Upload"}
        </button>
      </div>

      {!open ? (
        <p className="ask-intro">
          Anything we need from you: brand assets, a signed contract, photos, reference material.
          Upload it here any time and it goes straight to the studio. Up to 15 MB per file.
        </p>
      ) : (
        <div className="ask-form">
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
            <span className="q-label">Your name (optional)</span>
            <input className="q-line" type="text" value={by} onChange={(e) => setBy(e.target.value)} />
          </label>
          <label className="ask-field">
            <span className="q-label">A note about these files (optional)</span>
            <textarea
              className="q-box"
              rows={2}
              maxLength={500}
              placeholder="e.g. Our logo in SVG and the signed agreement"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={onFiles}
            style={{ display: "none" }}
          />
          <button className="btn" type="button" disabled={busy > 0} onClick={() => inputRef.current?.click()}>
            {busy > 0 ? `Uploading… (${busy} left)` : "Choose files"}
          </button>
          {justSent > 0 && busy === 0 && (
            <p className="ask-sent" style={{ marginTop: 10 }}>
              <span aria-hidden="true">✓</span> {justSent} file{justSent > 1 ? "s" : ""} sent to the studio.
            </p>
          )}
          {error && <div className="form-error">{error}</div>}
        </div>
      )}

      {files.length > 0 && (
        <ul className="q-file-list" style={{ marginTop: 14 }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.at}-${i}`}>
              <span className="q-file-name">{f.name}</span>
              <span className="q-file-size">{fmtSize(f.size)}</span>
              <span className="q-file-size" aria-hidden="true">✓ received</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
