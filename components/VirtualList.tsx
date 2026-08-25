"use client";

// Windowed <tbody> for tables that can grow past a screenful (LC-030).
//
// The constraint that shapes this: a virtualized table is still a table. So
// this renders REAL <tr> elements into a real <tbody>, and the rows that are
// not in the window are represented by two aria-hidden spacer rows whose
// height stands in for them. The caller puts aria-rowcount on the <table>;
// every rendered row gets its aria-rowindex here, so assistive tech is told
// "row 214 of 1000" rather than "row 3 of 20".
//
// Below `threshold` rows nothing is windowed at all: the whole list renders,
// no spacers, no scroll math, and the component is a plain <tbody>. That is
// the common case in this console and it should behave exactly as it did.
//
// Keyboard navigation is the part virtualization usually breaks: Tab cannot
// reach a row that is not in the DOM. Up/Down/Home/End are handled here
// instead, and moving to a row that is outside the window scrolls it in and
// then focuses it, so every row is reachable without a mouse.

import {
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";

/** The mandate's line: virtualize any list that can exceed 100 rows. */
export const VIRTUALIZE_THRESHOLD = 100;

/** Rows kept rendered either side of the viewport, so a fast scroll shows
 *  content rather than blank space while React catches up. */
const DEFAULT_OVERSCAN = 6;

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type VirtualListProps<T> = {
  items: readonly T[];
  /** Must return a <tr>. aria-rowindex and the row marker are injected here. */
  renderRow: (item: T, index: number) => ReactElement;
  /** The scrollable ancestor the window is measured against. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Estimated row height in px. Measured from the DOM once rows exist, so a
   *  wrong estimate self-corrects; it only has to be close. */
  rowHeight: number;
  /** Visible height of the scroller in px. */
  viewportHeight: number;
  /** colSpan for the spacer rows: it must match the header. */
  columns: number;
  threshold?: number;
  overscan?: number;
};

export default function VirtualList<T>({
  items,
  renderRow,
  scrollRef,
  rowHeight,
  viewportHeight,
  columns,
  threshold = VIRTUALIZE_THRESHOLD,
  overscan = DEFAULT_OVERSCAN,
}: VirtualListProps<T>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measured, setMeasured] = useState(0);
  /** Row to focus once the window that contains it has rendered. */
  const pendingFocus = useRef<number | null>(null);

  const virtualize = items.length > threshold;
  const rowH = measured || rowHeight;

  // Follow the scroller. Only while virtualizing: below the threshold there is
  // no window to move and no reason to subscribe.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtualize) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, virtualize]);

  // A new list (a filter, a different sort) makes the old offset meaningless.
  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [items, scrollRef]);

  // Trust the DOM over the estimate: real row height depends on the type scale
  // and the breakpoint, and spacer heights have to match it or the scrollbar
  // lies about how much list there is.
  useLayoutEffect(() => {
    if (!virtualize) return;
    const first = bodyRef.current?.querySelector<HTMLElement>("[data-vrow]");
    const h = first?.offsetHeight ?? 0;
    if (h > 0) setMeasured(h);
  }, [virtualize, items, rowHeight]);

  const perScreen = Math.max(1, Math.ceil(viewportHeight / rowH));
  const first = virtualize ? Math.max(0, Math.floor(scrollTop / rowH) - overscan) : 0;
  const last = virtualize
    ? Math.min(items.length, first + perScreen + overscan * 2)
    : items.length;

  /** Focus the pending row if it is rendered; otherwise leave it pending for
   *  the render that brings it into the window. */
  const flushFocus = useCallback(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const row = bodyRef.current?.querySelector<HTMLElement>(`[data-vrow="${target}"]`);
    if (!row) return;
    pendingFocus.current = null;
    (row.querySelector<HTMLElement>(FOCUSABLE) ?? row).focus();
  }, []);

  /** Bring `index` into the window and focus it. */
  const focusRow = useCallback(
    (index: number) => {
      const target = Math.min(Math.max(index, 0), items.length - 1);
      if (target < 0) return;
      if (virtualize) {
        // Nearest scroll offset that puts the whole row on screen.
        const lowest = Math.max(0, (target + 1) * rowH - viewportHeight);
        const highest = target * rowH;
        const next = Math.min(Math.max(scrollTop, lowest), highest);
        if (next !== scrollTop) {
          setScrollTop(next);
          if (scrollRef.current) scrollRef.current.scrollTop = next;
        }
      }
      pendingFocus.current = target;
      // Already on screen: focus now. Otherwise the scroll above changed state
      // and the layout effect below finishes the job once the row exists.
      flushFocus();
    },
    [flushFocus, items.length, rowH, scrollRef, scrollTop, viewportHeight, virtualize],
  );

  useLayoutEffect(flushFocus);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      const row = (e.target as HTMLElement | null)?.closest?.("[data-vrow]");
      if (!row) return;
      const from = Number(row.getAttribute("data-vrow"));
      if (!Number.isFinite(from)) return;
      e.preventDefault();
      focusRow(
        e.key === "ArrowDown" ? from + 1
          : e.key === "ArrowUp" ? from - 1
          : e.key === "Home" ? 0
          : items.length - 1,
      );
    },
    [focusRow, items.length],
  );

  // Delegated on the tbody rather than bound as a JSX prop: a <tbody> is not
  // an interactive element, and the events that reach here come from the
  // focusable controls inside its rows.
  const latestKeyDown = useRef(onKeyDown);
  useLayoutEffect(() => {
    latestKeyDown.current = onKeyDown;
  }, [onKeyDown]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const listener = (e: KeyboardEvent) => latestKeyDown.current(e);
    el.addEventListener("keydown", listener);
    return () => el.removeEventListener("keydown", listener);
  }, []);

  const padTop = first * rowH;
  const padBottom = (items.length - last) * rowH;
  const spacer = (side: string, height: number) => (
    // aria-hidden: these stand in for rows, they are not rows. The real count
    // reaches assistive tech through aria-rowcount/aria-rowindex instead.
    <tr aria-hidden="true" key={`vpad-${side}`}>
      <td colSpan={columns} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );

  return (
    <tbody ref={bodyRef}>
      {padTop > 0 ? spacer("top", padTop) : null}
      {items.slice(first, last).map((item, n) => {
        const index = first + n;
        return cloneElement(renderRow(item, index) as ReactElement<Record<string, unknown>>, {
          "data-vrow": index,
          // +2: aria-rowindex is 1-based and the header row is row 1.
          "aria-rowindex": index + 2,
        });
      })}
      {padBottom > 0 ? spacer("bottom", padBottom) : null}
    </tbody>
  );
}
