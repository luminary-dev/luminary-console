"use client";

// "Finalized site" card: point it at a GitHub repo in the org and it deploys to
// a Vercel project served at <slug>-live.luminary-dev.xyz, then publish it to
// the client portal — same lifecycle as designs. Deploys are async, so after
// "Deploy" use "Refresh status" until the build is READY. A manual "Set URL"
// path covers the case where Vercel/GitHub automation isn't wired up.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteEntry } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";

export default function SiteCard({ slug, initial }: { slug: string; initial?: SiteEntry }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [site, setSite] = useState<SiteEntry | undefined>(initial);
  const [repo, setRepo] = useState(initial?.repo ?? "");
  const [ref, setRef] = useState(initial?.ref ?? "main");
  const [manualUrl, setManualUrl] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (payload: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    const res = await fetch(`/api/clients/${slug}/site`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(null);
    if (!res || !res.ok) {
      setError(data?.error || `That didn't work (${res?.status ?? "network"}).`);
      return false;
    }
    if (data?.site !== undefined) setSite(data.site);
    else setSite(undefined); // delete
    router.refresh();
    return true;
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Remove finalized site?",
      danger: true,
      confirmLabel: "Remove",
      message: <>The <b>{site?.repo}</b> deployment record and its <b>{slug}-live</b> subdomain will be released. The Vercel project itself is left intact.</>,
    });
    if (!ok) return;
    await call({ action: "delete" }, "delete");
  };

  const stateLabel = (s?: string) =>
    s === "READY" ? "Live" : s === "ERROR" ? "Build failed" : s === "CANCELED" ? "Canceled" : s ? "Building…" : "—";

  return (
    <div className="card">
      {dialog}
      <div className="ask-head">
        <h3>Finalized site</h3>
        {site && <span className={`pill${site.status === "draft" ? " grey" : ""}`}><i />{site.status}</span>}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
        Deploy the finished build from a GitHub repo in the org to{" "}
        <span className="mono">{slug}-live.luminary-dev.xyz</span>. Publish to show a{" "}
        <b>Visit your live site</b> link on the client portal.
      </p>

      {!site ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="q-line" style={{ flex: "1 1 260px" }} placeholder="github.com/luminary-dev/eco-mech-site" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <input className="q-line" style={{ maxWidth: 120 }} placeholder="branch" value={ref} onChange={(e) => setRef(e.target.value)} />
            <button className="btn small" disabled={!!busy || !repo.trim()} onClick={() => call({ action: "deploy", repo, ref }, "deploy")}>
              {busy === "deploy" ? "Deploying…" : "Deploy"}
            </button>
          </div>
          <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setShowManual((v) => !v)}>
            {showManual ? "Cancel" : "Set URL manually"}
          </button>
          {showManual && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <input className="q-line" style={{ flex: "1 1 260px" }} placeholder="https://the-live-site.example" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
              <button className="btn small" disabled={!!busy || !manualUrl.trim()} onClick={() => call({ action: "set", repo, ref, url: manualUrl }, "set")}>
                {busy === "set" ? "Saving…" : "Save site"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13.5 }}>
            <div><span className="k">Repo</span> <span className="mono">{site.repo}</span> · <span className="k">branch</span> <span className="mono">{site.ref}</span></div>
            <div style={{ marginTop: 4 }}>
              <span className="k">Status</span>{" "}
              <b style={{ color: site.state === "READY" ? "var(--a-text)" : site.state === "ERROR" ? "var(--danger, #d33)" : "var(--muted)" }}>
                {stateLabel(site.state)}
              </b>
              {site.url && (
                <> · <a href={site.url} target="_blank" rel="noopener noreferrer">{site.url.replace(/^https?:\/\//, "")}</a></>
              )}
            </div>
            {site.domainStatus && <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{site.domainStatus}</div>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn ghost small" disabled={!!busy} onClick={() => call({ action: "refresh" }, "refresh")}>
              {busy === "refresh" ? "…" : "Refresh status"}
            </button>
            {site.status === "draft" ? (
              <button className="btn small" disabled={!!busy || site.state !== "READY"} onClick={() => call({ action: "publish" }, "publish")}>
                {busy === "publish" ? "…" : "Publish"}
              </button>
            ) : (
              <button className="btn ghost small" disabled={!!busy} onClick={() => call({ action: "unpublish" }, "unpublish")}>
                {busy === "unpublish" ? "…" : "Unpublish"}
              </button>
            )}
            <button className="btn ghost small" disabled={!!busy} onClick={() => call({ action: "redeploy" }, "redeploy")}>
              {busy === "redeploy" ? "…" : "Redeploy"}
            </button>
            <button className="btn ghost small" style={{ color: "var(--danger, #ef4444)", borderColor: "rgba(239,68,68,.35)" }} disabled={!!busy} onClick={remove}>
              {busy === "delete" ? "…" : "Remove"}
            </button>
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
