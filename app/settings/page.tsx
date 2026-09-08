// Account and data, moved off the dashboard.
//
// Signed-in devices and a CSV export are things you do occasionally and
// deliberately. On the dashboard they took a full card and a topbar slot each,
// competing every day with the work you actually came to do. Here they cost
// nothing until you go looking.
import Link from "next/link";
import { cookies } from "next/headers";
import AppTabBar from "@/components/AppTabBar";
import SessionsCard from "@/components/SessionsCard";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
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
    <main className="wrap wrap--narrow" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Settings</small>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            Back to the dashboard
          </Link>
        </div>
      </div>
      <div id={MAIN_ID} tabIndex={-1} />

      <SessionsCard initial={sessions} />

      <section className="card" aria-labelledby="settings-data">
        <h3 id="settings-data">Data</h3>
        <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 13.5 }}>
          {index.length > 0
            ? `Every client record as a single CSV: ${index.length} client${index.length === 1 ? "" : "s"}, with document numbers, stage and outstanding balance.`
            : "There are no clients to export yet."}
        </p>
        {index.length > 0 && (
          <a className="btn ghost small" href="/api/clients/export" style={{ marginTop: 14 }}>
            Export clients as CSV
          </a>
        )}
      </section>

      <AppTabBar />
    </main>
  );
}
