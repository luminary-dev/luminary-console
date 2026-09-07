"use client";

// The workshop lamp: the theme switch. A sliding-knob pill whose knob is the
// bulb, lit amber in daylight and dimmed to a moon at night, and whose flip
// wipes across the page in a circle from the control (View Transitions API;
// instant fallback). Position + icon are driven by CSS off [data-theme], so
// there's nothing to mismatch on hydration. The console additionally persists
// to a cookie so the server renders the right theme.
//
// The two icons keep their old names (SUN/MOON, __sun/__moon) so the CSS
// hooks and the interaction audit's probes did not have to change; SUN is
// now a lit bulb and MOON a crescent.
import { useEffect } from "react";
import { elementCenter, paletteReveal } from "@/lib/theme-reveal";

const MOON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

// A lit bulb: the glass, the filament, the two rings of the cap.
const SUN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" />
    <path d="M10.5 10.5 12 13l1.5-2.5" />
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
    <button className="theme-toggle" onClick={handleToggle} aria-label="Toggle light and dark theme (the workshop lamp)">
      <span className="theme-toggle__knob">
        <span className="theme-toggle__ico theme-toggle__sun">{SUN}</span>
        <span className="theme-toggle__ico theme-toggle__moon">{MOON}</span>
      </span>
    </button>
  );
}
