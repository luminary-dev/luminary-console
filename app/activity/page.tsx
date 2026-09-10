// The audit log as a page. Reads lib/activity directly rather than going
// through /api/activity — same data, one fewer round trip, and it renders
// server-side so there is no loading state to design. Authed by the proxy
// like every console route.
import { after } from "next/server";
import { recentActivity, markNotificationsSeen, getNotificationsSeenAt } from "@/lib/activity";
import { getIndex } from "@/lib/store";
import ActivityList from "@/components/ActivityList";
import ConsoleTopbar from "@/components/ConsoleTopbar";
import { MAIN_ID } from "@/components/SkipLink";
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
  // notification badge for the team. Run AFTER the response, not during render:
  // a write in the render body re-fires on any RSC prefetch/replay, safe today
  // only because the page is force-dynamic (AUDIT.md UI-06). (The badge is
  // still team-global, not per-operator — tracked separately in AUDIT.md.)
  after(() => markNotificationsSeen());
  // Slugs that still exist get a link; deleted clients stay plain text rather
  // than 404-ing the operator.
  const clients = Object.fromEntries(index.map((e) => [e.slug, e.company]));
  const now = Date.now();

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <ConsoleTopbar current="/activity" subtitle="Activity" />
      <main id={MAIN_ID}>
      <h1 className="sr-only">Activity</h1>


      <div className="card">
        <h3>Recent activity</h3>
        <p className="app-hide" style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          What&apos;s new since your last visit: document actions, payments, portal acceptances,
          questions and uploads. Use <b>See more</b> for everything already seen; the log keeps the
          most recent 500.
        </p>
        <ActivityList entries={entries} now={now} clients={clients} seenAt={seenAt} />
      </div>
      </main>
      <AppTabBar />
    </div>
  );
}
