// Account and data, moved off the dashboard.
//
// Signed-in devices and a CSV export are things you do occasionally and
// deliberately. On the dashboard they took a full card and a topbar slot each,
// competing every day with the work you actually came to do. Here they cost
// nothing until you go looking.
import { cookies } from "next/headers";
import SessionsCard from "@/components/SessionsCard";
import ConsoleShell from "@/components/shell/ConsoleShell";
import { getIndex } from "@/lib/store";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { listSessions } from "@/lib/sessions";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const index = await getIndex();

  // Read the signed-in devices server-side and hand them to the card as its
  // initial state, so Settings paints the list immediately with no client
  // fetch/flash (AUDIT.md UI-19). "current" is derived from the caller's own
  // sid, the same way GET /api/sessions does.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(process.env.SESSION_SECRET || "", token);
  const sessions = (await listSessions()).map((s) => ({ ...s, current: s.sid === session?.sid }));

  return (
    <ConsoleShell current="/settings" narrow>

      <SessionsCard initial={sessions} />

      <section className="card" aria-labelledby="settings-data">
        <h3 id="settings-data">A spreadsheet of every client</h3>
        <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 14 }}>
          {index.length > 0
            ? `One file with all ${index.length} client${index.length === 1 ? "" : "s"}: document numbers, stage and what each still owes. It opens in Excel or Google Sheets.`
            : "There are no clients to put in it yet."}
        </p>
        {index.length > 0 && (
          <a className="btn ghost small" href="/api/clients/export" style={{ marginTop: 16 }}>
            Download the spreadsheet
          </a>
        )}
      </section>
    </ConsoleShell>
  );
}
