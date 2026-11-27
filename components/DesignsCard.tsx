"use client";

// Client "Design previews" card: the 3 concept prototypes promised in the SOW.
// Add each as a single self-contained HTML file; it is served at a path under
// the client's existing subdomain (<domain>/design/<id>). Drafts show a holding
// page in public and are previewed here; publishing makes the path public.
// Publish / unpublish / replace / delete per slot (delete confirms first).
import { useCallback, useRef, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { MAX_DESIGNS, designUrl } from "@/lib/designs";
import type { DesignEntry } from "@/lib/types";
import { opsFetch } from "@/lib/ops-fetch";
import { shortWhenLabel } from "@/lib/time";
import HowItWorks from "./HowItWorks";
import MoreActions from "./MoreActions";

export default function DesignsCard({
  slug,
  domain,
  initial,
  selectedId,
}: {
  slug: string;
  domain: string;
  initial: DesignEntry[];
  /** The concept the client picked from their portal, if any. */
  selectedId?: string;
}) {
  const [designs, setDesigns] = useState<DesignEntry[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const targetId = useRef<string | undefined>(undefined); // undefined = add new slot

  const openPicker = (id?: string) => {
    targetId.current = id;
    setError(null);
    fileRef.current?.click();
  };

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const html = await file.text();
      const title = file.name.replace(/\.html?$/i, "").slice(0, 80);
      const res = await opsFetch(`/api/clients/${slug}/designs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, title, id: targetId.current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(data?.error || "Upload failed.");
      else setDesigns(data.designs);
    } catch {
      setError("Could not read that file.");
    } finally {
      setBusy(false);
    }
  }, [slug]);

  const act = async (id: string, action: "publish" | "unpublish") => {
    setBusy(true);
    setError(null);
    const res = await opsFetch(`/api/clients/${slug}/designs/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) setError(data?.error || "That did not work.");
    else setDesigns(data.designs);
    setBusy(false);
  };

  const remove = async (d: DesignEntry) => {
    const ok = await confirm({
      title: "Delete this design?",
      message: (
        <>
          <b>{d.title}</b> ({designUrl(domain, d.id)}) will be removed. This cannot be undone.
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const res = await opsFetch(`/api/clients/${slug}/designs/${d.id}`, { method: "DELETE" }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) setError(data?.error || "Delete failed.");
    else setDesigns(data.designs ?? []);
    setBusy(false);
  };

  const full = designs.length >= MAX_DESIGNS;

  return (
    <div className="card">
      {dialog}
      <input
        ref={fileRef}
        type="file"
        accept=".html,.htm,text/html"
        onChange={onFile}
        style={{ display: "none" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3>Design ideas</h3>
        <button className="btn ghost small" onClick={() => openPicker()} disabled={busy || full}>
          {busy ? "Working…" : "Add a design"}
        </button>
      </div>
      <p className="empty-note" style={{ marginTop: 6 }}>
        Up to {MAX_DESIGNS} designs for the client to choose from. Publish one and it appears on
        their page, where they can look at it and pick the one they want.
      </p>
      <HowItWorks>
        <p>
          Each design is a single HTML file, shown at{" "}
          <span className="mono">{domain}/design/&lt;n&gt;</span>. Until it is published that address
          shows a holding page, and only we can preview it here. Publishing also makes a
          laptop-width PDF the client can download.
        </p>
      </HowItWorks>
      {error && (
        <p className="notice" style={{ marginTop: 10, color: "var(--danger)", fontSize: 13 }}>
          {error}
        </p>
      )}

      {designs.length === 0 ? (
        <p className="empty-note" style={{ marginTop: 12 }}>
          No designs yet. Add the first one, then publish it so the client can see it.
        </p>
      ) : (
        <div style={{ marginTop: 6 }}>
          {designs.map((d) => {
            const url = designUrl(domain, d.id);
            return (
              <div
                key={d.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: "12px 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {d.title}
                    {selectedId === d.id && (
                      <span className="pill" style={{ background: "var(--accent)", color: "var(--on-accent)", borderColor: "var(--accent)" }}>
                        Client&apos;s choice
                      </span>
                    )}
                    {d.status === "published" ? (
                      <span className="pill"><i />Published</span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px" }}>
                        Draft
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere", marginTop: 2 }}>
                    {d.status === "published" ? (
                      <a className="copy-url" href={url} target="_blank" rel="noopener noreferrer">{domain}/design/{d.id}</a>
                    ) : (
                      <span className="mono">{domain}/design/{d.id}</span>
                    )}{" "}
                    · <span className="mono">{shortWhenLabel(d.updatedAt)}</span>
                  </div>
                </div>
                <div className="row-actions" style={{ flex: "0 1 auto", justifyContent: "flex-end" }}>
                  {d.status !== "published" && (
                    <button className="btn small" onClick={() => act(d.id, "publish")} disabled={busy}>
                      Publish
                    </button>
                  )}
                  <a className="btn ghost small" href={`/api/clients/${slug}/designs/${d.id}`} target="_blank" rel="noopener noreferrer">
                    Preview
                  </a>
                  <MoreActions>
                    {d.status === "published" && (
                      <button className="btn ghost small" onClick={() => act(d.id, "unpublish")} disabled={busy}>
                        Unpublish
                      </button>
                    )}
                    <button className="btn ghost small" onClick={() => openPicker(d.id)} disabled={busy}>
                      Replace the file
                    </button>
                    <button className="btn ghost small is-danger" onClick={() => remove(d)} disabled={busy}>
                      Delete
                    </button>
                  </MoreActions>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
