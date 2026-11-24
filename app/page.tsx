// Today: the first screen after signing in.
//
// It answers one question, "what needs me now", and offers the three things
// most visits start with. It used to repeat the menu as five tiles, which told
// you where things were (the menu already does) and nothing about what to do.
//
// What is waiting is worked out in lib/today.ts from records the console
// already holds: this file only gathers them. Each source is read on its own
// and allowed to fail on its own, so a GitHub outage or an unreachable kit
// site costs one line of the list and never the page.
//
// The client table used to live here as well. It moved to /clients: telling
// you what needs attention and listing every client are different jobs and
// they want different shapes.
import Link from "next/link";
import ConsoleShell from "@/components/shell/ConsoleShell";
import FirstVisit from "@/components/FirstVisit";
import MarkAllRead from "@/components/MarkAllRead";
import RelativeTime from "@/components/RelativeTime";
import { ADMIN_NAMES, displayName } from "@/lib/admins";
import { loadClientOverview, loadUnreadActivity } from "@/lib/console-overview";
import { githubLoginFor } from "@/lib/github/config";
import { listAllPullRequests } from "@/lib/github/projection";
import { viewCounts } from "@/lib/github/views";
import { fetchKit, getPosted } from "@/lib/kit";
import { MENU } from "@/lib/menu";
import { fmtLKR } from "@/lib/money";
import { currentOperator } from "@/lib/operator";
import { buildQueue } from "@/lib/sales";
import { getSalesState } from "@/lib/sales-store";
import { relTime } from "@/lib/time";
import { buildToday } from "@/lib/today";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/** The three things most visits start with. Read from the menu, so they are
 *  called here what they are called there. */
const STARTS = ["/clients/new", "/sales", "/publish"].flatMap((href) =>
  MENU.flatMap((g) => g.items).filter((i) => i.href === href),
);

/** A source that fails or hangs gives up its line, not the page. */
async function soft<T>(work: Promise<T>, ms = 4000): Promise<T | null> {
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}

async function shopsFor(operator: string, now: number) {
  const state = await getSalesState();
  if (state.leads.length === 0) return null;
  const queue = buildQueue(state.leads, state.progress, now, operator);
  return { due: queue.due, fresh: Math.min(queue.fresh, queue.room) };
}

/** The first post, in posting order, that nobody has ticked for Instagram. */
async function nextPost() {
  const [kit, posted] = await Promise.all([fetchKit(), getPosted()]);
  if (!kit.ok) return null;
  const post = kit.kit.posts.find((p) => !posted[p.id]?.instagram);
  return post ? { id: post.id, title: post.title, day: post.day } : null;
}

async function codeFor(operator: string, now: number) {
  const login = githubLoginFor(operator);
  const counts = viewCounts(await listAllPullRequests(), { ...(login ? { viewerLogin: login } : {}), now });
  return { reviews: counts["needs-my-review"] ?? 0, ready: counts["ready-to-merge"] ?? 0 };
}

export default async function Today() {
  const now = Date.now();
  const operator = await currentOperator();
  const [overview, activity, shops, post, code] = await Promise.all([
    loadClientOverview(),
    loadUnreadActivity(),
    soft(shopsFor(operator, now)),
    // The kit is read from another site, so it gets less patience.
    soft(nextPost(), 1500),
    soft(codeFor(operator, now)),
  ]);
  const { outstandingTotal, outstandingClients } = overview;
  const { events, unread } = activity;
  // Only clients that still exist get an "Open" link; see the feed below.
  const companyOf = new Map(overview.rows.map((r) => [r.slug, r.company]));
  const name = ADMIN_NAMES[operator.toLowerCase()];

  const items = buildToday({
    now,
    operator,
    clients: overview.records,
    shops,
    nextPost: post,
    reviews: code?.reviews ?? 0,
    ready: code?.ready ?? 0,
  });

  return (
    <ConsoleShell current="/" title={name ? `Today, ${name}` : "Today"}>
      <FirstVisit />

      <section className="card" aria-labelledby="today-needs">
        <div className="card-head">
          <h3 id="today-needs">
            Waiting on you{" "}
            {items.length > 0 && <span className="side-count">{items.length}</span>}
          </h3>
        </div>
        {items.length === 0 ? (
          <p className="empty-note">
            Nothing is waiting. No money is overdue, no document is sitting unsent and nobody has
            asked for anything. Start something below, or have a look through the menu.
          </p>
        ) : (
          <ul className="today-list">
            {items.map((item) => (
              <li className={`today-row${item.urgent ? " is-urgent" : ""}`} key={item.id}>
                <div className="today-what">
                  <span className="k">
                    {item.area}
                    {item.urgent ? " · late" : ""}
                  </span>
                  <b>{item.title}</b>
                  <span className="today-detail">{item.detail}</span>
                </div>
                <Link className="btn ghost small" href={item.href}>
                  {item.action}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {outstandingClients > 0 && (
          <p className="today-foot">
            Clients owe us <b className="mono">{fmtLKR(outstandingTotal)}</b> in all, across{" "}
            {outstandingClients} client{outstandingClients > 1 ? "s" : ""}.{" "}
            <Link href="/clients">See who</Link>
          </p>
        )}
      </section>

      <nav className="hub" aria-label="Start something">
        {STARTS.map((s) => (
          <Link className="hub-tile" key={s.href} href={s.href}>
            <span className="hub-tile__name">{s.label}</span>
            <span className="hub-tile__note">{s.what}</span>
          </Link>
        ))}
      </nav>

      {/* Only when something is genuinely unread. */}
      {events.length > 0 && (
        <section className="card" aria-labelledby="hub-updates">
          <div className="card-head">
            <h3 id="hub-updates">
              What happened <span className="pill">{unread} new</span>
            </h3>
            <MarkAllRead />
          </div>
          <ul className="hub-feed">
            {events.map((e, i) => {
              const company = companyOf.get(e.target);
              return (
                <li className="hub-feed__row" key={`${e.at}-${i}`}>
                  <span className="hub-feed__what">
                    <b>{displayName(e.actor)}</b> {e.action}{" "}
                    {e.detail ? <span className="mono">{e.detail}</span> : null}
                  </span>
                  <RelativeTime at={e.at} initial={relTime(e.at, now)} className="rel-time" />
                  {company ? (
                    /* A bare <a>, not a Link: this routes through
                       /api/activity/open, which marks this one update read and
                       then redirects. A Link would prefetch on hover and mark
                       it read without anyone opening it. */
                    <a
                      className="hub-feed__open"
                      href={`/api/activity/open?at=${encodeURIComponent(e.at)}&target=${encodeURIComponent(e.target)}&action=${encodeURIComponent(e.action)}`}
                    >
                      Open
                    </a>
                  ) : (
                    /* The client is gone. The event still shows, as plain
                       text, so nothing an admin did quietly disappears. */
                    <span className="hub-feed__open is-gone">{e.target}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <Link className="btn ghost small" href="/activity" style={{ marginTop: 14 }}>
            All history
          </Link>
        </section>
      )}
    </ConsoleShell>
  );
}
