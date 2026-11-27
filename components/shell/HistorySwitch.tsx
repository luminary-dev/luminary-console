// History is one place with two halves: what happened with clients and
// customers, and what happened in the code. They are kept in different stores
// and read differently, so they stay two lists, but they are one entry in the
// menu and this switch is how you move between them.
//
// Before this there were three things called "Activity": one in the top bar,
// one inside Engineering, and one on each client.
import Link from "next/link";

const HALVES = [
  { id: "clients", label: "Clients and customers", href: "/activity" },
  { id: "code", label: "Code", href: "/github/activity" },
] as const;

export default function HistorySwitch({ current }: { current: (typeof HALVES)[number]["id"] }) {
  return (
    <nav className="subnav" aria-label="Which history">
      <ul className="subnav-list">
        {HALVES.map((h) => (
          <li key={h.id}>
            <Link className="subnav-link" href={h.href} aria-current={h.id === current ? "page" : undefined}>
              {h.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
