// Every client, with the table that was on the dashboard.
//
// It moved here because the dashboard was doing two jobs: telling you what
// needs attention, and being the client list. Those want different shapes. The
// hub answers "what should I look at", this answers "where is that client".
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import ClientTable from "@/components/ClientTable";
import CommandPalette from "@/components/CommandPalette";
import ConsoleTopbar from "@/components/ConsoleTopbar";
import { loadClientOverview, loadUnreadActivity } from "@/lib/console-overview";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [{ rows }, { unread }] = await Promise.all([loadClientOverview(), loadUnreadActivity()]);

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <ConsoleTopbar current="/clients" unread={unread} />

      {rows.length === 0 ? (
        <div className="card">
          <h3>Clients</h3>
          <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 14 }}>
            No clients yet. Create the first one and the estimate, questionnaire and subdomain are
            generated automatically.
          </p>
          <Link className="btn" href="/clients/new" style={{ marginTop: 16 }}>
            + New client
          </Link>
        </div>
      ) : (
        <ClientTable rows={rows} />
      )}

      <CommandPalette
        items={rows.map((r) => ({ slug: r.slug, company: r.company, docNoBase: r.docNoBase }))}
      />
      <AppTabBar />
    </main>
  );
}
