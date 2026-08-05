import Link from "next/link";
import { getIndex } from "@/lib/store";
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

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Console</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <Link className="btn" href="/clients/new">
            + New client
          </Link>
        </div>
      </div>

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
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {index.map((c) => (
                <tr key={c.slug}>
                  <td style={{ fontWeight: 600 }}>{c.company}</td>
                  <td className="mono">{c.docNoBase}</td>
                  <td>
                    <span className={`pill${c.status === "created" ? " grey" : ""}`}>
                      <i />
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{c.createdAt.slice(0, 10)}</td>
                  <td>
                    <Link href={`/clients/${c.slug}`}>Open →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </main>
  );
}
