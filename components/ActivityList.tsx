"use client";

// Activity table that starts short — only the last 24 hours — and pages older
// entries in on "See more". Used by both the global Activity page (with a
// "Where" column + client links) and the per-project card (without). `now` is
// passed from the server so relTime renders the same on both sides (no
// hydration mismatch). Entries must arrive newest-first.
import Link from "next/link";
import { useState } from "react";
import { relTime, whenLabel } from "@/lib/time";
import { displayName } from "@/lib/admins";

export type ActivityRow = { at: string; actor: string; action: string; target: string; detail?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 20;

export default function ActivityList({
  entries,
  now,
  clients,
}: {
  entries: ActivityRow[];
  now: number;
  /** slug → company. When given, a linked "Where" column is shown. */
  clients?: Record<string, string>;
}) {
  // Entries within the last 24h are the leading run (list is newest-first).
  const within24h = entries.filter((e) => now - Date.parse(e.at) <= DAY_MS).length;
  const [shown, setShown] = useState(within24h);
  const visible = entries.slice(0, shown);
  const remaining = entries.length - shown;
  const showWhere = !!clients;

  return (
    <>
      {entries.length === 0 ? (
        <p className="empty-note">Nothing logged yet.</p>
      ) : visible.length === 0 ? (
        <p className="empty-note">Nothing in the last 24 hours.</p>
      ) : (
        <div className="table-scroll">
          <table className="list">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                {showWhere && <th>Where</th>}
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }} title={whenLabel(e.at)}>
                    {relTime(e.at, now)}
                  </td>
                  <td style={{ overflowWrap: "anywhere" }} title={e.actor}>{displayName(e.actor)}</td>
                  <td style={{ fontWeight: 600 }}>{e.action}</td>
                  {showWhere && (
                    <td>
                      {clients![e.target] ? (
                        <Link href={`/clients/${e.target}`}>{clients![e.target]}</Link>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>{e.target}</span>
                      )}
                    </td>
                  )}
                  <td className="mono" style={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>
                    {e.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {remaining > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
          <button className="btn ghost small" onClick={() => setShown((s) => Math.min(entries.length, s + PAGE))}>
            See more
          </button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Showing {visible.length} of {entries.length}
          </span>
        </div>
      )}
    </>
  );
}
