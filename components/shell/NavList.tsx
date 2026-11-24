"use client";

// The menu itself: Today, then each group of screens, then History.
//
// It is drawn once and used twice: as the side menu on a computer, and as the
// sheet the Menu button opens on a phone. Which page is current is passed in
// from the server, so the marking is in the first paint rather than something
// that appears after the scripts load.
import Link from "next/link";
import type { ReactNode } from "react";
import { HISTORY, MENU, TODAY, type MenuItem } from "@/lib/menu";

function Item({
  item,
  current,
  onNavigate,
  children,
}: {
  item: MenuItem;
  current: string | undefined;
  onNavigate: (() => void) | undefined;
  children?: ReactNode;
}) {
  return (
    <li>
      <Link
        className="side-link"
        href={item.href}
        {...(item.href === current ? { "aria-current": "page" as const } : {})}
        {...(onNavigate ? { onClick: onNavigate } : {})}
      >
        <span>{item.label}</span>
        {children}
      </Link>
    </li>
  );
}

export default function NavList({
  current,
  historyCount,
  onNavigate,
}: {
  /** The address of the screen in view, exactly as lib/menu.ts lists it. */
  current?: string;
  /** Unread updates, drawn on History. */
  historyCount?: ReactNode;
  /** Called when a link is followed, so a phone's menu sheet can close. */
  onNavigate?: () => void;
}) {
  return (
    <nav className="side-nav" aria-label="Menu">
      <ul className="side-list">
        <Item item={TODAY} current={current} onNavigate={onNavigate} />
      </ul>

      {MENU.map((group) => {
        const headingId = `menu-${group.id}`;
        const list = (
          <ul className="side-list" aria-labelledby={headingId}>
            {group.items.map((item) => (
              <Item key={item.href} item={item} current={current} onNavigate={onNavigate} />
            ))}
          </ul>
        );
        // A folded group is a native <details>: it opens and closes with no
        // script, and it is already open when you are on one of its screens.
        return group.folded ? (
          <details className="side-group" key={group.id} open={group.items.some((i) => i.href === current)}>
            <summary className="side-heading" id={headingId}>
              {group.label}
              <span className="side-fold" aria-hidden="true" />
            </summary>
            {list}
          </details>
        ) : (
          <section className="side-group" key={group.id} aria-labelledby={headingId}>
            <h2 className="side-heading" id={headingId}>
              {group.label}
            </h2>
            {list}
          </section>
        );
      })}

      <ul className="side-list side-list--apart">
        <Item item={HISTORY} current={current} onNavigate={onNavigate}>
          {historyCount}
        </Item>
      </ul>
    </nav>
  );
}
