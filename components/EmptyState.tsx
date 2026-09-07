// Nothing here yet, said with some character.
//
// The console's mascot (a lamp-headed repair bot, drawn once and reused so it
// is always the same robot) sits beside a speech balloon that carries the
// actual message, with the first action as a sticker beneath. The words carry
// the meaning: the picture has alt text but the block reads correctly with
// the image missing, which is the standard every decorative moment in this
// redesign is held to.
//
// `children` is what the robot says. Keep it to the point: what is empty and
// what fills it. `action` is the one thing to do about it.
import type { ReactNode } from "react";
import Illustration from "@/components/Illustration";
import type { IllustrationId } from "@/lib/illustrations/assets";

export default function EmptyState({
  title,
  children,
  action,
  art = "empty-state",
  hand = false,
}: {
  /** Omit when the surrounding card already carries the heading. */
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  art?: IllustrationId;
  /** Hand-lettered balloon text. Only for a short line; never for a sentence
   *  the reader has to parse. */
  hand?: boolean;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden={art === "empty-state" ? undefined : true}>
        <Illustration id={art} sizes="(max-width: 560px) 40vw, 180px" />
      </div>
      <div className="empty-state__body">
        {title ? <p className="empty-state__title">{title}</p> : null}
        <p className={`bubble bubble--left${hand ? " bubble--hand" : ""}`}>{children}</p>
        {action}
      </div>
    </div>
  );
}
