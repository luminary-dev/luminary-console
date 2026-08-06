"use client";

// Idle sign-out for the console: 30 minutes without activity ends the
// session (server cookie slides only while pings flow). Self-disables where
// there is no session (login page, client subdomains) via the first ping.
import { useEffect, useRef } from "react";

const IDLE_MS = 30 * 60 * 1000;
const PING_MS = 5 * 60 * 1000;

export default function SessionGuard() {
  const last = useRef(Date.now());
  useEffect(() => {
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
