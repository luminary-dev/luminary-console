"use client";

// Idle sign-out for the console: 30 minutes without activity ends the
// session (server cookie slides only while pings flow). Self-disables where
// there is no session (login page, client subdomains) via the first ping.
import { useEffect, useRef } from "react";

const IDLE_MS = 30 * 60 * 1000;
const PING_MS = 5 * 60 * 1000;

/** Pages that have no session to guard. Pinging from here is guaranteed to
 *  401, which self-disables correctly but costs two console errors on the
 *  most-visited unauthenticated page in the product, on every single load
 *  (UX-21). Skipping the ping outright is both quieter and one fewer request. */
const NO_SESSION_PATHS = new Set(["/login"]);

export default function SessionGuard() {
  const last = useRef(Date.now());
  useEffect(() => {
    // The client subdomains are handled by the ping's own 401 (there is no
    // session concept there at all), but the console's own login page is
    // known statically, so do not even ask.
    if (NO_SESSION_PATHS.has(window.location.pathname)) return;

    let enabled = true;
    const mark = () => { last.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;
    const ping = async () => {
      const r = await fetch("/api/ping", { cache: "no-store" }).catch(() => null);
      if (!r || !r.ok) enabled = false;
      return enabled;
    };
    ping();
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const tick = setInterval(async () => {
      if (!enabled) return;
      if (Date.now() - last.current >= IDLE_MS) {
        await fetch("/api/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login?timedout=1";
      }
    }, 30_000);
    const slide = setInterval(() => {
      if (enabled && Date.now() - last.current < PING_MS) ping();
    }, PING_MS);
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(tick); clearInterval(slide);
    };
  }, []);
  return null;
}
