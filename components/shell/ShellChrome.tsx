"use client";

// Everything around a page that is not the page: the side menu, and on a
// phone the bottom bar and the sheet its Menu button opens.
//
// One menu, drawn once. On a computer the <aside> is the column down the left.
// On a phone the same <aside> is hidden until Menu is pressed, and then it is
// a dialog: focus is held inside it, the page behind does not scroll and
// Escape closes it (useOverlayBehaviour, the same primitive the confirmation
// dialogs and Search use). There is no second copy of the links for the phone
// to drift out of step with.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import { openSearch } from "@/components/CommandPalette";
import QuickFind from "@/components/QuickFind";
import { useOverlayBehaviour } from "@/components/useOverlayBehaviour";
import { HELP } from "@/lib/menu";
import NavList from "./NavList";

const MENU_ID = "console-menu";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The three places a phone reaches with one tap. Everything else is behind
 *  Menu, which lists the lot. */
const SHORTCUTS = [
  {
    href: "/",
    label: "Today",
    on: (c: string) => c === "/",
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
      </svg>
    ),
  },
  {
    href: "/clients",
    label: "Clients",
    on: (c: string) => c.startsWith("/clients"),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
    ),
  },
  {
    href: "/sales",
    label: "Customers",
    on: (c: string) => c.startsWith("/sales"),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" />
      </svg>
    ),
  },
] as const;

export default function ShellChrome({
  current,
  unread = 0,
}: {
  current?: string;
  /** Unread updates, shown on History. */
  unread?: number;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { captureTrigger } = useOverlayBehaviour({ open, overlayRef: panelRef, onDismiss: close });

  // The sheet only exists on a phone. If the window is widened while it is
  // open, the menu is a plain column again and must stop behaving as a dialog.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 901px)");
    const onChange = () => { if (wide.matches) setOpen(false); };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  const search = () => {
    // Search is its own dialog. Opened from inside the menu sheet, the sheet
    // goes first so the two are never stacked.
    setOpen(false);
    openSearch();
  };

  const at = current ?? "";

  return (
    <>
      <header className="phone-top">
        <Link className="shell-brand" href="/">
          Luminary<span>.</span>
        </Link>
      </header>

      {open && (
        // Tap outside to close, as a real button rather than a handler on a
        // bare div. Escape is the keyboard equivalent, so it stays out of the
        // tab order.
        <button type="button" className="side-scrim" aria-hidden="true" tabIndex={-1} onClick={close} />
      )}

      <aside
        ref={panelRef}
        id={MENU_ID}
        className="side"
        {...(open ? { "data-open": "", role: "dialog", "aria-modal": true, "aria-label": "Menu" } : {})}
      >
        <div className="side-top">
          <Link className="shell-brand" href="/" onClick={close}>
            Luminary<span>.</span>
          </Link>
          <button type="button" className="side-close" onClick={close}>
            Close
          </button>
        </div>

        {/* Search is the first thing in the menu, drawn like a search box,
            because "where is it" is usually answered fastest by typing. */}
        <button type="button" className="side-search" aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K /" onClick={search}>
          <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span>Search</span>
          <kbd aria-hidden="true">⌘K</kbd>
        </button>

        <NavList
          {...(current !== undefined ? { current } : {})}
          historyCount={
            unread > 0 ? (
              <span className="side-count">
                {unread}
                <span className="sr-only"> new</span>
              </span>
            ) : null
          }
          onNavigate={close}
        />

        <div className="side-foot">
          <Link
            className="side-link"
            href={HELP.href}
            onClick={close}
            {...(current === HELP.href ? { "aria-current": "page" as const } : {})}
          >
            <span>{HELP.label}</span>
          </Link>
          <AccountMenu />
        </div>
      </aside>

      <nav className="phonebar" aria-label="Shortcuts">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.href}
            className="phonebar-item"
            href={s.href}
            {...(s.on(at) ? { "aria-current": "page" as const } : {})}
          >
            {s.icon}
            <span>{s.label}</span>
          </Link>
        ))}
        <button type="button" className="phonebar-item" aria-haspopup="dialog" onClick={search}>
          <svg viewBox="0 0 24 24" {...stroke}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span>Search</span>
        </button>
        <button
          type="button"
          className="phonebar-item"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={MENU_ID}
          onClick={() => {
            captureTrigger();
            setOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" {...stroke}>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>Menu</span>
        </button>
      </nav>

      {/* The one Search dialog for the page. The buttons above only ask it to
          open; ⌘K, Ctrl+K and "/" reach it directly. */}
      <QuickFind />
    </>
  );
}
