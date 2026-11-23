"use client";

// Bring the researched shops into the console. The list is a JSON file kept in
// the private Shopfront repository (sales/leads-checked.json); it is uploaded
// here by an operator and stored in the bucket, never committed to this
// repository, which is public.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Result =
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string; problems: string[] };

export default function ImportShops({ count }: { count: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setResult(null);
    const body = await file.text().catch(() => "");
    const res = await fetch("/api/sales/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => null);
    const data = res
      ? ((await res.json().catch(() => null)) as
          | { total?: number; added?: number; removed?: number; error?: string; problems?: string[] }
          | null)
      : null;
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!res?.ok || !data) {
      setResult({
        kind: "error",
        text: data?.error || "The list was not imported. Check your connection and try again.",
        problems: data?.problems ?? [],
      });
      return;
    }
    setResult({
      kind: "ok",
      text: `Imported ${data.total ?? 0} shops: ${data.added ?? 0} new${data.removed ? `, ${data.removed} no longer on the list` : ""}. Progress already recorded was kept.`,
    });
    router.refresh();
  };

  return (
    <div>
      <label className="btn ghost small" style={{ display: "inline-block", cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Importing" : count > 0 ? "Import a newer list" : "Import the shop list"}
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {result?.kind === "ok" && (
        <p className="notice" role="status">
          {result.text}
        </p>
      )}
      {result?.kind === "error" && (
        <div className="form-error" role="alert">
          {result.text}
          {result.problems.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {result.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
