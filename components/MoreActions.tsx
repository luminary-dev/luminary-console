"use client";

// "More": the actions on a row that are not the one you came for.
//
// A document row used to show four or five buttons of the same weight, so the
// one that mattered (publish it, email it, mark it paid) had to be found among
// the ones that are used once a month (delete, unpublish, rewrite). Each row
// now shows its main action and this button; the rest appear under the row
// when it is pressed.
//
// The hidden buttons stay mounted. Several of them own a confirmation dialog
// or a half-typed instruction, and unmounting them on close would throw that
// away. It is a disclosure (aria-expanded and aria-controls), not a floating
// menu: the row sits inside a table that scrolls sideways, and a panel that
// floats over a scroller is clipped by it.
import { useId, useState, type ReactNode } from "react";

export default function MoreActions({
  label = "More",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="btn ghost small more-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <svg className="more-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="more-items" id={id} hidden={!open}>
        {children}
      </div>
    </>
  );
}
