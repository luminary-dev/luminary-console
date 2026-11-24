"use client";

// Puts the console's menu around every console screen, once, from the root
// layout.
//
// It lives in the layout rather than in each page so that it is the same
// element before and after a navigation: the menu does not repaint, the Code
// group stays open if you opened it, and a page's loading or error screen
// appears beside the menu instead of replacing it.
//
// The root layout also wraps things that are not the console: the sign-in
// page, a client's own pages and the document previews. So this draws the
// frame only on an address the menu knows (isConsolePath, an allowlist) and
// never on a client's subdomain, where `enabled` is false. Everywhere else it
// returns the page untouched.
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { currentFor, isConsolePath } from "@/lib/menu";
import ShellChrome from "./ShellChrome";
import "./shell.css";

/** Asked for again whenever the page changes or someone marks updates read. */
export const UNREAD_CHANGED_EVENT = "console:unread-changed";

export default function ConsoleFrame({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const pathname = usePathname() || "/";
  const on = enabled && isConsolePath(pathname);
  const [unread, setUnread] = useState(0);

  // The count on History. Read after the page is up, so no screen waits on
  // it, and again on each navigation: opening History is what clears it. A
  // failed read leaves the last number rather than an error on every page.
  useEffect(() => {
    if (!on) return;
    let stale = false;
    const load = () => {
      fetch("/api/activity/unread", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { unread?: unknown } | null) => {
          if (!stale && d && typeof d.unread === "number") setUnread(d.unread);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(UNREAD_CHANGED_EVENT, load);
    return () => {
      stale = true;
      window.removeEventListener(UNREAD_CHANGED_EVENT, load);
    };
  }, [on, pathname]);

  if (!on) return <>{children}</>;

  const current = currentFor(pathname);
  return (
    <div className="shell">
      <ShellChrome {...(current !== undefined ? { current } : {})} unread={unread} />
      {children}
    </div>
  );
}
