// The hub: the first screen after signing in.
//
// It answers one question, "what should I look at", and nothing else. The four
// sections are always here so the console has a stable shape; the two things
// below them appear only when there is something to say. A card that always
// reads "nothing outstanding" trains you to stop looking at it, which is the
// opposite of what a landing screen is for.
//
// The client table used to live here as well. It moved to /clients: telling
// you what needs attention and listing every client are different jobs and
// they want different shapes.
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import CommandPalette from "@/components/CommandPalette";
import ConsoleTopbar, { SECTIONS } from "@/components/ConsoleTopbar";
import MarkAllRead from "@/components/MarkAllRead";
import RelativeTime from "@/components/RelativeTime";
import { fmtLKR } from "@/lib/money";
import { relTime } from "@/lib/time";
import { loadClientOverview, loadUnreadActivity } from "@/lib/console-overview";

export const metadata = { title: "Console" };
export const dynamic = "force-dynamic";

/** One line of context per section, so the tiles say what they are for. */
const SECTION_NOTE: Record<string, string> = {
  "/clients": "Documents, billing, designs and handover for every client.",
  "/github": "Pull requests, CI, deployments, releases and security.",
  "/activity": "Everything that has happened, across clients and repositories.",
  "/publish": "Draft and publish articles and portfolio projects.",
};

export default async function Hub() {
  const [overview, activity] = await Promise.all([loadClientOverview(), loadUnreadActivity()]);
  const { outstandingTotal, outstandingClients, overdueTotal, overdueClients, total } = overview;
  const { events, unread } = activity;
  // Only clients that still exist get an "Open" link; see the feed below.
  const companyOf = new Map(overview.rows.map((r) => [r.slug, r.company]));
  const now = Date.now();

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <ConsoleTopbar unread={unread} />

      <nav className="hub" aria-label="Console sections">
        {SECTIONS.map((s) => (
          <Link className="hub-tile" key={s.href} href={s.href}>
            <span className="hub-tile__name">
              {s.label}
              {s.href === "/clients" && total > 0 && <span className="hub-tile__n">{total}</span>}
              {s.href === "/activity" && unread > 0 && (
                <span className="hub-tile__n is-accent">{unread}</span>
              )}
            </span>
            <span className="hub-tile__note">{SECTION_NOTE[s.href]}</span>
          </Link>
        ))}
      </nav>

      {/* Only when there is money to chase. */}
      {outstandingClients > 0 && (
        <section className="card" aria-labelledby="hub-money">
          <h3 id="hub-money">Outstanding</h3>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>
            <b className="mono">{fmtLKR(outstandingTotal)}</b> across {outstandingClients} client
            {outstandingClients > 1 ? "s" : ""}.
            {overdueClients > 0 && (
              <>
                {" "}
                <b className="mono" style={{ color: "var(--danger)" }}>
                  {fmtLKR(overdueTotal)}
                </b>{" "}
                <span style={{ color: "var(--danger)" }}>
                  overdue across {overdueClients} client{overdueClients > 1 ? "s" : ""}.
                </span>
              </>
            )}
          </p>
          <Link className="btn ghost small" href="/clients" style={{ marginTop: 14 }}>
            Open clients
          </Link>
        </section>
      )}

      {/* Only when something is genuinely unread. */}
      {events.length > 0 && (
        <section className="card" aria-labelledby="hub-updates">
          <div className="card-head">
            <h3 id="hub-updates">
              Recent updates <span className="pill">{unread} new</span>
            </h3>
            <MarkAllRead />
          </div>
          <ul className="hub-feed">
            {events.map((e, i) => {
              const company = companyOf.get(e.target);
              return (
                <li className="hub-feed__row" key={`${e.at}-${i}`}>
                  <span className="hub-feed__what">
                    <b>{e.actor}</b> {e.action}{" "}
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
            All activity
          </Link>
        </section>
      )}

      <CommandPalette
        items={overview.rows.map((r) => ({
          slug: r.slug,
          company: r.company,
          docNoBase: r.docNoBase,
        }))}
      />
      <AppTabBar />
    </main>
  );
}
