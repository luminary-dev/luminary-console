"use client";

// Dashboard client list with search, stage-pill filters, and sortable columns.
// The server passes fully-computed rows (stage + outstanding + overdue already
// derived from records), so this component is pure UI state — no data fetching.
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { fmtLKR } from "@/lib/money";
import { STAGES, STAGE_LABELS } from "@/lib/stage";
import type { ClientStage } from "@/lib/types";
import VirtualList, { VIRTUALIZE_THRESHOLD } from "@/components/VirtualList";

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

const SORT_LABELS: Record<SortKey, string> = {
  company: "Client",
  outstanding: "Outstanding",
  createdAt: "Created",
};

/** Columns in the table, so the virtual list's spacer rows span it correctly. */
const COLUMNS = 7;

/** Starting estimate for a row's height (12px padding twice plus the 13.5px
 *  line). VirtualList measures the real one from the DOM on first paint, so
 *  this only has to be close enough for the first frame. */
const ROW_HEIGHT = 44;

/** Height the list scrolls within once it is long enough to virtualize.
 *  Roughly a dozen rows: enough to work in, short enough that the window stays
 *  small on a thousand-row index. */
const VIEWPORT_HEIGHT = 560;

export default function ClientTable({ rows }: { rows: ClientRow[] }) {
  const searchId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : "");
  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    sort.key !== key ? "none" : sort.dir === 1 ? "ascending" : "descending";

  const virtualized = shown.length > VIRTUALIZE_THRESHOLD;

  // One row's markup, lifted out so the plain and the windowed body render
  // exactly the same thing. VirtualList injects aria-rowindex and its row
  // marker onto this <tr>.
  const renderRow = (r: ClientRow) => (
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
          <span style={{ color: "var(--muted)" }}>
            <span aria-hidden="true">-</span>
            <span className="sr-only">no stage</span>
          </span>
        )}
      </td>
      <td className="mono">
        {r.outstanding > 0 ? (
          <span style={r.overdue ? { color: "var(--danger, #d33)", fontWeight: 700 } : undefined}>
            {fmtLKR(r.outstanding)}{r.overdue ? " · overdue" : ""}
          </span>
        ) : (
          <span style={{ color: "var(--muted)" }}>
            <span aria-hidden="true">-</span>
            <span className="sr-only">nothing outstanding</span>
          </span>
        )}
      </td>
      <td style={{ color: "var(--muted)" }}>{r.createdAt.slice(0, 10)}</td>
      <td><Link href={`/clients/${r.slug}`}>Open<span aria-hidden="true"> →</span><span className="sr-only"> {r.company}</span></Link></td>
    </tr>
  );

  // A real button inside the th: focusable, Enter/Space operable, and the th
  // carries aria-sort so the direction is announced (LC-041).
  const sortHead = (key: SortKey) => (
    <th aria-sort={ariaSort(key)}>
      <button type="button" className="th-sort" onClick={() => toggleSort(key)}>
        {SORT_LABELS[key]}
        <span className="th-arrow" aria-hidden="true">{arrow(key)}</span>
      </button>
    </th>
  );

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3>Clients</h3>
        <label className="sr-only" htmlFor={searchId}>Search clients by name, document number, or stage</label>
        <input
          id={searchId}
          className="q-line"
          type="search"
          placeholder="Search clients…  (or press ⌘K)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 280, width: "100%" }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }} role="group" aria-label="Filter by stage">
        <button
          className={`pill${stage === null ? "" : " grey"}`}
          onClick={() => setStage(null)}
          aria-pressed={stage === null}
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
            aria-pressed={stage === s}
            style={{ cursor: counts[s] === 0 ? "default" : "pointer", border: "1px solid var(--border-hi)", background: stage === s ? "var(--a-dim)" : "transparent" }}
          >
            {STAGE_LABELS[s]} · {counts[s]}
          </button>
        ))}
      </div>

      {/* Filtering and sorting are silent for a screen reader otherwise: the
          rows just change under the cursor (LC-043). This count is the whole
          filtered list, never the rendered window (LC-030). */}
      <p className="sr-only" aria-live="polite">
        {`${shown.length} of ${rows.length} clients shown, sorted by ${SORT_LABELS[sort.key].toLowerCase()} ${ariaSort(sort.key)}.`}
      </p>
      {virtualized && (
        <p className="sr-only">
          Long list: use the up and down arrow keys to move between rows, Home and End for the first
          and last.
        </p>
      )}

      {shown.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: 14, fontSize: 14 }}>
          {rows.length === 0 ? "No clients yet. Create the first one." : "No clients match that filter."}
        </p>
      ) : (
        <div
          className="table-scroll"
          ref={scrollRef}
          // The scroller only gains a bounded height when there is something
          // to virtualize; a short list keeps growing with the card exactly as
          // it did.
          style={
            virtualized
              ? { marginTop: 12, maxHeight: VIEWPORT_HEIGHT, overflowY: "auto" }
              : { marginTop: 12 }
          }
        >
          {/* aria-rowcount is the full filtered list, not the DOM: with a
              window rendered, this is what tells assistive tech there are
              1,000 rows and which one it is on (LC-030). */}
          <table className="list" aria-rowcount={shown.length + 1}>
            <thead>
              <tr aria-rowindex={1}>
                {sortHead("company")}
                <th>Doc no.</th>
                <th>Status</th>
                <th>Stage</th>
                {sortHead("outstanding")}
                {sortHead("createdAt")}
                <th><span className="sr-only">Open client</span></th>
              </tr>
            </thead>
            <VirtualList
              items={shown}
              renderRow={renderRow}
              scrollRef={scrollRef}
              rowHeight={ROW_HEIGHT}
              viewportHeight={VIEWPORT_HEIGHT}
              columns={COLUMNS}
            />
          </table>
        </div>
      )}
    </div>
  );
}
