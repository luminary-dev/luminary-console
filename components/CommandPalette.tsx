"use client";

// ⌘K / Ctrl-K quick-jump to any client by name or doc number. Overlay only —
// the client list is passed in from the server (already loaded on the page).
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type PaletteItem = { slug: string; company: string; docNoBase: string };

export default function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

  if (!open) return null;

  const go = (slug: string) => {
    setOpen(false);
    router.push(`/clients/${slug}`);
  };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, calc(100% - 32px))", background: "var(--bg)", border: "1px solid var(--border-hi)",
          borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.35)",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={q}
          placeholder="Jump to a client…"
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active].slug); }
          }}
          style={{ width: "100%", border: "none", borderBottom: "1px solid var(--border)", padding: "16px 18px", fontSize: 15, background: "transparent", color: "var(--text)", outline: "none" }}
        />
        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {results.length === 0 ? (
            <div style={{ padding: "16px 18px", color: "var(--muted)", fontSize: 14 }}>No clients match.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.slug}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.slug)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                  padding: "12px 18px", border: "none", cursor: "pointer", textAlign: "left",
                  background: i === active ? "var(--a-dim)" : "transparent", color: "var(--text)", fontFamily: "inherit", fontSize: 14,
                }}
              >
                <span style={{ fontWeight: 600 }}>{r.company}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{r.docNoBase}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
