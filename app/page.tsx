import Link from "next/link";
import { getClient, getIndex } from "@/lib/store";
import { STAGES, STAGE_LABELS, currentStage } from "@/lib/stage";
import { clientMoney, fmtLKR, overdueSummary } from "@/lib/money";
import { recentActivity, isClientEvent, getNotificationsSeenAt } from "@/lib/activity";
import { displayName } from "@/lib/admins";
import { relTime } from "@/lib/time";
import type { ClientStage } from "@/lib/types";
import ClientTable, { type ClientRow } from "@/components/ClientTable";
import CommandPalette from "@/components/CommandPalette";
import SessionsCard from "@/components/SessionsCard";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  created: "Estimate sent",
  answers_in: "Answers in — drafting",
  drafts_ready: "Drafts ready",
};

export default async function Dashboard() {
  const index = (await getIndex()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Stage + money live on the full records, not the index — fetch them all
  // (a handful of clients; each is one small object read, cached 5s).
  const records = await Promise.all(index.map((e) => getClient(e.slug)));

  // Client-portal notifications: uploads, questions, acceptances, submissions.
  // Only for clients that still exist (so deleted/test clients never show), and
  // "unread" = anything since the feed was last opened on the Activity page.
  const companyOf = new Map(index.map((e) => [e.slug, e.company]));
  const [activity, seenAt] = await Promise.all([recentActivity(100), getNotificationsSeenAt()]);
  const clientEvents = activity.filter((e) => isClientEvent(e) && companyOf.has(e.target));
  const unread = clientEvents.filter((e) => e.at > seenAt).length;
  const now = Date.now();
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ClientStage, number>;
  let outstandingTotal = 0;
  let outstandingClients = 0;
  let overdueClients = 0;
  let overdueTotal = 0;
  const rows: ClientRow[] = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const openTasks: { slug: string; company: string; text: string; due?: string; assignee?: string }[] = [];
  index.forEach((e, i) => {
    const rec = records[i];
    if (!rec) return;
    const stage = currentStage(rec);
    counts[stage]++;
    for (const t of rec.tasks ?? []) {
      if (!t.done) openTasks.push({ slug: e.slug, company: e.company, text: t.text, due: t.due, assignee: t.assignee });
    }
    const money = clientMoney(rec);
    if (money.outstanding > 0) {
      outstandingTotal += money.outstanding;
      outstandingClients++;
    }
    const od = overdueSummary(rec);
    if (od.count > 0) {
      overdueClients++;
      overdueTotal += od.total;
    }
    rows.push({
      slug: e.slug,
      company: e.company,
      docNoBase: e.docNoBase,
      status: e.status,
      statusLabel: STATUS_LABEL[e.status] ?? e.status,
      stage,
      createdAt: e.createdAt,
      outstanding: money.outstanding,
      overdue: od.count > 0,
    });
  });
  // Earliest due first (overdue naturally leads); undated tasks last.
  openTasks.sort((a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99"));

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Console</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small" href="/activity">
            Activity{unread > 0 ? ` · ${unread}` : ""}
          </Link>
          {index.length > 0 && (
            <a className="btn ghost small" href="/api/clients/export">
              Export CSV
            </a>
          )}
          <Link className="btn" href="/clients/new">
            + New client
          </Link>
        </div>
      </div>

      {clientEvents.length > 0 && (
        <div className="card">
          <h3>
            From your clients
            {unread > 0 && (
              <span className="new-pill" style={{ marginLeft: 8 }}>
                {unread} new
              </span>
            )}
          </h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            Uploads, questions, acceptances and questionnaire submissions from the client portals.
            {unread > 0 ? (
              <>
                {" "}
                Open <Link href="/activity">Activity</Link> to mark them seen.
              </>
            ) : null}
          </p>
          <div style={{ marginTop: 8 }}>
            {clientEvents.slice(0, 8).map((e, i) => {
              const fresh = e.at > seenAt;
              const company = companyOf.get(e.target);
              return (
                <div
                  key={`${e.at}-${i}`}
                  style={{
                    display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap",
                    padding: "10px 0", borderTop: "1px solid var(--border)",
                  }}
                >
                  {fresh && <span className="new-pill">New</span>}
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{e.actor}</span>
                  <span style={{ fontSize: 13.5 }}>{e.action}</span>
                  {e.detail && (
                    <span className="mono" style={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>
                      {e.detail}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "baseline", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }} title={e.at}>
                      {relTime(e.at, now)}
                    </span>
                    {company ? (
                      <Link href={`/clients/${e.target}`}>Open →</Link>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>{e.target}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {openTasks.length > 0 && (
        <div className="card">
          <h3>Open tasks</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            Across all clients, earliest due first. {openTasks.length} open.
          </p>
          <div style={{ marginTop: 8 }}>
            {openTasks.slice(0, 12).map((t, i) => {
              const overdue = t.due && t.due < todayStr;
              return (
                <div
                  key={`${t.slug}-${i}`}
                  style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid var(--border)" }}
                >
                  <span style={{ fontSize: 13.5 }}>{t.text}</span>
                  {(t.due || t.assignee) && (
                    <span style={{ fontSize: 12, color: overdue ? "var(--danger, #d33)" : "var(--muted)", fontWeight: overdue ? 700 : 400 }}>
                      {t.due ? `due ${t.due}${overdue ? " · overdue" : ""}` : ""}
                      {t.due && t.assignee ? " · " : ""}
                      {t.assignee ? displayName(t.assignee) : ""}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "baseline" }}>
                    <Link href={`/clients/${t.slug}`}>{t.company} →</Link>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {index.length > 0 && (
        <div className="card">
          <h3>Pipeline</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {STAGES.map((s) => (
              <span key={s} className={`pill${counts[s] === 0 ? " grey" : ""}`}>
                <i />
                {STAGE_LABELS[s]} · {counts[s]}
              </span>
            ))}
          </div>
          <p style={{ marginTop: 12, fontSize: 13.5 }}>
            {outstandingClients > 0 ? (
              <>
                <b className="mono">{fmtLKR(outstandingTotal)}</b> outstanding across{" "}
                {outstandingClients} client{outstandingClients > 1 ? "s" : ""}.
                {overdueClients > 0 && (
                  <>
                    {" "}
                    <b className="mono" style={{ color: "var(--danger, #d33)" }}>{fmtLKR(overdueTotal)}</b>{" "}
                    <span style={{ color: "var(--danger, #d33)" }}>
                      overdue across {overdueClients} client{overdueClients > 1 ? "s" : ""}.
                    </span>
                  </>
                )}
              </>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                Nothing outstanding — every published invoice is settled.
              </span>
            )}
          </p>
        </div>
      )}

      {index.length === 0 ? (
        <div className="card">
          <h3>Clients</h3>
          <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 14 }}>
            No clients yet — create the first one and the estimate, questionnaire and subdomain are
            generated automatically.
          </p>
        </div>
      ) : (
        <ClientTable rows={rows} />
      )}

      <SessionsCard />
      <CommandPalette items={rows.map((r) => ({ slug: r.slug, company: r.company, docNoBase: r.docNoBase }))} />
    </main>
  );
}
