// The audit log as a page. Reads lib/activity directly rather than going
// through /api/activity — same data, one fewer round trip, and it renders
// server-side so there is no loading state to design. Authed by the proxy
// like every console route.
import Link from "next/link";
import { recentActivity, markNotificationsSeen, getNotificationsSeenAt } from "@/lib/activity";
import { getIndex } from "@/lib/store";
import ActivityList from "@/components/ActivityList";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import AppTabBar from "@/components/AppTabBar";

export const metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  // Read the last-seen mark BEFORE clearing it, so the list can default to
  // what's unread since the previous visit.
  const [all, index, seenAt] = await Promise.all([
    recentActivity(100),
    getIndex(),
    getNotificationsSeenAt(),
  ]);
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
          <Link className="btn ghost small app-hide" href="/">
            ← Dashboard
          </Link>
        </div>
      </div>
      {/* Skip-link target. The topbar lives inside <main> on every console
          page, so the jump lands here, after the nav, and the next Tab
          continues into the content. tabIndex makes it focusable, which is
          what moves focus rather than only the scroll position. */}
      <div id="main-content" tabIndex={-1} />


      <div className="card">
        <h3>Recent activity</h3>
        <p className="app-hide" style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          What&apos;s new since your last visit: document actions, payments, portal acceptances,
          questions and uploads. Use <b>See more</b> for everything already seen; the log keeps the
          most recent 500.
        </p>
        <ActivityList entries={entries} now={now} clients={clients} seenAt={seenAt} />
      </div>
      <AppTabBar />
    </main>
  );
}
