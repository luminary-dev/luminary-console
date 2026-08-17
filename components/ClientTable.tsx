"use client";

// Dashboard client list with search, stage-pill filters, and sortable columns.
// The server passes fully-computed rows (stage + outstanding + overdue already
// derived from records), so this component is pure UI state — no data fetching.
import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtLKR } from "@/lib/money";
import { STAGES, STAGE_LABELS } from "@/lib/stage";
import type { ClientStage } from "@/lib/types";

export type ClientRow = {
  slug: string;
  company: string;
  docNoBase: string;
  status: string;
  statusLabel: string;
  stage: ClientStage | null;
  createdAt: string;
  outstanding: number;
  overdue: boolean;
};

type SortKey = "company" | "outstanding" | "createdAt";

export default function ClientTable({ rows }: { rows: ClientRow[] }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<ClientStage | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });

  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ClientStage, number>;
    for (const r of rows) if (r.stage) c[r.stage]++;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (stage && r.stage !== stage) return false;
      if (!needle) return true;
      return (
        r.company.toLowerCase().includes(needle) ||
        r.docNoBase.toLowerCase().includes(needle) ||
        (r.stage ? STAGE_LABELS[r.stage].toLowerCase().includes(needle) : false)
      );
    });
    out = [...out].sort((a, b) => {
      const d = sort.dir;
      if (sort.key === "company") return a.company.localeCompare(b.company) * d;
      if (sort.key === "outstanding") return (a.outstanding - b.outstanding) * d;
      return a.createdAt.localeCompare(b.createdAt) * d;
    });
    return out;
  }, [rows, q, stage, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "company" ? 1 : -1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3>Clients</h3>
        <input
          className="q-line"
          type="search"
          placeholder="Search clients…  (or press ⌘K)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 280, width: "100%" }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        <button
          className={`pill${stage === null ? "" : " grey"}`}
          onClick={() => setStage(null)}
          style={{ cursor: "pointer", border: "1px solid var(--border-hi)", background: stage === null ? "var(--a-dim)" : "transparent" }}
        >
          All · {rows.length}
        </button>
        {STAGES.map((s) => (
          <button
            key={s}
            className={`pill${counts[s] === 0 ? " grey" : ""}`}
            onClick={() => setStage(stage === s ? null : s)}
            disabled={counts[s] === 0}
            style={{ cursor: counts[s] === 0 ? "default" : "pointer", border: "1px solid var(--border-hi)", background: stage === s ? "var(--a-dim)" : "transparent" }}
          >
            {STAGE_LABELS[s]} · {counts[s]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: 14, fontSize: 14 }}>
          {rows.length === 0 ? "No clients yet — create the first one." : "No clients match that filter."}
        </p>
      ) : (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="list">
            <thead>
              <tr>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("company")}>Client{arrow("company")}</th>
                <th>Doc no.</th>
                <th>Status</th>
                <th>Stage</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("outstanding")}>Outstanding{arrow("outstanding")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("createdAt")}>Created{arrow("createdAt")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.slug}>
                  <td style={{ fontWeight: 600 }}>{r.company}</td>
                  <td className="mono">{r.docNoBase}</td>
                  <td>
                    <span className={`pill${r.status === "created" ? " grey" : ""}`}><i />{r.statusLabel}</span>
                  </td>
                  <td>
                    {r.stage ? (
                      <span className={`pill${r.stage === "lead" || r.stage === "closed" ? " grey" : ""}`}><i />{STAGE_LABELS[r.stage]}</span>
                    ) : (
                      <span style={{ color: "var(--subtle)" }}>—</span>
                    )}
                  </td>
                  <td className="mono">
                    {r.outstanding > 0 ? (
                      <span style={r.overdue ? { color: "var(--danger, #d33)", fontWeight: 700 } : undefined}>
                        {fmtLKR(r.outstanding)}{r.overdue ? " · overdue" : ""}
                      </span>
                    ) : (
                      <span style={{ color: "var(--subtle)" }}>—</span>
                    )}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{r.createdAt.slice(0, 10)}</td>
                  <td><Link href={`/clients/${r.slug}`}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
