// A console page: the same header on every screen, then the content.
//
// A page says where it is (`current`, an address from lib/menu.ts) and this
// puts the trail, the title and the one-sentence purpose above the content,
// all read from the menu, so a screen is called the same thing in the menu, in
// Search, in Help and on its own page. A page that is not in the menu (one
// client, one pull request) passes its own title and trail.
//
// The menu itself is not drawn here. It is in the root layout
// (ConsoleFrame.tsx), so it stays put while pages change. Before this, pages
// built their own top bars: eleven shared one, the nine GitHub screens had
// another with no menu at all, and the installed app had a third.
//
// Nothing here is server-only, so the error screens, which have to be client
// components, use it too.
import Link from "next/link";
import type { ReactNode } from "react";
import HowItWorks from "@/components/HowItWorks";
import { MAIN_ID } from "@/components/SkipLink";
import { placeOf } from "@/lib/menu";

export type Crumb = { label: string; href?: string };

export default function ConsoleShell({
  current,
  title,
  purpose,
  how,
  trail,
  action,
  narrow = false,
  className,
  busy = false,
  children,
}: {
  /** The menu entry this page is, or belongs under. */
  current?: string;
  /** The page heading. Defaults to the menu entry's name. */
  title?: ReactNode;
  /** The sentence under the heading. Defaults to the menu entry's; pass null
   *  for none. */
  purpose?: ReactNode | null;
  /** The longer explanation, for whoever wants it: folded under the purpose
   *  as "How this works". */
  how?: ReactNode;
  /** What comes before the heading in the trail. Defaults to the group. */
  trail?: Crumb[];
  /** The one main thing to do on this page, shown beside the heading. */
  action?: ReactNode;
  /** A reading-width column, for forms. */
  narrow?: boolean;
  className?: string;
  /** The page is still loading: announced, and nothing else changes. */
  busy?: boolean;
  children: ReactNode;
}) {
  const place = current ? placeOf(current) : {};
  const heading = title ?? place.item?.label ?? "";
  const lede = purpose === undefined ? place.item?.what : purpose;
  const crumbs: Crumb[] = trail ?? (place.group ? [{ label: place.group.label }] : []);

  return (
    <main
      id={MAIN_ID}
      tabIndex={-1}
      className={["shell-main", narrow ? "shell-main--narrow" : "", className ?? ""].filter(Boolean).join(" ")}
      {...(busy ? { "aria-busy": true } : {})}
    >
      <header className="pagehead">
        {crumbs.length > 0 && (
          <nav className="trail" aria-label="You are here">
            <ol>
              {crumbs.map((c) => (
                <li key={`${c.href ?? ""}${c.label}`}>
                  {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="pagehead-row">
          <div className="pagehead-text">
            <h1>{heading}</h1>
            {lede ? <p className="purpose">{lede}</p> : null}
            {how ? <HowItWorks>{how}</HowItWorks> : null}
          </div>
          {action ? <div className="pagehead-action">{action}</div> : null}
        </div>
      </header>
      {children}
    </main>
  );
}
