"use client";

// Mirrors the pre-paint theme (set by the inline script in layout.tsx from
// cookie/localStorage/system) and flips it, persisting to both stores so the
// server renders the right theme on the next load.
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("luminary-theme", next);
      document.cookie = `luminary-theme=${next};path=/;max-age=31536000;samesite=lax`;
    } catch {
      /* storage blocked — applies for this visit only */
    }
    setTheme(next);
  };

  return (
    <button type="button" className="btn-theme" onClick={toggle} aria-label="Switch theme">
      <i aria-hidden="true" />
      {theme === null ? "THEME" : theme === "dark" ? "LIGHT" : "DARK"}
    </button>
  );
}
