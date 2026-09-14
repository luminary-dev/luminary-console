"use client";

// The console's utility controls, folded into one disclosure.
//
// The topbar used to carry five separate action controls on the right —
// theme, per-device alerts, Settings, Sign out and the primary "+ New client".
// Below a full-width desktop that cluster wrapped onto a second row, and even
// when it fitted it was a wall of same-weight ghost buttons competing with the
// section nav. The three you touch rarely (alerts, Settings, Sign out) live
// here now, behind one "Account" button; theme and the primary action stay on
// the bar. Nothing was removed, only grouped.
//
// This is a disclosure, not an ARIA menu: it is a short list of ordinary links
// and buttons, so it carries aria-expanded/aria-controls and Escape-to-close
// rather than the arrow-key menuitem contract, which would be a promise the
// contents do not keep. Escape returns focus to the trigger; a click outside
// or on an item closes it.
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import SignOut from "@/components/SignOut";
import PushToggle from "@/components/PushToggle";
import ThemeToggle from "@/components/ThemeToggle";

export default function AccountMenu({ showSettings = true }: { showSettings?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    // Capture phase so a child that stops propagation cannot keep the menu
    // open, matching the console's other overlays.
    const onPointerDown = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && wrapRef.current && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="acct" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn ghost small acct-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        Account
        <svg className="acct-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="acct-panel" id={panelId}>
          <div className="acct-row">
            <span className="acct-row__label">Theme</span>
            <ThemeToggle />
          </div>
          {/* Per-device notification toggle. Renders nothing where push is not
              available, in which case the panel is theme + Settings + Sign out. */}
          <PushToggle />
          {showSettings && (
            <Link className="acct-item" href="/settings" onClick={() => setOpen(false)}>
              Settings
            </Link>
          )}
          <SignOut />
        </div>
      )}
    </div>
  );
}
