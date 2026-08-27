"use client";

// The behaviour every modal overlay in the console owes a keyboard user, in
// one place: a real focus trap, a background scroll lock that does not shift
// the page, Escape to dismiss, and focus handed back to whatever opened it.
//
// Written once because all three overlays (the command palette and both
// confirmation dialogs) failed the same three checks in the interaction audit:
//
//   IX-004  focus was not trapped. The dialogs only intervened at the boundary
//           of a focusable list captured from a selector that still counted
//           tabindex="-1" nodes, and the palette had no trap at all. Tab is now
//           always cancelled and the next stop chosen here, so the browser's
//           own tab order (which differs between engines, see below) never
//           gets a say.
//   IX-005  nothing locked the background. The page behind an open overlay
//           scrolled, and a naive lock would have shifted the layout by the
//           width of the classic scrollbar.
//   IX-006  focus did not come back to the trigger. WebKit does not focus a
//           <button> when it is clicked, so reading document.activeElement at
//           open time recorded <body> and the restore was a no-op that left
//           focus on <body>. The last pointer target is tracked separately for
//           exactly that case.
//
// The stops are recomputed on every Tab rather than captured when the overlay
// opens: the palette rewrites its result list on each keystroke, and a
// confirmation's primary button is disabled until its input has a value, so a
// set captured once is stale immediately.

import { useCallback, useEffect, useRef } from "react";
import { MAIN_ID } from "./SkipLink";

/** Everything the platform can put in the tab order. Narrowed by isFocusable. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

const LIVE_REGION_ID = "overlay-focus-announcer";

/**
 * jsdom parses and computes styles but never lays anything out, so every
 * element reports zero boxes there. Size is only a meaningful disqualifier
 * where a layout engine actually ran.
 */
function hasLayout(): boolean {
  return document.body.getClientRects().length > 0;
}

/** A tab stop: reachable by Tab, rendered, and not switched off. */
function isFocusable(el: HTMLElement, layout: boolean): boolean {
  if (el.tabIndex < 0) return false;
  if (el.matches(":disabled")) return false;
  if (el.hidden || el.closest("[hidden]") !== null) return false;
  if (el.closest('[aria-hidden="true"]') !== null) return false;
  if (el.closest("[inert]") !== null) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (layout && el.getClientRects().length === 0) return false;
  return true;
}

/** The overlay's tab stops, in document order, as they are right now. */
export function focusStops(root: HTMLElement): HTMLElement[] {
  const layout = hasLayout();
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) =>
    isFocusable(el, layout),
  );
}

// ——— trigger tracking ———

/**
 * The last element a pointer went down on. WebKit (and Safari generally) does
 * not move focus to a button when it is clicked, so document.activeElement is
 * still <body> inside the click handler that opens an overlay. This is the
 * only reliable record of what the user pressed.
 */
let lastPointerTrigger: HTMLElement | null = null;
let trackerUsers = 0;

function rememberPointerTarget(e: Event): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const el = target.closest<HTMLElement>(FOCUSABLE_SELECTOR);
  lastPointerTrigger = el !== null && el.tabIndex >= 0 ? el : null;
}

/** Capture phase, so a handler that stops propagation cannot hide the press. */
function trackTriggers(): () => void {
  if (trackerUsers === 0) {
    document.addEventListener("pointerdown", rememberPointerTarget, true);
    document.addEventListener("mousedown", rememberPointerTarget, true);
  }
  trackerUsers += 1;
  return () => {
    trackerUsers -= 1;
    if (trackerUsers === 0) {
      document.removeEventListener("pointerdown", rememberPointerTarget, true);
      document.removeEventListener("mousedown", rememberPointerTarget, true);
    }
  };
}

// ——— scroll lock ———

type SavedScroll = {
  x: number;
  y: number;
  layout: boolean;
  htmlOverflow: string;
  htmlGutter: string;
  htmlBorderRight: string;
  bodyOverflow: string;
};

let lockUsers = 0;
let savedScroll: SavedScroll | null = null;

/**
 * Lock the background without moving it sideways.
 *
 * overflow:hidden on the root removes the classic scrollbar, which widens
 * documentElement.clientWidth by its width and shifts the whole page. The
 * gutter is held open instead: scrollbar-gutter where it is supported (the
 * clean fix, and the one that belongs in app/globals.css on html), and a
 * transparent right border on the root as the fallback, which takes the same
 * width out of clientWidth. Overlay scrollbars measure zero and need neither.
 */
function lockScroll(): void {
  lockUsers += 1;
  if (lockUsers > 1) return;
  const root = document.documentElement;
  const layout = hasLayout();
  savedScroll = {
    x: window.scrollX,
    y: window.scrollY,
    layout,
    htmlOverflow: root.style.getPropertyValue("overflow"),
    htmlGutter: root.style.getPropertyValue("scrollbar-gutter"),
    htmlBorderRight: root.style.getPropertyValue("border-right"),
    bodyOverflow: document.body.style.getPropertyValue("overflow"),
  };
  const scrollbar = layout ? window.innerWidth - root.clientWidth : 0;
  if (scrollbar > 0) {
    const gutterSupported =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("scrollbar-gutter", "stable");
    if (gutterSupported) root.style.setProperty("scrollbar-gutter", "stable");
    else root.style.setProperty("border-right", `${scrollbar}px solid transparent`);
  }
  // Both: the root is what actually stops the viewport scrolling, and the body
  // is where a lock is conventionally read from.
  root.style.setProperty("overflow", "hidden");
  document.body.style.setProperty("overflow", "hidden");
}

function unlockScroll(): void {
  lockUsers -= 1;
  if (lockUsers > 0) return;
  lockUsers = 0;
  const saved = savedScroll;
  savedScroll = null;
  if (!saved) return;
  const root = document.documentElement;
  const restore = (el: HTMLElement, prop: string, value: string): void => {
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop);
  };
  restore(root, "overflow", saved.htmlOverflow);
  restore(root, "scrollbar-gutter", saved.htmlGutter);
  restore(root, "border-right", saved.htmlBorderRight);
  restore(document.body, "overflow", saved.bodyOverflow);
  if (saved.layout && (window.scrollX !== saved.x || window.scrollY !== saved.y)) {
    window.scrollTo(saved.x, saved.y);
  }
}

// ——— focus return ———

function announce(message: string): void {
  let region = document.getElementById(LIVE_REGION_ID);
  if (!region) {
    region = document.createElement("div");
    region.id = LIVE_REGION_ID;
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  // Cleared first so the same message twice running is still two announcements.
  region.textContent = "";
  const node = region;
  window.setTimeout(() => {
    node.textContent = message;
  }, 0);
}

/** Somewhere sensible when the trigger has gone: the skip-link target. */
function fallbackTarget(): HTMLElement | null {
  const byId = document.getElementById(MAIN_ID);
  if (byId) return byId;
  const main = document.querySelector<HTMLElement>('main, [role="main"]');
  if (main) return main;
  const layout = hasLayout();
  return (
    Array.from(document.body.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find((el) =>
      isFocusable(el, layout),
    ) ?? null
  );
}

function restoreFocus(trigger: HTMLElement | null): void {
  if (trigger && trigger.isConnected && isFocusable(trigger, hasLayout())) {
    trigger.focus({ preventScroll: true });
    return;
  }
  const fallback = fallbackTarget();
  if (!fallback) return;
  if (!fallback.hasAttribute("tabindex")) fallback.setAttribute("tabindex", "-1");
  fallback.focus({ preventScroll: true });
  announce("The dialog closed and focus moved to the main content.");
}

// ——— the hook ———

/** Only the topmost overlay reacts to a key, so nesting cannot double-handle. */
const overlayStack: object[] = [];

export type OverlayBehaviourOptions = {
  /** Whether the overlay is currently rendered. */
  open: boolean;
  /** The dialog node itself. Focus is kept inside this element. */
  overlayRef: { current: HTMLElement | null };
  /** Called on Escape. */
  onDismiss: () => void;
};

export type OverlayBehaviour = {
  /**
   * Record what opened the overlay. Call this synchronously in the handler
   * that opens it, before React renders: by the time an effect runs, an
   * autoFocus inside the overlay has already taken focus and the trigger is
   * unrecoverable.
   */
  captureTrigger: () => void;
};

export function useOverlayBehaviour({
  open,
  overlayRef,
  onDismiss,
}: OverlayBehaviourOptions): OverlayBehaviour {
  const trigger = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const dismiss = useRef(onDismiss);
  const identity = useRef<object>({});

  useEffect(() => {
    dismiss.current = onDismiss;
  });

  const captureTrigger = useCallback(() => {
    const active = document.activeElement;
    trigger.current =
      active instanceof HTMLElement && active !== document.body && active.tabIndex >= 0
        ? active
        : lastPointerTrigger;
  }, []);

  // Always on, open or not: the press that opens an overlay happens before it
  // exists.
  useEffect(() => trackTriggers(), []);

  useEffect(() => {
    if (!open) return;
    const id = identity.current;
    overlayStack.push(id);
    lockScroll();

    const isTopmost = () => overlayStack[overlayStack.length - 1] === id;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = overlayRef.current;
      if (!root) return;
      // Recomputed here, every time: the contents move under the trap.
      const stops = focusStops(root);
      e.preventDefault();
      if (stops.length === 0) return;
      const active = document.activeElement;
      const from = active instanceof HTMLElement ? stops.indexOf(active) : -1;
      const to =
        from === -1
          ? e.shiftKey
            ? stops.length - 1
            : 0
          : (from + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
      const next = stops[to];
      if (next) next.focus({ preventScroll: true });
    };

    // Anything that moves focus out while the overlay is open (a background
    // click, an engine that tabs somewhere of its own accord) is pulled back.
    const onFocusIn = (e: FocusEvent) => {
      if (!isTopmost()) return;
      const root = overlayRef.current;
      if (!root) return;
      const target = e.target;
      if (target instanceof Node && root.contains(target)) return;
      const stops = focusStops(root);
      const first = stops[0];
      if (first) first.focus({ preventScroll: true });
      else root.focus({ preventScroll: true });
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);

    // If nothing inside claimed focus (no autoFocus), put it on the first stop.
    const root = overlayRef.current;
    if (root && !root.contains(document.activeElement)) {
      const first = focusStops(root)[0];
      if (first) first.focus({ preventScroll: true });
    }

    return () => {
      const at = overlayStack.lastIndexOf(id);
      if (at >= 0) overlayStack.splice(at, 1);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      unlockScroll();
    };
  }, [open, overlayRef]);

  // Runs after the overlay has left the DOM, so React cannot pull focus to the
  // body behind us. Never fires on first mount, where nothing was opened.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = trigger.current;
    trigger.current = null;
    restoreFocus(el);
  }, [open]);

  return { captureTrigger };
}
