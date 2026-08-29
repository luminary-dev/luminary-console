// Account and data, moved off the dashboard.
//
// Signed-in devices and a CSV export are things you do occasionally and
// deliberately. On the dashboard they took a full card and a topbar slot each,
// competing every day with the work you actually came to do. Here they cost
// nothing until you go looking.
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SessionsCard from "@/components/SessionsCard";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { getIndex } from "@/lib/store";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const index = await getIndex();

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

      <SessionsCard />

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
