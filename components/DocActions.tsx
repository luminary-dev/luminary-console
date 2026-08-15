"use client";

// Per-document action row on the client detail page: publish/unpublish,
// regenerate with instructions, generate billing docs, retry drafting.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./ConfirmDialog";

export default function DocActions({
  slug,
  type,
  exists,
  status,
  billing,
  label,
  no,
}: {
  slug: string;
  type: string;
  exists: boolean;
  status?: string;
  billing?: boolean;
  label?: string;
  no?: string;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRevise, setShowRevise] = useState(false);
  const [instructions, setInstructions] = useState("");

  const act = async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/clients/${slug}/docs/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setError(data?.error || `Failed (${res.status})`);
      return false;
    }
    setShowRevise(false);
    setInstructions("");
    router.refresh();
    return true;
  };

  // Mirrors the billing flow: published documents must be unpublished first
  // (each step confirmed), drafts confirm once. The estimate is a one-way
  // door — nothing regenerates it — so the dialog says so.
  const remove = async () => {
    const name = `the ${(label ?? type).toLowerCase()}${no ? ` (${no})` : ""}`;
    if (status === "published") {
      const step1 = await confirm({
        title: "Unpublish first",
        danger: true,
        confirmLabel: "Unpublish",
        message: (
          <>
            {no ? <b>{no}</b> : <>This document</>} is <b>published</b> — it must be unpublished
            before it can be deleted. Unpublish it now?
          </>
        ),
      });
      if (!step1) return;
      if (!(await act("unpublish"))) return;
    }
    const sure = await confirm({
      title: "Delete document",
      danger: true,
      confirmLabel: "Delete permanently",
      message: (
        <>
          Permanently delete {name}? This cannot be undone.
          {type === "estimate" && (
            <>
              {" "}
              The estimate is generated when the client is created — there is no way to regenerate
              it afterwards.
            </>
          )}
        </>
      ),
    });
    if (!sure) return;
    await act("delete");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {exists && status === "draft" && (
          <button className="btn small" disabled={!!busy} onClick={() => act("publish")}>
            {busy === "publish" ? "…" : "Publish"}
          </button>
        )}
        {exists && status === "published" && (
          <button className="btn ghost small" disabled={!!busy} onClick={() => act("unpublish")}>
            {busy === "unpublish" ? "…" : "Unpublish"}
          </button>
        )}
        {exists && (
          <button className="btn ghost small" disabled={!!busy} onClick={() => setShowRevise((s) => !s)}>
            Revise
          </button>
        )}
        {!exists && billing && (
          <button className="btn small" disabled={!!busy} onClick={() => setShowRevise((s) => !s)}>
            Generate
          </button>
        )}
        {exists && (
          <button
            className="btn ghost small"
            style={{ color: "var(--danger)", borderColor: "rgba(239,68,68,.35)" }}
            disabled={!!busy}
            onClick={remove}
          >
            {busy === "delete" ? "…" : "Delete"}
          </button>
        )}
      </div>
      {showRevise && (
        <div style={{ marginTop: 10 }}>
          <textarea
            className="q-box"
            rows={2}
            placeholder={
              exists
                ? "Revision instructions — e.g. 'drop the total to 40,000 and add a maintenance line'"
                : "What to bill — e.g. '30% design-approval against the quotation' or 'receipt for 22,500 received today by bank transfer'"
            }
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <button
            className="btn small"
            style={{ marginTop: 8 }}
            disabled={!!busy || (exists && !instructions.trim())}
            onClick={() => act(exists ? "regenerate" : "generate", { instructions })}
          >
            {busy ? "Working… (takes ~30s)" : exists ? "Regenerate" : "Generate"}
          </button>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {dialog}
    </div>
  );
}
