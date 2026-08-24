"use client";

// Bottom tab navigation for the installed console app. Rendered on every
// console page but styled entirely by the `@media (display-mode: standalone)`
// block in globals.css — in a normal browser (desktop or mobile Safari) it is
// `display: none`, so the web view is untouched. In the installed app it
// replaces the topbar's duplicate nav buttons (those carry .app-hide).
import Link from "next/link";
import { usePathname } from "next/navigation";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const TABS: {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: (p: string) => boolean;
}[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
      </svg>
    ),
    // Client detail pages are drill-downs from the dashboard — keep Home lit.
    isActive: (p) => p === "/" || (p.startsWith("/clients/") && p !== "/clients/new"),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    isActive: (p) => p === "/activity",
  },
  {
    href: "/publish",
    label: "Publish",
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M22 2 11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
    isActive: (p) => p === "/publish",
  },
  {
    href: "/clients/new",
    label: "New",
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
    isActive: (p) => p === "/clients/new",
  },
];

export default function AppTabBar() {
  const pathname = usePathname() || "/";
  return (
    <nav className="app-tabs" aria-label="Primary">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`app-tab${t.isActive(pathname) ? " on" : ""}`}
          aria-current={t.isActive(pathname) ? "page" : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
