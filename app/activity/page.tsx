// The audit log as a page. Reads lib/activity directly rather than going
// through /api/activity — same data, one fewer round trip, and it renders
// server-side so there is no loading state to design. Authed by the proxy
// like every console route.
import Link from "next/link";
import { recentActivity, markNotificationsSeen } from "@/lib/activity";
import { getIndex } from "@/lib/store";
import ActivityList from "@/components/ActivityList";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const [all, index] = await Promise.all([recentActivity(100), getIndex()]);
  // Sign-in / session ("console") events are noise here — they're covered by
  // the Sessions card on the dashboard. Show client and document activity only.
  const entries = all.filter((e) => e.target !== "console");
  // Opening the log is the acknowledgement — clear the dashboard's client
  // notification badge for the team. Best-effort; never blocks the render.
  await markNotificationsSeen();
  // Slugs that still exist get a link; deleted clients stay plain text rather
  // than 404-ing the operator.
  const clients = Object.fromEntries(index.map((e) => [e.slug, e.company]));
  const now = Date.now();

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Activity</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small" href="/">
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="card">
        <h3>Recent activity</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          The last 24 hours by default — document actions, payments, portal acceptances, questions
          and uploads. Use <b>See more</b> for older entries; the log keeps the most recent 500.
        </p>
        <ActivityList entries={entries} now={now} clients={clients} />
      </div>
    </main>
  );
}
