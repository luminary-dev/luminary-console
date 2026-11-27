"use client";

// The console's "find anything" dialog: Search in the menu, ⌘K / Ctrl-K or
// "/" from anywhere.
//
// It lists every screen and every client. The screens are not written out
// here: they are the menu itself (lib/menu.ts), so a screen that is added to
// the menu is findable without anyone remembering to add it here too. Each one
// matches on its name, the group it sits in, the sentence that says what it is
// for, and its keywords, which include what the screen used to be called
// ("sales", "engineering", "CI"), so old habits still find the new names.
import CommandPalette, { type PaletteDestination, type PaletteItem } from "./CommandPalette";
import { ALL_SCREENS } from "@/lib/menu";

/** Listed before anything is typed: the places most visits are headed. */
const FIRST = new Set(["/", "/clients", "/clients/new", "/sales", "/github", "/activity"]);

export const DESTINATIONS: PaletteDestination[] = ALL_SCREENS.map((s) => ({
  href: s.href,
  label: s.label,
  ...(s.group ? { group: s.group } : {}),
  keywords: `${s.keywords ?? ""} ${s.what}`,
  ...(FIRST.has(s.href) ? { top: true } : {}),
}));

/** The client index, as the palette lists it. The route is the same one the
 *  clients page is built from, behind the same session gate. */
async function loadClients(): Promise<PaletteItem[]> {
  const res = await fetch("/api/clients", { cache: "no-store" });
  if (!res.ok) throw new Error(`clients ${res.status}`);
  const list: unknown = await res.json();
  // Read defensively: one odd row must not cost the palette every client.
  return (Array.isArray(list) ? list : []).flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null) return [];
    const c = row as { slug?: unknown; company?: unknown; docNoBase?: unknown };
    return typeof c.slug === "string" && typeof c.company === "string"
      ? [{ slug: c.slug, company: c.company, docNoBase: typeof c.docNoBase === "string" ? c.docNoBase : "" }]
      : [];
  });
}

export default function QuickFind({ trigger = false }: { trigger?: boolean }) {
  return <CommandPalette items={[]} destinations={DESTINATIONS} loadItems={loadClients} trigger={trigger} />;
}
