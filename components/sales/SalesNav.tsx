// The sales section's sub-navigation. Same shape as the GitHub console's
// (components/github/GithubNav.tsx): the current page is passed in, so the
// marking is a server-rendered fact.
import Link from "next/link";

export type SalesSection = { href: string; label: string };

export const SALES_SECTIONS: SalesSection[] = [
  { href: "/sales", label: "Send" },
  { href: "/sales/shops", label: "Shops" },
  { href: "/sales/scripts", label: "Scripts" },
  { href: "/sales/kit", label: "Social kit" },
];

export default function SalesNav({ current }: { current: string }) {
  return (
    <nav className="sales-nav" aria-label="Sales sections">
      <ul className="sales-nav-list">
        {SALES_SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              className="sales-nav-link"
              href={section.href}
              aria-current={section.href === current ? "page" : undefined}
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
