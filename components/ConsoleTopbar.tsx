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
    // A real <header>/banner landmark OUTSIDE <main>, so the section nav is no
    // longer inside the page's main region (AUDIT.md UI-02). Pages render this,
    // then their own <main id={MAIN_ID}> with a heading — the skip-link target
    // moved onto that <main>. Kept inside the page's .wrap so the bar stays in
    // the centred column exactly as before.
    <header className="topbar">
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
    </header>
  );
}
