"use client";

import { useState } from "react";
import type { ArticleDraft, ProjectDraft } from "@/lib/publish/draft";
import { opsFetch } from "@/lib/ops-fetch";

// The publish portal: drafts (optionally with AI), reviews, and publishes
// content to the landing page — each publish generates the artwork
// (gpt-image-2, house Tintin-3D style) and opens a PR against the landing
// repo's dev branch. Nothing here ships without that PR being merged.

type Tab = "article" | "project";

type PublishResult = {
  prUrl: string;
  slug: string;
  cover?: string;
  inline?: string[];
  thumbLight?: string;
  thumbDark?: string;
};

export default function PublishStudio({ kind = "article" }: { kind?: Tab }) {
  // Which form shows is decided by the address (see app/publish/page.tsx), so
  // the menu's two entries each open their own.
  return kind === "article" ? <ArticleForm /> : <ProjectForm />;
}

function useDraft<T>(kind: Tab) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (brief: string): Promise<T | null> => {
    setDrafting(true);
    setError(null);
    try {
      const res = await opsFetch("/api/publish/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, brief }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.draft) throw new Error(data?.error || `Drafting failed (${res.status}).`);
      return data.draft as T;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drafting failed.");
      return null;
    } finally {
      setDrafting(false);
    }
  };
  return { drafting, error, setError, run };
}

function ResultCard({ r, kind }: { r: PublishResult; kind: Tab }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Sent for approval</h3>
      <p style={{ margin: "8px 0 16px" }}>
        <a href={r.prUrl} target="_blank" rel="noreferrer">
          {r.prUrl}
        </a>
        <br />
        <small>
          This is the pull request a teammate checks. Adding it puts{" "}
          {kind === "article" ? `/blog/${r.slug}` : `/work/${r.slug}`} on the test site,
          dev.luminary-dev.xyz. It reaches the public site when dev is promoted to prod.
        </small>
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {r.cover && <img src={r.cover} alt="Generated cover" loading="lazy" style={{ width: "100%", maxWidth: 320, aspectRatio: "3 / 4", objectFit: "contain", borderRadius: 10 }} />}
        {(r.inline ?? []).map((src, i) => (
          <img key={i} src={src} alt={`Inline illustration ${i + 1}`} loading="lazy" style={{ width: "100%", maxWidth: 320, aspectRatio: "4 / 3", objectFit: "contain", borderRadius: 10 }} />
        ))}
        {r.thumbLight && <img src={r.thumbLight} alt="Light thumbnail" loading="lazy" style={{ width: "100%", maxWidth: 320, aspectRatio: "16 / 10", objectFit: "contain", borderRadius: 10 }} />}
        {r.thumbDark && <img src={r.thumbDark} alt="Dark thumbnail" loading="lazy" style={{ width: "100%", maxWidth: 320, aspectRatio: "16 / 10", objectFit: "contain", borderRadius: 10 }} />}
      </div>
    </div>
  );
}

function ArticleForm() {
  const { drafting, error: draftError, run } = useDraft<ArticleDraft>("article");
  const [brief, setBrief] = useState("");
  const [f, setF] = useState({ title: "", slug: "", tags: "", excerpt: "", imageBrief: "", body: "" });
  const [isDraftPost, setIsDraftPost] = useState(false);
  const [inlineImages, setInlineImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const draft = async () => {
    const d = await run(brief);
    if (d) setF({ title: d.title, slug: d.slug, tags: d.tags.join(", "), excerpt: d.excerpt, imageBrief: d.imageBrief, body: d.body });
  };

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await opsFetch("/api/publish/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.title,
          slug: f.slug,
          excerpt: f.excerpt,
          imageBrief: f.imageBrief,
          body: f.body,
          draft: isDraftPost,
          inlineImages,
          tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.prUrl) throw new Error(data?.error || `Publish failed (${res.status}).`);
      setResult(data as PublishResult);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h3>Have a first draft written (optional)</h3>
        <div className="q-fields">
          <label className="q-field">
            <span className="q-label">Brief</span>
            <textarea
              className="q-box"
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. A practical post on shipping WebSockets on Vercel Fluid Compute: what changed, patterns, pitfalls."
            />
          </label>
        </div>
        {draftError && <div className="form-error" role="alert">{draftError}</div>}
        <button type="button" className="btn small" style={{ marginTop: 12 }} disabled={drafting || brief.trim().length < 12} onClick={draft}>
          {drafting ? "Drafting…" : "Draft article"}
        </button>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={publish}>
        <h3>The post</h3>
        <div className="q-fields">
          <label className="q-field half">
            <span className="q-label">Title <span className="req">*</span></span>
            <input className="q-line" value={f.title} onChange={set("title")} required />
          </label>
          <label className="q-field half">
            <span className="q-label">Short name for its address</span>
            <input className="q-line" value={f.slug} onChange={set("slug")} placeholder="auto from title" />
          </label>
          <label className="q-field half">
            <span className="q-label">Tags (comma-separated)</span>
            <input className="q-line" value={f.tags} onChange={set("tags")} placeholder="nextjs, devops" />
          </label>
          <label className="q-field half">
            <span className="q-label">One-line summary</span>
            <input className="q-line" value={f.excerpt} onChange={set("excerpt")} />
          </label>
          <label className="q-field">
            <span className="q-label">What the cover picture should show</span>
            <input
              className="q-line"
              value={f.imageBrief}
              onChange={set("imageBrief")}
              placeholder="One sentence: a whimsical physical metaphor for the post (no screenshots)."
            />
          </label>
          <label className="q-field">
            <span className="q-label">The post itself (markdown) <span className="req">*</span></span>
            <textarea className="q-box" rows={16} value={f.body} onChange={set("body")} required />
          </label>
          <div className="q-field half">
            <label className="check-row">
              <input
                className="check-24"
                type="checkbox"
                checked={inlineImages}
                onChange={(e) => setInlineImages(e.target.checked)}
              />
              <span className="q-label">Add illustrations inside the article</span>
            </label>
            <span className="gh-view-note" style={{ marginTop: 4 }}>
              One or two, placed under well-spaced sections. The count follows the length of the
              piece, so a short post gets one.
            </span>
          </div>
          <div className="q-field half">
            <label className="check-row">
              <input className="check-24" type="checkbox" checked={isDraftPost} onChange={(e) => setIsDraftPost(e.target.checked)} />
              <span className="q-label">Keep it hidden for now (a draft)</span>
            </label>
          </div>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {busy && (
          <div className="notice">
            Working: the cover picture is being made and the post sent for approval. About a minute. Keep this tab open.
          </div>
        )}
        <button className="btn" style={{ marginTop: 20 }} disabled={busy}>
          {busy ? "Working…" : "Make the cover and send for approval"}
        </button>
      </form>

      {result && <ResultCard r={result} kind="article" />}
    </>
  );
}

function ProjectForm() {
  const { drafting, error: draftError, run } = useDraft<ProjectDraft>("project");
  const [brief, setBrief] = useState("");
  const [json, setJson] = useState("");
  const [imageBrief, setImageBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  const draft = async () => {
    const d = await run(brief);
    if (d) {
      const { imageBrief: ib, ...rest } = d;
      setImageBrief(ib);
      setJson(JSON.stringify(rest, null, 2));
    }
  };

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    let project: unknown;
    try {
      project = JSON.parse(json);
    } catch {
      setError("The project JSON doesn't parse. Fix it and try again.");
      return;
    }
    setBusy(true);
    try {
      const res = await opsFetch("/api/publish/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, imageBrief }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.prUrl) throw new Error(data?.error || `Publish failed (${res.status}).`);
      setResult(data as PublishResult);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h3>Have a first draft written</h3>
        <div className="q-fields">
          <label className="q-field">
            <span className="q-label">Brief</span>
            <textarea
              className="q-box"
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What was built, for whom, with what stack, and the results. Include the live URL or GitHub repo. e.g. 'Engineering project: a Terraform module registry with OPA policy gates… github.com/…'"
            />
          </label>
        </div>
        {draftError && <div className="form-error" role="alert">{draftError}</div>}
        <button type="button" className="btn small" style={{ marginTop: 12 }} disabled={drafting || brief.trim().length < 12} onClick={draft}>
          {drafting ? "Drafting…" : "Draft case study"}
        </button>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={publish}>
        <h3>The project</h3>
        <div className="q-fields">
          <label className="q-field">
            <span className="q-label">What the picture should show <span className="req">*</span></span>
            <input
              className="q-line"
              value={imageBrief}
              onChange={(e) => setImageBrief(e.target.value)}
              placeholder="One sentence: the physical scene for the day/dusk thumbnail pair."
              required
            />
          </label>
          <label className="q-field">
            <span className="q-label">The entry (JSON: read it over before sending) <span className="req">*</span></span>
            <textarea
              className="q-box"
              rows={22}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}
              required
            />
          </label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {busy && (
          <div className="notice">
            Working: the day and dusk pictures are being made and the project sent for approval. One to two minutes. Keep this tab open.
          </div>
        )}
        <button className="btn" style={{ marginTop: 20 }} disabled={busy}>
          {busy ? "Working…" : "Make the pictures and send for approval"}
        </button>
      </form>

      {result && <ResultCard r={result} kind="project" />}
    </>
  );
}
