import Link from "next/link";
import { getClient, getIndex } from "@/lib/store";
import { STAGES, STAGE_LABELS, currentStage } from "@/lib/stage";
import { clientMoney, fmtLKR } from "@/lib/money";
import { recentActivity, isClientEvent, getNotificationsSeenAt } from "@/lib/activity";
import { relTime } from "@/lib/time";
import type { ClientStage } from "@/lib/types";
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
  const stageOf = new Map<string, ClientStage>();
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ClientStage, number>;
  let outstandingTotal = 0;
  let outstandingClients = 0;
  index.forEach((e, i) => {
    const rec = records[i];
    if (!rec) return;
    const stage = currentStage(rec);
    stageOf.set(e.slug, stage);
    counts[stage]++;
    const money = clientMoney(rec);
    if (money.outstanding > 0) {
      outstandingTotal += money.outstanding;
      outstandingClients++;
    }
  });

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
              </>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                Nothing outstanding — every published invoice is settled.
              </span>
            )}
          </p>
        </div>
      )}

      <div className="card">
        <h3>Clients</h3>
        {index.length === 0 ? (
          <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 14 }}>
            No clients yet — create the first one and the estimate, questionnaire and subdomain are
            generated automatically.
          </p>
        ) : (
          <div className="table-scroll"><table className="list">
            <thead>
              <tr>
                <th>Client</th>
                <th>Doc no.</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {index.map((c) => {
                const stage = stageOf.get(c.slug);
                return (
                  <tr key={c.slug}>
                    <td style={{ fontWeight: 600 }}>{c.company}</td>
                    <td className="mono">{c.docNoBase}</td>
                    <td>
                      <span className={`pill${c.status === "created" ? " grey" : ""}`}>
                        <i />
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td>
                      {stage ? (
                        <span className={`pill${stage === "lead" || stage === "closed" ? " grey" : ""}`}>
                          <i />
                          {STAGE_LABELS[stage]}
                        </span>
                      ) : (
                        <span style={{ color: "var(--subtle)" }}>—</span>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)" }}>{c.createdAt.slice(0, 10)}</td>
                    <td>
                      <Link href={`/clients/${c.slug}`}>Open →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <SessionsCard />
    </main>
  );
}
