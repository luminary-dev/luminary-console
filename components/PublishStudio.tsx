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

export default function PublishStudio() {
  const [tab, setTab] = useState<Tab>("article");

  return (
    <>
      <div style={{ display: "flex", gap: 8, margin: "18px 0" }}>
        {(["article", "project"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn small${tab === t ? "" : " ghost"}`}
            onClick={() => setTab(t)}
          >
            {t === "article" ? "New article" : "New project"}
          </button>
        ))}
      </div>
      {tab === "article" ? <ArticleForm /> : <ProjectForm />}
    </>
  );
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
      <h3>PR opened ✓</h3>
      <p style={{ margin: "8px 0 14px" }}>
        <a href={r.prUrl} target="_blank" rel="noreferrer">
          {r.prUrl}
        </a>
        <br />
        <small>
          Merging it publishes {kind === "article" ? `/blog/${r.slug}` : `/work/${r.slug}`} to
          dev.luminary-dev.xyz; promote dev → prod to go live.
        </small>
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {r.cover && <img src={r.cover} alt="Generated cover" style={{ width: "100%", maxWidth: 320, height: "auto", borderRadius: 10 }} />}
        {(r.inline ?? []).map((src, i) => (
          <img key={i} src={src} alt={`Inline illustration ${i + 1}`} style={{ width: "100%", maxWidth: 320, height: "auto", borderRadius: 10 }} />
        ))}
        {r.thumbLight && <img src={r.thumbLight} alt="Light thumbnail" style={{ width: "100%", maxWidth: 320, height: "auto", borderRadius: 10 }} />}
        {r.thumbDark && <img src={r.thumbDark} alt="Dark thumbnail" style={{ width: "100%", maxWidth: 320, height: "auto", borderRadius: 10 }} />}
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
        <h3>Draft with AI (optional)</h3>
        <div className="q-fields">
          <div className="q-field">
            <span className="q-label">Brief</span>
            <textarea
              className="q-box"
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. A practical post on shipping WebSockets on Vercel Fluid Compute: what changed, patterns, pitfalls."
            />
          </div>
        </div>
        {draftError && <div className="form-error">{draftError}</div>}
        <button type="button" className="btn small" style={{ marginTop: 12 }} disabled={drafting || brief.trim().length < 12} onClick={draft}>
          {drafting ? "Drafting…" : "Draft article"}
        </button>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={publish}>
        <h3>Article</h3>
        <div className="q-fields">
          <div className="q-field half">
            <span className="q-label">Title <span className="req">*</span></span>
            <input className="q-line" value={f.title} onChange={set("title")} required />
          </div>
          <div className="q-field half">
            <span className="q-label">Slug</span>
            <input className="q-line" value={f.slug} onChange={set("slug")} placeholder="auto from title" />
          </div>
          <div className="q-field half">
            <span className="q-label">Tags (comma-separated)</span>
            <input className="q-line" value={f.tags} onChange={set("tags")} placeholder="nextjs, devops" />
          </div>
          <div className="q-field half">
            <span className="q-label">Excerpt</span>
            <input className="q-line" value={f.excerpt} onChange={set("excerpt")} />
          </div>
          <div className="q-field">
            <span className="q-label">Cover image scene</span>
            <input
              className="q-line"
              value={f.imageBrief}
              onChange={set("imageBrief")}
              placeholder="One sentence: a whimsical physical metaphor for the post (no screenshots)."
            />
          </div>
          <div className="q-field">
            <span className="q-label">Body (markdown) <span className="req">*</span></span>
            <textarea className="q-box" rows={16} value={f.body} onChange={set("body")} required />
          </div>
          <div className="q-field half">
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", marginTop: 22 }}>
              <input
                type="checkbox"
                checked={inlineImages}
                onChange={(e) => setInlineImages(e.target.checked)}
              />
              <span className="q-label" style={{ margin: 0 }}>
                Add illustrations inside the article
              </span>
            </label>
            <span className="gh-view-note" style={{ marginTop: 4 }}>
              One or two, placed under well-spaced sections. The count follows the length of the
              piece, so a short post gets one.
            </span>
          </div>
          <div className="q-field half">
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", marginTop: 22 }}>
              <input type="checkbox" checked={isDraftPost} onChange={(e) => setIsDraftPost(e.target.checked)} />
              <span className="q-label" style={{ margin: 0 }}>Mark as draft (hidden until the flag is removed)</span>
            </label>
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        {busy && (
          <div className="notice">
            Publishing: generating the cover with gpt-image-2 and opening the PR against dev. About a minute; don&apos;t close the tab.
          </div>
        )}
        <button className="btn" style={{ marginTop: 18 }} disabled={busy}>
          {busy ? "Publishing…" : "Generate cover & open PR"}
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
        <h3>Draft with AI</h3>
        <div className="q-fields">
          <div className="q-field">
            <span className="q-label">Brief</span>
            <textarea
              className="q-box"
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What was built, for whom, with what stack, and the results. Include the live URL or GitHub repo. e.g. 'Engineering project: a Terraform module registry with OPA policy gates… github.com/…'"
            />
          </div>
        </div>
        {draftError && <div className="form-error">{draftError}</div>}
        <button type="button" className="btn small" style={{ marginTop: 12 }} disabled={drafting || brief.trim().length < 12} onClick={draft}>
          {drafting ? "Drafting…" : "Draft case study"}
        </button>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={publish}>
        <h3>Project entry</h3>
        <div className="q-fields">
          <div className="q-field">
            <span className="q-label">Thumbnail scene <span className="req">*</span></span>
            <input
              className="q-line"
              value={imageBrief}
              onChange={(e) => setImageBrief(e.target.value)}
              placeholder="One sentence: the physical scene for the day/dusk thumbnail pair."
              required
            />
          </div>
          <div className="q-field">
            <span className="q-label">Entry (JSON, review before publishing) <span className="req">*</span></span>
            <textarea
              className="q-box"
              rows={22}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
              required
            />
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        {busy && (
          <div className="notice">
            Publishing: generating the day & dusk thumbnails with gpt-image-2, updating lib/projects.ts and opening the PR against dev. One to two minutes; don&apos;t close the tab.
          </div>
        )}
        <button className="btn" style={{ marginTop: 18 }} disabled={busy}>
          {busy ? "Publishing…" : "Generate thumbnails & open PR"}
        </button>
      </form>

      {result && <ResultCard r={result} kind="project" />}
    </>
  );
}
