// The audit log as a page. Reads lib/activity directly rather than going
// through /api/activity — same data, one fewer round trip, and it renders
// server-side so there is no loading state to design. Authed by the proxy
// like every console route.
import { after } from "next/server";
import { recentActivity, markNotificationsSeen, getNotificationsSeenAt } from "@/lib/activity";
import { getIndex } from "@/lib/store";
import ActivityList from "@/components/ActivityList";
import ConsoleShell from "@/components/shell/ConsoleShell";
import HistorySwitch from "@/components/shell/HistorySwitch";

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
    <ConsoleShell current="/activity">
      <HistorySwitch current="clients" />


      <div className="card">
        <h3>Clients and customers</h3>
        <p className="empty-note" style={{ marginTop: 4 }}>
          What is new since you last looked: documents sent, payments, quotations accepted,
          questions, files and shops messaged. Press <b>See more</b> for what you have already
          seen. The last 500 are kept.
        </p>
        <ActivityList entries={entries} now={now} clients={clients} seenAt={seenAt} />
      </div>
    </ConsoleShell>
  );
}
