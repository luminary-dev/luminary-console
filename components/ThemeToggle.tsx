"use client";

// The landing page's theme switch, ported: a sliding-knob pill with sun/moon
// icons whose flip wipes across the page in a circle from the control
// (View Transitions API; instant fallback). Position + icon are driven by CSS
// off [data-theme], so there's nothing to mismatch on hydration. The console
// additionally persists to a cookie so the server renders the right theme.
import { useEffect } from "react";
import { elementCenter, paletteReveal } from "@/lib/theme-reveal";

const MOON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SUN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

export default function ThemeToggle() {
  // Follow the OS theme live while the visitor hasn't made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem("luminary-theme")) return;
      } catch {
        // Blocked storage (private mode): fall through and follow the OS.
      }
      document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    paletteReveal(elementCenter(e.currentTarget), () => {
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("luminary-theme", next);
        document.cookie = `luminary-theme=${next};path=/;max-age=31536000;samesite=lax`;
      } catch {
        // Blocked storage: the choice just will not survive the visit.
      }
    });
  };

  return (
    <button className="theme-toggle" onClick={handleToggle} aria-label="Toggle light and dark theme">
      <span className="theme-toggle__knob">
        <span className="theme-toggle__ico theme-toggle__sun">{SUN}</span>
        <span className="theme-toggle__ico theme-toggle__moon">{MOON}</span>
      </span>
    </button>
  );
}
