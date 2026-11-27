// What lands on Today, and in what order (lib/today.ts). Every rule that
// decides whether something is "waiting on you" is here, with invented
// clients: this repository is public.
import { describe, expect, it } from "vitest";
import { buildToday, studioDate, QUESTION_DAYS, type TodayInput } from "@/lib/today";
import type { ClientRecord } from "@/lib/types";

const NOW = Date.parse("2026-11-24T06:00:00Z"); // 11:30 in Colombo
const ME = "me@example.test";
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function client(over: Partial<ClientRecord> = {}): ClientRecord {
  return {
    slug: "tide-tees",
    company: "Tide Tees",
    brief: "",
    projectLabel: "Shop website",
    docNoBase: "0061",
    status: "created",
    createdAt: iso(20),
    domain: "tide-tees.example.test",
    dnsStatus: "automated",
    extraQuestions: [],
    docs: {},
    ...over,
  } as ClientRecord;
}

const doc = (type: string, status: "draft" | "published") =>
  ({ type, no: `LUM-${type}`, status, updatedAt: iso(2), htmlUrl: "", pdfUrl: "", data: {} }) as never;

const invoice = (over: Record<string, unknown> = {}) =>
  ({
    kind: "invoice", stage: "progress", slug: "invoice-1", no: "LUM-INV-0061-1", status: "published",
    updatedAt: iso(10), dueOn: iso(4).slice(0, 10), htmlUrl: "", pdfUrl: "", data: { total: "LKR 40,000" },
    ...over,
  }) as never;

const today = (input: Partial<TodayInput>) => buildToday({ now: NOW, operator: ME, clients: [], ...input });

describe("Today", () => {
  it("is empty when nothing is waiting", () => {
    expect(today({ clients: [client()], shops: { due: 0, fresh: 0 }, nextPost: null, reviews: 0, ready: 0 })).toEqual([]);
    expect(today({ shops: null })).toEqual([]);
  });

  it("lists an overdue invoice with the amount, the client and a way to their money", () => {
    const [item] = today({ clients: [client({ billing: [invoice()] })] });
    expect(item).toMatchObject({
      area: "Clients",
      title: "LKR 40,000 is overdue",
      href: "/clients/tide-tees?tab=billing",
      urgent: true,
    });
    expect(item?.detail).toBe("Tide Tees: 1 invoice past its due date.");
  });

  it("does not call an invoice overdue once it is paid, or before its date", () => {
    const paid = client({ billing: [invoice()], payments: [{ at: iso(1), amount: 40000, method: "bank", invoiceSlug: "invoice-1" }] });
    const notYet = client({ billing: [invoice({ dueOn: iso(-3).slice(0, 10) })] });
    expect(today({ clients: [paid, notYet] })).toEqual([]);
  });

  it("lists documents that are written but not yet published, by name", () => {
    const [item] = today({
      clients: [client({ docs: { quotation: doc("quotation", "draft"), proposal: doc("proposal", "draft"), estimate: doc("estimate", "published") } })],
    });
    expect(item?.title).toBe("2 documents ready to check and send");
    expect(item?.detail).toContain("Quotation, Project Proposal");
    expect(item?.href).toBe("/clients/tide-tees?tab=documents");
    expect(item?.urgent).toBeUndefined();
  });

  it("lists a drafted invoice or receipt, but not a drafted handover pack", () => {
    const items = today({
      clients: [
        client({
          billing: [
            invoice({ status: "draft", dueOn: undefined }),
            { ...(invoice({ status: "draft" }) as object), kind: "handover", slug: "handover" } as never,
          ],
        }),
      ],
    });
    expect(items.map((i) => i.title)).toEqual(["1 invoice or receipt ready to check and send"]);
  });

  it("shows a client's question for a few days, with its words, then lets it go", () => {
    const asked = (daysAgo: number) =>
      client({ comments: [{ doc: "quotation", by: "Sam Rivers", text: "Does the price   include hosting?", at: iso(daysAgo) }] });
    const [item] = today({ clients: [asked(1)] });
    expect(item?.title).toBe("Sam Rivers asked a question");
    expect(item?.detail).toContain("“Does the price include hosting?”");
    expect(item?.href).toBe("/clients/tide-tees?tab=messages");
    expect(today({ clients: [asked(QUESTION_DAYS + 1)] })).toEqual([]);
  });

  it("lists a task that is due, to the person it is assigned to or to everyone if nobody is", () => {
    const day = studioDate(NOW);
    const tasks = [
      { text: "Mine, due today", done: false, at: iso(3), due: day, assignee: ME.toUpperCase() },
      { text: "Mine, late", done: false, at: iso(3), due: "2026-11-20", assignee: ME },
      { text: "Nobody's, late", done: false, at: iso(3), due: "2026-11-21" },
      { text: "Someone else's", done: false, at: iso(3), due: "2026-11-20", assignee: "other@example.test" },
      { text: "Done already", done: true, at: iso(3), due: "2026-11-20", assignee: ME },
      { text: "Not due yet", done: false, at: iso(3), due: "2026-12-01", assignee: ME },
      { text: "No date", done: false, at: iso(3), assignee: ME },
    ];
    const items = today({ clients: [client({ tasks })] });
    // Late ones first, then the one due today.
    expect(items.map((i) => i.title)).toEqual(["Mine, late", "Nobody's, late", "Mine, due today"]);
    expect(items.map((i) => !!i.urgent)).toEqual([true, true, false]);
    expect(items[1]?.detail).toContain("not assigned to anyone");
  });

  it("counts a day by the studio's clock, not the server's", () => {
    // 20:00 UTC on the 23rd is already the 24th in Colombo.
    expect(studioDate(Date.parse("2026-11-23T20:00:00Z"))).toBe("2026-11-24");
    expect(studioDate(Date.parse("2026-11-23T18:00:00Z"))).toBe("2026-11-23");
  });

  it("puts shops, the next post and code after clients, in the menu's order", () => {
    const items = today({
      clients: [client({ docs: { estimate: doc("estimate", "draft") } })],
      shops: { due: 2, fresh: 1 },
      nextPost: { id: "07", title: "See your shop first", day: 4 },
      reviews: 1,
      ready: 3,
    });
    expect(items.map((i) => i.area)).toEqual(["Clients", "Find customers", "Find customers", "Code", "Code"]);
    expect(items[1]).toMatchObject({ title: "2 follow-ups due and 1 new shop to message", href: "/sales" });
    expect(items[2]).toMatchObject({ title: "Next post to put up: See your shop first", href: "/sales/kit#post-07" });
    expect(items[3]?.title).toBe("1 pull request waiting for you to check");
    expect(items[4]?.title).toBe("3 pull requests approved and ready to add");
  });

  it("words shops correctly when only one kind is waiting", () => {
    expect(today({ shops: { due: 0, fresh: 5 } })[0]?.title).toBe("5 new shops to message");
    expect(today({ shops: { due: 1, fresh: 0 } })[0]?.title).toBe("1 follow-up due");
  });

  it("lifts what is late above everything else, whatever part of the work it is in", () => {
    const items = today({
      clients: [client({ docs: { estimate: doc("estimate", "draft") } }), client({ slug: "late-co", company: "Late Co", billing: [invoice()] })],
      shops: { due: 1, fresh: 0 },
    });
    expect(items.map((i) => i.id)).toEqual(["overdue-late-co", "drafts-tide-tees", "shops"]);
  });

  it("gives every item a button that says what pressing it does", () => {
    const items = today({
      clients: [client({ billing: [invoice()], docs: { estimate: doc("estimate", "draft") } })],
      shops: { due: 1, fresh: 1 },
      nextPost: { id: "01", title: "Hello", day: 1 },
      reviews: 2,
    });
    for (const item of items) {
      expect(item.action.length).toBeGreaterThan(3);
      expect(item.href.startsWith("/")).toBe(true);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    }
  });
});
