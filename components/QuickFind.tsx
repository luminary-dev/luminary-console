"use client";

// The console's "find anything" control: a Search button in the top bar of
// every page, and ⌘K / Ctrl-K from anywhere.
//
// Before this the only way to reach a screen was to know which section it sat
// under and click down to it, and the only search was for clients, on two
// pages, behind a shortcut the interface never mentioned. This lists every
// screen by name and by the words people actually look for ("invoice" finds
// nothing called that, so Clients carries it as a keyword), and every client.
//
// The destinations are written out here rather than derived from the section
// components, because a server component cannot hand a client component a
// module full of them and the list is short. tests/quick-find.test.tsx fails
// if a section gains a page that is missing here.
import CommandPalette, { type PaletteDestination, type PaletteItem } from "./CommandPalette";

export const DESTINATIONS: PaletteDestination[] = [
  { href: "/", label: "Home", group: "Console", keywords: "dashboard hub overview start", top: true },
  { href: "/clients", label: "Clients", group: "Console", keywords: "customers projects list documents billing invoice quotation", top: true },
  { href: "/clients/new", label: "New client", group: "Clients", keywords: "add create start estimate lead", top: true },
  { href: "/sales", label: "Sales: send queue", group: "Sales", keywords: "outreach shops messages whatsapp instagram next follow up", top: true },
  { href: "/sales/shops", label: "Sales: shops", group: "Sales", keywords: "leads prospects list status notes import" },
  { href: "/sales/scripts", label: "Sales: reply scripts", group: "Sales", keywords: "templates answers price objections" },
  { href: "/sales/kit", label: "Sales: social kit", group: "Sales", keywords: "posts instagram facebook captions pictures content" },
  { href: "/github", label: "Pull requests", group: "Engineering", keywords: "github prs review merge code", top: true },
  { href: "/github/repos", label: "Repositories", group: "Engineering", keywords: "github repos health" },
  { href: "/github/ci", label: "CI", group: "Engineering", keywords: "github checks builds failing flaky tests" },
  { href: "/github/deployments", label: "Deployments", group: "Engineering", keywords: "github deploy vercel production versions" },
  { href: "/github/releases", label: "Releases", group: "Engineering", keywords: "github versions tags notes" },
  { href: "/github/security", label: "Security", group: "Engineering", keywords: "github dependabot alerts vulnerabilities secrets" },
  { href: "/github/insights", label: "Insights", group: "Engineering", keywords: "github team health metrics" },
  { href: "/github/activity", label: "Engineering activity", group: "Engineering", keywords: "github events stream" },
  { href: "/activity", label: "Activity", group: "Console", keywords: "log history audit updates notifications", top: true },
  { href: "/publish", label: "Publish", group: "Console", keywords: "blog article portfolio project landing page write", top: true },
  { href: "/settings", label: "Settings", group: "Account", keywords: "sessions devices sign out export csv data" },
];

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

export default function QuickFind() {
  return <CommandPalette items={[]} destinations={DESTINATIONS} loadItems={loadClients} trigger />;
}
