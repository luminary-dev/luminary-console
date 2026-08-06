import Link from "next/link";
import { getClient, getIndex } from "@/lib/store";
import { STAGES, STAGE_LABELS, currentStage } from "@/lib/stage";
import { clientMoney, fmtLKR } from "@/lib/money";
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
  // (a handful of clients; each is one small blob read).
  const records = await Promise.all(index.map((e) => getClient(e.slug)));
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
          <Link className="btn" href="/clients/new">
            + New client
          </Link>
        </div>
      </div>

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
