// What needs someone today, worked out from what the console already knows.
//
// The home page used to repeat the menu as five tiles. It said where things
// were, which the menu already does, and nothing about what to do. This turns
// the same records into a short list of things that are waiting: money past
// its due date, documents drafted and not yet sent, a question a client has
// just asked, a task that falls due, shops to message, the next post, code to
// check.
//
// Pure on purpose. The page gathers the records (app/page.tsx) and this
// decides what they mean, so every rule here is tested without a store.
import { fmtLKR, overdueSummary } from "./money";
import { relTime } from "./time";
import { BILLING_LABELS, DOC_LABELS, type ClientRecord } from "./types";

export type TodayItem = {
  id: string;
  /** Which part of the console it belongs to, shown as a small label. */
  area: "Clients" | "Find customers" | "Code";
  /** What is waiting, in a few words. */
  title: string;
  /** Who or what it concerns, and why it is on the list. */
  detail: string;
  href: string;
  /** The words on the button: what pressing it does. */
  action: string;
  /** Late or costing money: listed first and marked. */
  urgent?: boolean;
};

export type TodayInput = {
  now: number;
  /** The signed-in operator's email, for "tasks assigned to me". */
  operator: string;
  clients: ClientRecord[];
  /** The shops queue for this operator, or null when there is no shop list. */
  shops?: { due: number; fresh: number } | null;
  /** The first post nobody has ticked as posted, or null. */
  nextPost?: { id: string; title: string; day: number } | null;
  /** Pull requests waiting for this operator's review. */
  reviews?: number;
  /** Pull requests approved and ready to be added. */
  ready?: number;
};

/** A client's question stays on Today for this long. It cannot stay until it
 *  is answered, because the console does not record answers: they are given
 *  by email or WhatsApp. */
export const QUESTION_DAYS = 3;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Today's date where the studio is (UTC+5:30), as yyyy-mm-dd, which is how a
 *  task's due date is stored. */
export const studioDate = (now: number): string => new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);

const clip = (text: string, max = 90): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

function forClient(c: ClientRecord, input: TodayInput): TodayItem[] {
  const { now, operator } = input;
  const out: TodayItem[] = [];
  const base = `/clients/${c.slug}`;

  const overdue = overdueSummary(c, now);
  if (overdue.count > 0) {
    out.push({
      id: `overdue-${c.slug}`,
      area: "Clients",
      title: `${fmtLKR(overdue.total)} is overdue`,
      detail: `${c.company}: ${plural(overdue.count, "invoice")} past ${overdue.count === 1 ? "its" : "their"} due date.`,
      href: `${base}?tab=billing`,
      action: "Open their money",
      urgent: true,
    });
  }

  // Written and waiting for one of us to read and publish. Until then the
  // client cannot see them.
  const drafts = [
    ...Object.values(c.docs ?? {}).filter((d) => d?.status === "draft").map((d) => DOC_LABELS[d.type]),
  ];
  if (drafts.length > 0) {
    out.push({
      id: `drafts-${c.slug}`,
      area: "Clients",
      title: `${plural(drafts.length, "document")} ready to check and send`,
      detail: `${c.company}: ${drafts.join(", ")}. The client cannot see ${drafts.length === 1 ? "it" : "them"} until you publish.`,
      href: `${base}?tab=documents`,
      action: "Check the documents",
    });
  }
  const bills = (c.billing ?? []).filter((b) => b.status === "draft" && (b.kind === "invoice" || b.kind === "receipt"));
  if (bills.length > 0) {
    out.push({
      id: `bills-${c.slug}`,
      area: "Clients",
      title: `${plural(bills.length, "invoice or receipt", "invoices and receipts")} ready to check and send`,
      detail: `${c.company}: ${bills.map((b) => BILLING_LABELS[b.kind]).join(", ")}, drafted and not yet published.`,
      href: `${base}?tab=billing`,
      action: "Open their money",
    });
  }

  const cutoff = now - QUESTION_DAYS * 86_400_000;
  const asked = (c.comments ?? []).filter((q) => Date.parse(q.at) > cutoff);
  const latest = asked[asked.length - 1];
  if (latest) {
    out.push({
      id: `question-${c.slug}`,
      area: "Clients",
      title: asked.length === 1 ? `${latest.by} asked a question` : `${latest.by} asked ${asked.length} questions`,
      detail: `${c.company}, ${relTime(latest.at, now)}: “${clip(latest.text)}”`,
      href: `${base}?tab=messages`,
      action: "Read it",
    });
  }

  const today = studioDate(now);
  const me = operator.toLowerCase();
  for (const [i, t] of (c.tasks ?? []).entries()) {
    if (t.done || !t.due || t.due > today) continue;
    // Someone else's task is theirs to see. One with no name on it is anyone's.
    if (t.assignee && t.assignee.toLowerCase() !== me) continue;
    const late = t.due < today;
    out.push({
      id: `task-${c.slug}-${i}`,
      area: "Clients",
      title: clip(t.text, 70),
      detail: `${c.company}: a task that ${late ? `was due on ${t.due}` : "is due today"}${t.assignee ? "" : ", not assigned to anyone"}.`,
      href: base,
      action: "Open the task",
      ...(late ? { urgent: true } : {}),
    });
  }

  return out;
}

/** Everything waiting, the late things first and otherwise in the order the
 *  menu lists them: clients, then customers, then code. */
export function buildToday(input: TodayInput): TodayItem[] {
  const items: TodayItem[] = input.clients.flatMap((c) => forClient(c, input));

  const shops = input.shops;
  if (shops && (shops.due > 0 || shops.fresh > 0)) {
    const parts = [
      shops.due > 0 ? `${plural(shops.due, "follow-up")} due` : "",
      shops.fresh > 0 ? `${plural(shops.fresh, "new shop")} to message` : "",
    ].filter(Boolean);
    items.push({
      id: "shops",
      area: "Find customers",
      title: parts.join(" and "),
      detail: "Each message is already written. Send it, then mark it sent so the team knows.",
      href: "/sales",
      action: "Message shops",
    });
  }

  if (input.nextPost) {
    items.push({
      id: "post",
      area: "Find customers",
      title: `Next post to put up: ${input.nextPost.title}`,
      detail: `Day ${input.nextPost.day} in the posting order. Its pictures and caption are ready to copy.`,
      href: `/sales/kit#post-${input.nextPost.id}`,
      action: "Open the post",
    });
  }

  if ((input.reviews ?? 0) > 0) {
    const n = input.reviews ?? 0;
    items.push({
      id: "reviews",
      area: "Code",
      title: `${plural(n, "pull request")} waiting for you to check`,
      detail: "A teammate asked you to look over a change before it is added.",
      href: "/github",
      action: "Check them",
    });
  }
  if ((input.ready ?? 0) > 0) {
    const n = input.ready ?? 0;
    items.push({
      id: "ready",
      area: "Code",
      title: `${plural(n, "pull request")} approved and ready to add`,
      detail: "Checked and passing. Adding it is the last step.",
      href: "/github",
      action: "Open pull requests",
    });
  }

  // A stable sort: the late things rise, everything else keeps its place.
  return items.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent));
}
