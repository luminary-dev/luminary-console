// The eyebrow-and-title block every console page opens with.
//
// Three lines, always in this order: a mono kicker naming the section and its
// issue number ("CLIENTS — No.01"), a display title, and an optional lede.
// The number is fixed per section (SECTION_NO) so a regular reader learns
// them the way they learn a magazine's departments; a page inside a section
// keeps the section's number and adds its own word after it.
//
// With `illo` the block becomes the illustrated header: a letterboxed strip
// of generated artwork above the text, framed as a panel. The text is live
// HTML beneath the picture, never on top of it and never baked in, so the
// title stays selectable, translatable and sharp, and the header is complete
// with the file missing.
import type { ReactNode } from "react";
import Illustration from "@/components/Illustration";
import type { IllustrationId } from "@/lib/illustrations/assets";

/** The console's departments, numbered. */
export const SECTION_NO = {
  console: "No.00",
  clients: "No.01",
  engineering: "No.02",
  activity: "No.03",
  publish: "No.04",
  settings: "No.05",
} as const;

export type SectionKey = keyof typeof SECTION_NO;

const SECTION_LABEL: Record<SectionKey, string> = {
  console: "Console",
  clients: "Clients",
  engineering: "Engineering",
  activity: "Activity",
  publish: "Publish",
  settings: "Settings",
};

export function Eyebrow({ section, sub }: { section: SectionKey; sub?: string }) {
  return (
    <p className="eyebrow">
      {SECTION_LABEL[section]}
      <span className="no">{SECTION_NO[section]}</span>
      {sub ? <span aria-hidden="true">·</span> : null}
      {sub ? <span>{sub}</span> : null}
    </p>
  );
}

export default function PageHead({
  section,
  sub,
  title,
  lede,
  actions,
  illo,
  stamp,
  titleId,
}: {
  section: SectionKey;
  /** The page's own word, after the section and number. */
  sub?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** Controls that belong to the page as a whole, right-aligned. */
  actions?: ReactNode;
  /** Renders the illustrated variant. */
  illo?: IllustrationId;
  /** The corner stamp on the illustrated variant: a date, a count, a status. */
  stamp?: ReactNode;
  titleId?: string;
}) {
  const text = (
    <div className="page-head__text">
      <Eyebrow section={section} {...(sub !== undefined ? { sub } : {})} />
      <h1 className="page-title" {...(titleId ? { id: titleId } : {})}>
        {title}
      </h1>
      {lede ? <p className="page-lede">{lede}</p> : null}
    </div>
  );

  if (!illo) {
    return (
      <header className="page-head">
        {text}
        {actions ? <div className="page-head__actions">{actions}</div> : null}
      </header>
    );
  }

  return (
    <header className="page-head page-head--illo">
      <div className="page-head__art">
        <Illustration id={illo} />
        {stamp ? (
          <span className="page-stamp">
            <i aria-hidden="true" />
            {stamp}
          </span>
        ) : null}
      </div>
      <div className="page-head__inner">
        {text}
        {actions ? <div className="page-head__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
