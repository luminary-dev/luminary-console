// Every client, with the table that was on the dashboard.
//
// It moved here because the dashboard was doing two jobs: telling you what
// needs attention, and being the client list. Those want different shapes. The
// hub answers "what should I look at", this answers "where is that client".
import Link from "next/link";
import ClientTable from "@/components/ClientTable";
import ConsoleShell from "@/components/shell/ConsoleShell";
import { loadClientOverview } from "@/lib/console-overview";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const { rows } = await loadClientOverview();

  return (
    <ConsoleShell
      current="/clients"
      action={
        <Link className="btn" href="/clients/new">
          Add a client
        </Link>
      }
    >

      {rows.length === 0 ? (
        <div className="card">
          <h3>No clients yet</h3>
          <p className="empty-note">
            Add the first one. Its estimate, its questions form and its own web address are made for
            you, ready to send.
          </p>
        </div>
      ) : (
        <ClientTable rows={rows} />
      )}
    </ConsoleShell>
  );
}
