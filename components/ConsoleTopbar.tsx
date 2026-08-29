// The console's menu, in one place.
//
// Every page used to hand-roll its own topbar, so the bar changed shape as you
// moved around: the dashboard had seven controls, the others had two and a
// "back" link. A menu that rearranges itself between pages is not a menu, it
// is decoration, so this is the only one now.
//
// Three groups, deliberately: where you GO, what you CONTROL, and the one
// thing you DO. See the .topnav rules in app/globals.css.
import Link from "next/link";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import PushToggle from "@/components/PushToggle";
import { MAIN_ID } from "@/components/SkipLink";

/** The four sections of the console. Order is the order on the bar. */
export const SECTIONS = [
  { href: "/clients", label: "Clients" },
  { href: "/github", label: "Engineering" },
  { href: "/activity", label: "Activity" },
  { href: "/publish", label: "Publish" },
] as const;

export type Section = (typeof SECTIONS)[number]["href"];

export default function ConsoleTopbar({
  current,
  unread = 0,
  subtitle = "Console",
  showNewClient = true,
}: {
  /** The section this page belongs to, marked with aria-current. */
  current?: Section;
  /** Unread activity, shown as a count on the Activity link. */
  unread?: number;
  /** The small word after the wordmark. */
  subtitle?: string;
  /** The hub and /clients offer it; a form page in progress should not. */
  showNewClient?: boolean;
}) {
  return (
    <>
      <div className="topbar">
        <div className="brand">
          <Link href="/">
            Luminary<span>.</span>
          </Link>
          <small>{subtitle}</small>
        </div>

        {/* .app-hide: the installed app's tab bar owns navigation, so this
            group is hidden there and unchanged on the web. */}
        <nav className="topnav app-hide" aria-label="Sections">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              className="topnav-link"
              href={s.href}
              {...(current === s.href ? { "aria-current": "page" as const } : {})}
            >
              {s.label}
              {s.href === "/activity" && unread > 0 && (
                <span className="topnav-count">{unread}</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="topbar-actions">
          <ThemeToggle />
          <PushToggle />
          <Link className="btn ghost small app-hide" href="/settings">
            Settings
          </Link>
          <SignOut />
          {showNewClient && (
            <Link className="btn app-hide" href="/clients/new">
              + New client
            </Link>
          )}
        </div>
      </div>

      {/* Skip-link target. The topbar lives inside <main> on every console
          page, so the jump lands here, after the nav, and the next Tab
          continues into the content. tabIndex makes it focusable, which is
          what moves focus rather than only the scroll position. */}
      <div id={MAIN_ID} tabIndex={-1} />
    </>
  );
}
