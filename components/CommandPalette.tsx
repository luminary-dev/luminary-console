"use client";

// ⌘K / Ctrl-K / "/" quick-jump: to any client by name or doc number, and, where the
// caller supplies them, to any screen of the console. The content search hits
// /api/search.
//
// It is mounted once per page by the console's frame (components/QuickFind.tsx
// inside components/shell/), so it is on every screen, with a Search button in
// the menu, instead of on two pages behind a shortcut nobody could discover. The client list is either passed in (`items`) or
// fetched the first time the palette opens (`loadItems`), so pages that do not
// already hold the list do not pay for it up front.
//
// Accessibility (LC-043): the overlay is a dialog, the input is a combobox
// owning a single listbox, and arrow keys move aria-activedescendant across
// BOTH result groups rather than only the name matches.
//
// The trap, the background scroll lock, Escape and the focus return come from
// useOverlayBehaviour, the same primitive the confirmation dialogs use
// (IX-004, IX-005, IX-006). This overlay had none of them: Tab walked straight
// out into the page behind the veil on the first press, and it kept doing so
// because the only tab stop it owns (the input) is surrounded by a result list
// that is rebuilt on every keystroke.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useOverlayBehaviour } from "./useOverlayBehaviour";

export type PaletteItem = { slug: string; company: string; docNoBase: string };

/** A screen (or an action that is a screen) the palette can jump to. */
export type PaletteDestination = {
  href: string;
  label: string;
  /** Where it lives, shown small on the right, e.g. "Engineering". */
  group?: string;
  /** Extra words that should find it, e.g. "invoice money" for Billing. */
  keywords?: string;
  /** Listed before anything is typed. */
  top?: boolean;
};

type ContentHit = { slug: string; company: string; where: string; snippet: string };

/** Content results carry the query they were issued for, so a response that
 *  resolves after the query moved on can never be rendered (LC-022). The
 *  AbortController cancels the request; this is the belt to that braces. */
type ContentState = { q: string; hits: ContentHit[] };

type Option =
  | { kind: "page"; href: string; label: string; group: string }
  | { kind: "name"; slug: string; company: string; docNoBase: string }
  | { kind: "content"; slug: string; company: string; where: string; snippet: string };

const HEADING: Record<Option["kind"], string> = {
  page: "Go to",
  name: "Clients",
  content: "In documents and notes",
};

/** How anything on the page asks the Search dialog to open. The dialog is
 *  mounted once per page (components/QuickFind.tsx) and the buttons that open
 *  it live elsewhere (the side menu, the phone's bottom bar), so they ask with
 *  an event instead of each holding a copy of the dialog. */
export const OPEN_SEARCH_EVENT = "console:open-search";
export function openSearch(): void {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

/** True when a keystroke is going into a field, so "/" must be left alone. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function CommandPalette({
  items: given,
  destinations = [],
  loadItems,
  trigger = false,
}: {
  items: PaletteItem[];
  /** Screens to jump to. Without any, the palette is the client-only one it
   *  always was. */
  destinations?: PaletteDestination[];
  /** Fetches the client list the first time the palette opens, for pages that
   *  do not already have it. */
  loadItems?: () => Promise<PaletteItem[]>;
  /** Render a visible "Search" button that opens the palette. */
  trigger?: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [content, setContent] = useState<ContentState | null>(null);
  const [loaded, setLoaded] = useState<PaletteItem[] | null>(null);
  const items = loaded ?? given;
  const loadRef = useRef<Promise<void> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);

  const dismiss = useCallback(() => setOpen(false), []);

  const { captureTrigger } = useOverlayBehaviour({
    open,
    overlayRef: dialogRef,
    onDismiss: dismiss,
  });

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Escape is not handled here any more: useOverlayBehaviour owns it, and only
  // for the topmost overlay, so a confirmation opened above the palette is not
  // dismissed together with it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Before the overlay renders, while whatever the user was on still
        // has focus.
        if (!openRef.current) captureTrigger();
        setOpen((v) => !v);
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !openRef.current && !isTyping(e.target)) {
        // "/" opens it too, as it does on GitHub, but never while the key is
        // being typed into a field: a note that contains a slash is a note.
        e.preventDefault();
        captureTrigger();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureTrigger]);

  // A Search button somewhere on the page asked (see openSearch above). The
  // button still has focus at this point, so it is what focus returns to.
  useEffect(() => {
    const onAsk = () => {
      if (!openRef.current) captureTrigger();
      setOpen(true);
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onAsk);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onAsk);
  }, [captureTrigger]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setContent(null);
      // focus after the overlay paints
      requestAnimationFrame(() => inputRef.current?.focus());
      // One fetch per page view, shared by repeated opens. A failure leaves the
      // palette with its screens and the content search, which still work.
      if (loadItems && !loadRef.current) {
        loadRef.current = loadItems()
          .then((list) => setLoaded(list))
          .catch(() => {
            loadRef.current = null;
          });
      }
    }
  }, [open, loadItems]);

  const pages = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return destinations.filter((d) => d.top);
    return destinations
      .filter((d) => `${d.label} ${d.group ?? ""} ${d.keywords ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [destinations, q]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? items.filter((i) => i.company.toLowerCase().includes(needle) || i.docNoBase.toLowerCase().includes(needle))
      : items;
    return list.slice(0, 8);
  }, [items, q]);

  // Debounced content search (documents, notes, comments). The effect depends
  // on `q` alone: keying it to `results` too restarted the debounce on every
  // identity change of the memo.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setContent(null); return; }
    const ctl = new AbortController();
    // The abort is the real cancellation; `cancelled` is what guarantees a
    // late response never touches state even if the transport ignores it.
    let cancelled = false;
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d: { results?: ContentHit[] }) => { if (!cancelled) setContent({ q: needle, hits: d.results ?? [] }); })
        .catch(() => { if (!cancelled && !ctl.signal.aborted) setContent({ q: needle, hits: [] }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); ctl.abort(); };
  }, [q]);

  // Only render hits that belong to the query on screen, and drop the clients
  // the instant name match already surfaced.
  const contentHits = useMemo(() => {
    if (!content || content.q !== q.trim()) return [];
    const nameHits = new Set(results.map((r) => r.slug));
    return content.hits.filter((h) => !nameHits.has(h.slug)).slice(0, 6);
  }, [content, q, results]);

  // One flat option list so ArrowDown walks from one group straight into the
  // next. Before anything is typed the screens lead, because "where is X" is
  // the question an empty palette is asked; once there is a query a client
  // whose name matches is the likelier target, so clients lead.
  const options = useMemo<Option[]>(() => {
    const pageOptions = pages.map((d): Option => ({ kind: "page", href: d.href, label: d.label, group: d.group ?? "" }));
    const nameOptions = results.map((r): Option => ({ kind: "name", slug: r.slug, company: r.company, docNoBase: r.docNoBase }));
    const contentOptions = contentHits.map((h): Option => ({ kind: "content", slug: h.slug, company: h.company, where: h.where, snippet: h.snippet }));
    return q.trim() ? [...nameOptions, ...pageOptions, ...contentOptions] : [...pageOptions, ...nameOptions, ...contentOptions];
  }, [pages, results, contentHits, q]);

  // The list can shrink under the cursor while a search resolves.
  const activeIndex = options.length === 0 ? -1 : Math.min(active, options.length - 1);

  // aria-activedescendant moves focus for assistive tech but not the scroll
  // position, so the highlighted row has to be brought into view by hand.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex];
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const button = trigger ? (
    <button
      type="button"
      className="topbar-search"
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K /"
      onClick={() => {
        captureTrigger();
        setOpen(true);
      }}
    >
      Search
      <kbd aria-hidden="true">⌘K</kbd>
    </button>
  ) : null;

  if (!open) return button;

  const pick = (o: Option) => {
    setOpen(false);
    router.push(o.kind === "page" ? o.href : `/clients/${o.slug}`);
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") {
      const picked = options[activeIndex];
      if (picked) { e.preventDefault(); pick(picked); }
    }
  };

  // With screens in the list every group is labelled. Without them (the
  // client-only palette) only the content group is, as before.
  const labelled = destinations.length > 0;
  const startsGroup = (i: number) => {
    const o = options[i];
    if (!o || o.kind === options[i - 1]?.kind) return false;
    return labelled || o.kind === "content";
  };

  return (
    <>
    {button}
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh",
      }}
    >
      {/* Click-outside-to-dismiss as a real button rather than a handler on a
          bare div. Escape is the keyboard equivalent, so it stays out of the
          tab order instead of adding an unlabelled stop in front of the
          input. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setOpen(false)}
        style={{ position: "absolute", inset: 0, border: "none", background: "transparent", cursor: "default", padding: 0 }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelled ? "Search the console" : "Search clients"}
        style={{
          position: "relative",
          width: "min(520px, calc(100% - 32px))", background: "var(--bg)", border: "1px solid var(--border-hi)",
          borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.35)",
        }}
      >
        <label className="sr-only" htmlFor={`${uid}-input`}>
          {labelled ? "Search screens and clients" : "Search clients by name, document number, or content"}
        </label>
        <input
          id={`${uid}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          value={q}
          placeholder={labelled ? "Jump to a screen or a client…" : "Jump to a client…"}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={onInputKey}
          style={{ width: "100%", border: "none", borderBottom: "1px solid var(--border)", padding: "16px 20px", fontSize: 15, background: "transparent", color: "var(--text)", outline: "none" }}
        />
        <div className="sr-only" aria-live="polite">
          {options.length === 0 ? "No matches." : `${options.length} result${options.length === 1 ? "" : "s"}.`}
        </div>
        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {options.length === 0 ? (
            <div style={{ padding: "16px 20px", color: "var(--muted)", fontSize: 14 }}>No matches.</div>
          ) : (
            <ul ref={listRef} id={listId} role="listbox" aria-label="Results" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {options.map((o, i) => (
                // The <li> is presentational so the button inside it is the
                // listbox's child. tabIndex -1 keeps every option out of the
                // tab order: selection is driven by aria-activedescendant
                // from the input, which never loses focus.
                <li key={o.kind === "page" ? `page-${o.href}` : `${o.kind}-${o.slug}`} role="presentation">
                  {startsGroup(i) && (
                    <div style={{ padding: "8px 20px 4px", fontSize: 11, color: "var(--label)", borderTop: i ? "1px solid var(--border)" : "none" }}>
                      {HEADING[o.kind]}
                    </div>
                  )}
                  <button
                    type="button"
                    id={optionId(i)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === activeIndex}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    style={{
                      display: "block", width: "100%", border: "none", textAlign: "left",
                      padding: o.kind === "content" ? "10px 18px" : "12px 18px", cursor: "pointer",
                      background: i === activeIndex ? "var(--a-dim)" : "transparent",
                      color: "var(--text)", fontFamily: "inherit", fontSize: 14,
                    }}
                  >
                    {o.kind === "page" ? (
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <span style={{ fontWeight: 500 }}>{o.label}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{o.group}</span>
                      </span>
                    ) : o.kind === "name" ? (
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <span style={{ fontWeight: 500 }}>{o.company}</span>
                        <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{o.docNoBase}</span>
                      </span>
                    ) : (
                      <>
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span style={{ fontWeight: 500 }}>{o.company}</span>
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>{o.where}</span>
                        </span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.snippet}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
