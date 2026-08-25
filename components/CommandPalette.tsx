"use client";

// ⌘K / Ctrl-K quick-jump to any client by name or doc number. Overlay only:
// the client list is passed in from the server (already loaded on the page)
// and the content search hits /api/search.
//
// Accessibility (LC-043): the overlay is a dialog, the input is a combobox
// owning a single listbox, and arrow keys move aria-activedescendant across
// BOTH result groups rather than only the name matches.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";

export type PaletteItem = { slug: string; company: string; docNoBase: string };

type ContentHit = { slug: string; company: string; where: string; snippet: string };

/** Content results carry the query they were issued for, so a response that
 *  resolves after the query moved on can never be rendered (LC-022). The
 *  AbortController cancels the request; this is the belt to that braces. */
type ContentState = { q: string; hits: ContentHit[] };

type Option =
  | { kind: "name"; slug: string; company: string; docNoBase: string }
  | { kind: "content"; slug: string; company: string; where: string; snippet: string };

export default function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [content, setContent] = useState<ContentState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setContent(null);
      // focus after the overlay paints
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

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

  // One flat option list so ArrowDown walks from the name matches straight
  // into the content matches.
  const options = useMemo<Option[]>(
    () => [
      ...results.map((r): Option => ({ kind: "name", slug: r.slug, company: r.company, docNoBase: r.docNoBase })),
      ...contentHits.map((h): Option => ({ kind: "content", slug: h.slug, company: h.company, where: h.where, snippet: h.snippet })),
    ],
    [results, contentHits],
  );

  // The list can shrink under the cursor while a search resolves.
  const activeIndex = options.length === 0 ? -1 : Math.min(active, options.length - 1);

  // aria-activedescendant moves focus for assistive tech but not the scroll
  // position, so the highlighted row has to be brought into view by hand.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex];
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const go = (slug: string) => {
    setOpen(false);
    router.push(`/clients/${slug}`);
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") {
      const picked = options[activeIndex];
      if (picked) { e.preventDefault(); go(picked.slug); }
    }
  };

  const nameCount = results.length;

  return (
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
        role="dialog"
        aria-modal="true"
        aria-label="Search clients"
        style={{
          position: "relative",
          width: "min(520px, calc(100% - 32px))", background: "var(--bg)", border: "1px solid var(--border-hi)",
          borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.35)",
        }}
      >
        <label className="sr-only" htmlFor={`${uid}-input`}>Search clients by name, document number, or content</label>
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
          placeholder="Jump to a client…"
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={onInputKey}
          style={{ width: "100%", border: "none", borderBottom: "1px solid var(--border)", padding: "16px 18px", fontSize: 15, background: "transparent", color: "var(--text)", outline: "none" }}
        />
        <div className="sr-only" aria-live="polite">
          {options.length === 0 ? "No matches." : `${options.length} result${options.length === 1 ? "" : "s"}.`}
        </div>
        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {options.length === 0 ? (
            <div style={{ padding: "16px 18px", color: "var(--muted)", fontSize: 14 }}>No matches.</div>
          ) : (
            <ul ref={listRef} id={listId} role="listbox" aria-label="Results" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {options.map((o, i) => (
                // The <li> is presentational so the button inside it is the
                // listbox's child. tabIndex -1 keeps every option out of the
                // tab order: selection is driven by aria-activedescendant
                // from the input, which never loses focus.
                <li key={`${o.kind}-${o.slug}`} role="presentation">
                  {o.kind === "content" && i === nameCount && (
                    <div style={{ padding: "8px 18px 4px", fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--label)", borderTop: nameCount ? "1px solid var(--border)" : "none" }}>
                      In documents and notes
                    </div>
                  )}
                  <button
                    type="button"
                    id={optionId(i)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === activeIndex}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(o.slug)}
                    style={{
                      display: "block", width: "100%", border: "none", textAlign: "left",
                      padding: o.kind === "name" ? "12px 18px" : "10px 18px", cursor: "pointer",
                      background: i === activeIndex ? "var(--a-dim)" : "transparent",
                      color: "var(--text)", fontFamily: "inherit", fontSize: 14,
                    }}
                  >
                    {o.kind === "name" ? (
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <span style={{ fontWeight: 600 }}>{o.company}</span>
                        <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{o.docNoBase}</span>
                      </span>
                    ) : (
                      <>
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontWeight: 600 }}>{o.company}</span>
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
  );
}
