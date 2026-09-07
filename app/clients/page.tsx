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
import EmptyState from "@/components/EmptyState";
import PageHead from "@/components/PageHead";
import { loadClientOverview, loadUnreadActivity } from "@/lib/console-overview";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [{ rows }, { unread }] = await Promise.all([loadClientOverview(), loadUnreadActivity()]);

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <ConsoleTopbar current="/clients" unread={unread} />

      <PageHead
        section="clients"
        title="Clients"
        lede={
          rows.length === 0
            ? "Every client, with documents, billing, designs and handover."
            : `${rows.length} client${rows.length === 1 ? "" : "s"}. Documents, billing, designs and handover for each.`
        }
      />

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No clients yet"
            action={
              <Link className="btn" href="/clients/new">
                + New client
              </Link>
            }
          >
            Create the first one and the estimate, questionnaire and subdomain are generated
            automatically.
          </EmptyState>
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
