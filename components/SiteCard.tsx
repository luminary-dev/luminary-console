"use client";

// "Finalized site" card: point it at a GitHub repo in the org and it deploys to
// a Vercel project, served to clients at <slug>.luminary-dev.xyz/site (which
// shows an under-maintenance page until published). Publish/unpublish/redeploy
// like the other deliverables. A manual "Set URL" path covers the case where
// Vercel/GitHub automation isn't wired up.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteEntry } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";

const ROOT = "luminary-dev.xyz";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "7px 0", borderTop: "1px solid var(--border)" }}>
      <span className="k" style={{ alignSelf: "center" }}>{label}</span>
      <span style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

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
    setSite(data?.site ?? undefined);
    router.refresh();
    return true;
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Remove finalized site?",
      danger: true,
      confirmLabel: "Remove",
      message: <>The <b>{site?.repo}</b> record and its <b>{slug}-live</b> subdomain are released. The Vercel project is left intact.</>,
    });
    if (ok) await call({ action: "delete" }, "delete");
  };

  const stateLabel = (s?: string) =>
    s === "READY" ? "Live build" : s === "ERROR" ? "Build failed" : s === "CANCELED" ? "Canceled" : s ? "Building…" : "—";
  const stateColor = (s?: string) =>
    s === "READY" ? "var(--a-text)" : s === "ERROR" ? "var(--danger, #d33)" : "var(--muted)";

  const clientPath = `${slug}.${ROOT}/site`;

  return (
    <div className="card">
      {dialog}
      <div className="ask-head">
        <h3>Finalized site</h3>
        {site && <span className={`pill${site.status === "draft" ? " grey" : ""}`}><i />{site.status}</span>}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
        Deploy the finished build from a GitHub repo in the org. Clients reach it at{" "}
        <span className="mono">{clientPath}</span> — which shows an under-maintenance page until you publish.
      </p>

      {!site ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="q-line" style={{ flex: "1 1 280px" }} placeholder="github.com/luminary-dev/eco-mech-site" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <input className="q-line" style={{ width: 110 }} placeholder="branch" value={ref} onChange={(e) => setRef(e.target.value)} />
            <button className="btn small" disabled={!!busy || !repo.trim()} onClick={() => call({ action: "deploy", repo, ref }, "deploy")}>
              {busy === "deploy" ? "Deploying…" : "Deploy"}
            </button>
          </div>
          <button className="btn ghost small" style={{ marginTop: 12 }} onClick={() => setShowManual((v) => !v)}>
            {showManual ? "Cancel" : "Set URL manually"}
          </button>
          {showManual && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <input className="q-line" style={{ flex: "1 1 280px" }} placeholder="https://the-live-site.example" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
              <button className="btn small" disabled={!!busy || !manualUrl.trim()} onClick={() => call({ action: "set", repo, ref, url: manualUrl }, "set")}>
                {busy === "set" ? "Saving…" : "Save site"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 4 }}>
            <Row label="Repository"><span className="mono">{site.repo}</span> · branch <span className="mono">{site.ref}</span></Row>
            <Row label="Build">
              <b style={{ color: stateColor(site.state) }}>{stateLabel(site.state)}</b>
            </Row>
            <Row label="Client link">
              <a href={`https://${clientPath}`} target="_blank" rel="noopener noreferrer">{clientPath}</a>
            </Row>
            {site.url && (
              <Row label="Live host">
                <a href={site.url} target="_blank" rel="noopener noreferrer">{site.url.replace(/^https?:\/\//, "")}</a>
              </Row>
            )}
            {site.domainStatus && (
              <Row label="Domain"><span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{site.domainStatus}</span></Row>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
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
            <button className="btn ghost small" style={{ color: "var(--danger, #ef4444)", borderColor: "rgba(239,68,68,.35)", marginLeft: "auto" }} disabled={!!busy} onClick={remove}>
              {busy === "delete" ? "…" : "Remove"}
            </button>
          </div>
          {site.status === "draft" && site.state === "READY" && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
              Build is live. <b>Publish</b> to switch <span className="mono">{clientPath}</span> from the maintenance page to the site.
            </p>
          )}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
