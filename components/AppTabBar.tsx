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
    // Client drill-downs light Clients now, not Home: the list they came from
    // lives there. Home is the hub and nothing drills down from it.
    isActive: (p) => p === "/",
  },
  {
    href: "/github",
    label: "Eng",
    icon: (
      // A branch with a merge, which reads as "pull requests" at 22px far
      // better than a repository or an octocat silhouette would.
      <svg viewBox="0 0 24 24" {...stroke}>
        <circle cx="6" cy="5" r="2.5" />
        <circle cx="6" cy="19" r="2.5" />
        <circle cx="18" cy="9" r="2.5" />
        <path d="M6 7.5v9" />
        <path d="M18 11.5c0 3.5-3 4.5-6 5" />
      </svg>
    ),
    // The whole engineering section keeps this tab lit, including the sub
    // views and a pull request drill-down.
    isActive: (p) => p === "/github" || p.startsWith("/github/"),
  },
  {
    href: "/clients",
    label: "Clients",
    icon: (
      // A folder, which reads as "the client records" at 22px far better than
      // a person silhouette, since a client here is a project not a contact.
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
    ),
    isActive: (p) => p === "/clients" || (p.startsWith("/clients/") && p !== "/clients/new"),
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
