// The client page's tabs.
//
// A client record carries sixteen cards' worth of things: documents, designs,
// the live site, billing, change orders, questions, uploads, notes, tasks,
// emails, activity. Stacked in one column that was over 5,000px of scrolling
// with no way to jump, and finding the invoice meant passing the designs
// first. Each tab now holds one job.
//
// These are links, not buttons with client state: the tab lives in the URL
// (?tab=billing), so it survives a refresh, the back button works, and a link
// to one tab can be sent to a teammate. Server-rendered, so only the cards of
// the tab in view are read and painted.
import Link from "next/link";
import LinkPending from "./LinkPending";

// The ids are what the address carries (?tab=billing) and have not changed, so
// links sent before the tabs were renamed still open the right one. The labels
// are the plain words: "Money", not "Billing"; "Settings", not "Details".
// `what` is the one sentence Help prints for the tab.
export const CLIENT_TABS = [
  { id: "overview", label: "Summary", keywords: "summary steps stage next tasks todo notes overview", what: "Where the project stands and what to do next, your tasks, your private notes and this client's history." },
  { id: "documents", label: "Documents", keywords: "documents docs estimate quotation quote proposal contract sow questions form questionnaire answers links", what: "The links the client opens, their answers to the questions form, and every document: estimate, quotation, proposal and contract." },
  { id: "design", label: "Design & website", keywords: "design designs mockup website site live domain publish handover", what: "The design ideas the client picks from, the finished website, and the handover pack that closes the project." },
  { id: "billing", label: "Money", keywords: "money invoice invoices receipt receipts payment payments paid pay owed overdue balance billing change orders extras", what: "Invoices, receipts, payments received, what is still owed, and changes the client asked for after agreeing the price." },
  { id: "messages", label: "Client messages", keywords: "messages comments questions files uploads emails email assistant reply", what: "Questions the client asked, files they sent, emails we sent them, and the assistant that can draft a reply." },
  { id: "details", label: "Settings", keywords: "settings brief delete remove", what: "The original brief, and the button that deletes the client." },
] as const;

export type ClientTab = (typeof CLIENT_TABS)[number]["id"];

/** What a tab is called on screen. */
export function tabLabel(id: ClientTab): string {
  return CLIENT_TABS.find((t) => t.id === id)?.label ?? "";
}

/** The tab a `?tab=` value asks for. Anything that is not a known tab (a typo,
 *  an old link, a repeated parameter's second value) is the overview, so a bad
 *  address still opens the client instead of an empty page. */
export function clientTabFrom(raw: string | string[] | undefined): ClientTab {
  const asked = Array.isArray(raw) ? raw[0] : raw;
  return CLIENT_TABS.find((t) => t.id === asked)?.id ?? "overview";
}

export default function ClientTabs({
  slug,
  current,
  counts = {},
}: {
  slug: string;
  current: ClientTab;
  /** A number to show on a tab, e.g. open tasks. Zero and absent show nothing. */
  counts?: Partial<Record<ClientTab, number>>;
}) {
  return (
    <nav className="subnav" aria-label="Client sections">
      <ul className="subnav-list">
        {CLIENT_TABS.map((t) => {
          const n = counts[t.id] ?? 0;
          return (
            <li key={t.id}>
              <Link
                className="subnav-link"
                // The overview is the bare URL, so there is one address for it.
                href={t.id === "overview" ? `/clients/${slug}` : `/clients/${slug}?tab=${t.id}`}
                aria-current={t.id === current ? "page" : undefined}
                // Tabs swap the cards below; the tabs themselves stay put, so
                // jumping back to the top on every tab would lose your place.
                scroll={false}
              >
                <LinkPending>
                  {t.label}
                  {n > 0 && <span className="subnav-count">{n}</span>}
                </LinkPending>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
