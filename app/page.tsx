import Link from "next/link";
import { getClients, getIndex } from "@/lib/store";
import { STAGES, STAGE_LABELS, currentStage } from "@/lib/stage";
import { clientMoney, fmtLKR, overdueSummary } from "@/lib/money";
import { recentActivity, isNotifiable, getNotificationsSeenAt, getReadKeys, entryKey } from "@/lib/activity";
import MarkAllRead from "@/components/MarkAllRead";
import RelativeTime from "@/components/RelativeTime";
import { displayName } from "@/lib/admins";
import { relTime } from "@/lib/time";
import type { ClientStage } from "@/lib/types";
import ClientTable, { type ClientRow } from "@/components/ClientTable";
import CommandPalette from "@/components/CommandPalette";
import SessionsCard from "@/components/SessionsCard";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import PushToggle from "@/components/PushToggle";
import AppTabBar from "@/components/AppTabBar";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  created: "Estimate sent",
  answers_in: "Answers in: drafting",
  drafts_ready: "Drafts ready",
};

export default async function Dashboard() {
  const index = (await getIndex()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // The index carries only slug, company, status, createdAt and the doc
  // number. Stage, money, overdue and open tasks all live inside the full
  // record, so the pipeline counts and the outstanding total genuinely need
  // every record read, and the rows the table shows need exactly the same
  // ones: there is no smaller correct set to fetch here. What is not
  // acceptable is opening one R2 connection per client at once, which is what
  // Promise.all over the index did, so the fan-out is bounded instead
  // (LC-030). The table virtualizes above 100 rows, so a large index costs
  // reads, not render time.
  const records = await getClients(index.map((e) => e.slug));

  // Client-portal notifications: uploads, questions, acceptances, submissions.
  // Only for clients that still exist (so deleted/test clients never show), and
  // "unread" = anything since the feed was last opened on the Activity page.
  const companyOf = new Map(index.map((e) => [e.slug, e.company]));
  const [activity, seenAt, readKeys] = await Promise.all([
    recentActivity(100),
    getNotificationsSeenAt(),
    getReadKeys(),
  ]);
  // The Recent-updates card is an inbox: every action against a client —
  // admin and portal alike — except sign-in noise (the "console" target),
  // minus anything already seen (globally marked read, or individually
  // dismissed by opening it). The full history stays on /activity.
  // Deleted-client events still show (as plain text, no link), so nothing an
  // admin did quietly disappears.
  const feedEvents = activity.filter(
    (e) => isNotifiable(e) && e.at > seenAt && !readKeys.has(entryKey(e)),
  );
  const unread = feedEvents.length;
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
      if (!t.done) {
        openTasks.push({
          slug: e.slug,
          company: e.company,
          text: t.text,
          ...(t.due !== undefined ? { due: t.due } : {}),
          ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
        });
      }
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
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <ThemeToggle />
          <PushToggle />
          <SignOut />
          {/* .app-hide: in the installed app the tab bar owns navigation and
              CSV export is a desktop affair — hidden there, unchanged on web. */}
          <Link className="btn ghost small app-hide" href="/github">
            Engineering
          </Link>
          <Link className="btn ghost small app-hide" href="/activity">
            Activity{unread > 0 ? ` · ${unread}` : ""}
          </Link>
          <Link className="btn ghost small app-hide" href="/publish">
            Publish
          </Link>
          {index.length > 0 && (
            <a className="btn ghost small app-hide" href="/api/clients/export">
              Export CSV
            </a>
          )}
          <Link className="btn app-hide" href="/clients/new">
            + New client
          </Link>
        </div>
      </div>
      {/* Skip-link target. The topbar lives inside <main> on every console
          page, so the jump lands here, after the nav, and the next Tab
          continues into the content. tabIndex makes it focusable, which is
          what moves focus rather than only the scroll position. */}
      <div id="main-content" tabIndex={-1} />


      {feedEvents.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>
              Recent updates
              <span className="new-pill" style={{ marginLeft: 8 }}>
                {unread} new
              </span>
            </h3>
            <span style={{ marginLeft: "auto" }}>
              <MarkAllRead />
            </span>
          </div>
          <p className="app-hide" style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            Unseen actions across your clients: document publishes, invoices, payments, stage
            changes and emails, plus uploads, questions and acceptances from the portals.
            Opening an update clears it; the full history lives in{" "}
            <Link href="/activity">Activity</Link>.
          </p>
          <div style={{ marginTop: 8 }}>
            {feedEvents.slice(0, 8).map((e, i) => {
              const company = companyOf.get(e.target);
              return (
                <div
                  key={`${e.at}-${i}`}
                  style={{
                    display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap",
                    padding: "10px 0", borderTop: "1px solid var(--border)",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{e.actor}</span>
                  <span style={{ fontSize: 13.5 }}>{e.action}</span>
                  {e.detail && (
                    <span className="mono" style={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>
                      {e.detail}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "baseline", whiteSpace: "nowrap" }}>
                    <RelativeTime
                      at={e.at}
                      initial={relTime(e.at, now)}
                      className="rel-time"
                    />
                    {company ? (
                      /* bare <a>: routes through /api/activity/open, which marks
                         this one update read and redirects to the client page —
                         a Link would prefetch and mark it read on hover. */
                      <a
                        href={`/api/activity/open?at=${encodeURIComponent(e.at)}&target=${encodeURIComponent(e.target)}&action=${encodeURIComponent(e.action)}`}
                      >
                        Open →
                      </a>
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
                Nothing outstanding: every published invoice is settled.
              </span>
            )}
          </p>
        </div>
      )}

      {index.length === 0 ? (
        <div className="card">
          <h3>Clients</h3>
          <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 14 }}>
            No clients yet. Create the first one and the estimate, questionnaire and subdomain are
            generated automatically.
          </p>
        </div>
      ) : (
        <ClientTable rows={rows} />
      )}

      <SessionsCard />
      <CommandPalette items={rows.map((r) => ({ slug: r.slug, company: r.company, docNoBase: r.docNoBase }))} />
      <AppTabBar />
    </main>
  );
}
