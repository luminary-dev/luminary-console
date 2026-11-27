// The "what happens next" line at the top of a client's page
// (lib/next-step.ts): one test per point in a project's life, in the order a
// project meets them. Invented client; this repository is public.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nextStep, WAITING_LABEL } from "@/lib/next-step";
import type { ClientRecord } from "@/lib/types";

const NOW = Date.parse("2026-11-24T06:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function client(over: Partial<ClientRecord> = {}): ClientRecord {
  return {
    slug: "tide-tees", company: "Tide Tees", brief: "", projectLabel: "Shop website", docNoBase: "0061",
    status: "created", createdAt: iso(30), domain: "tide-tees.example.test", dnsStatus: "automated",
    extraQuestions: [], docs: {}, ...over,
  } as ClientRecord;
}

const doc = (type: string, status: "draft" | "published") =>
  ({ type, no: `LUM-${type}`, status, updatedAt: iso(2), htmlUrl: "", pdfUrl: "", data: {} }) as never;

const bill = (kind: string, stage: string, status: "draft" | "published", total = "LKR 30,000") =>
  ({ kind, stage, slug: `${kind}-${stage}`, no: `LUM-${kind}`, status, updatedAt: iso(3), htmlUrl: "", pdfUrl: "", data: { total } }) as never;

const design = (id: string, status: "draft" | "published") =>
  ({ id, title: `Design ${id}`, status, htmlUrl: "", updatedAt: iso(5) }) as never;

const pay = (slug: string, amount: number) => ({ at: iso(1), amount, method: "bank", invoiceSlug: slug });

const step = (over: Partial<ClientRecord>) => nextStep(client(over), NOW);

// lib/stage.ts reads the real clock to move a delivered project into warranty
// and then closed. Pin it, or these tests change their answer a month from now.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe("the next step, before anything is agreed", () => {
  it("a new client: send the estimate if it is still a draft", () => {
    const s = step({ docs: { estimate: doc("estimate", "draft") } });
    expect(s).toMatchObject({ stage: "lead", waitingOn: "us", title: "Check the estimate and send it.", tab: "documents" });
  });

  it("then wait for their answers to the questions form", () => {
    const s = step({ docs: { estimate: doc("estimate", "published") } });
    expect(s).toMatchObject({ waitingOn: "client", title: "Waiting for the client to fill in the questions form." });
  });

  it("answers in: nothing to do while the documents are written", () => {
    expect(step({ status: "answers_in" })).toMatchObject({ waitingOn: "nobody", tab: "documents" });
  });

  it("drafts ready: check and publish them", () => {
    const s = step({ status: "drafts_ready", docs: { quotation: doc("quotation", "draft") } });
    expect(s).toMatchObject({ waitingOn: "us", title: "Check the quotation, proposal and contract, then publish them." });
  });

  it("quotation published: wait for the client to accept", () => {
    const s = step({ status: "drafts_ready", docs: { quotation: doc("quotation", "published") } });
    expect(s).toMatchObject({ stage: "quoted", waitingOn: "client", title: "Waiting for the client to accept the quotation." });
  });
});

describe("the next step, once the price is agreed", () => {
  const accepted = { stage: "accepted" as const, acceptance: { name: "Sam Rivers", at: iso(9) } };

  it("no designs yet: add some", () => {
    expect(step(accepted)).toMatchObject({ waitingOn: "us", title: "Add design ideas for the client to choose from.", tab: "design" });
  });

  it("designs uploaded but hidden: publish them", () => {
    expect(step({ ...accepted, designs: [design("1", "draft")] })).toMatchObject({ waitingOn: "us", title: "Publish the designs." });
  });

  it("designs published: wait for the client to pick one", () => {
    expect(step({ ...accepted, designs: [design("1", "published"), design("2", "draft")] })).toMatchObject({
      waitingOn: "client",
      title: "Waiting for the client to pick a design.",
    });
  });

  const chosen = { ...accepted, designs: [design("1", "published")], selectedDesign: { id: "1", title: "Design 1", at: iso(4) } };

  it("design picked: make the 30% invoice, and say which design it was", () => {
    const s = step(chosen);
    expect(s).toMatchObject({ waitingOn: "us", title: "Make the 30% invoice.", tab: "billing" });
    expect(s.detail).toContain("“Design 1”");
  });

  it("invoice drafted: send it; published: wait for the money", () => {
    expect(step({ ...chosen, billing: [bill("invoice", "progress", "draft")] }).title).toBe("Check the 30% invoice and send it.");
    expect(step({ ...chosen, billing: [bill("invoice", "progress", "published")] })).toMatchObject({
      waitingOn: "client",
      title: "Waiting for the 30% payment.",
    });
  });

  it("a part payment is still waiting; the full amount is not", () => {
    const billing = [bill("invoice", "progress", "published")];
    expect(step({ ...chosen, billing, payments: [pay("invoice-progress", 10000)] }).title).toBe("Waiting for the 30% payment.");
    expect(step({ ...chosen, billing, payments: [pay("invoice-progress", 30000)] }).title).toBe("Start building the website.");
  });
});

describe("the next step, while the site is being built", () => {
  const building = { stage: "development" as const };
  const site = (status: "draft" | "published") => ({ repo: "o/r", ref: "main", project: "p", status, updatedAt: iso(1) });

  it("no site connected: build it and connect it", () => {
    expect(step(building)).toMatchObject({ waitingOn: "us", title: "Build the website, then connect it here.", tab: "design" });
  });

  it("connected but hidden: publish it", () => {
    expect(step({ ...building, site: site("draft") }).title).toBe("Publish the finished website.");
  });

  it("live: the 70% invoice, then its payment, then its receipt", () => {
    const live = { ...building, site: site("published") };
    expect(step(live).title).toBe("Make the 70% invoice.");
    const sent = { ...live, billing: [bill("invoice", "final", "published", "LKR 70,000")] };
    expect(step(sent)).toMatchObject({ waitingOn: "client", title: "Waiting for the 70% payment." });
    const paid = { ...sent, payments: [pay("invoice-final", 70000)] };
    expect(step(paid).title).toBe("Make the receipt for the 70%.");
    const drafted = { ...paid, billing: [...sent.billing, bill("receipt", "final", "draft")] };
    expect(step(drafted)).toMatchObject({ waitingOn: "us", title: "Publish the receipt for the 70%." });
    expect(step(drafted).detail).toContain("marks the project delivered");
  });
});

describe("the next step, after delivery", () => {
  const delivered = { stage: "delivered" as const, deliveredAt: iso(3) };

  it("no handover pack: make it; drafted: publish it", () => {
    expect(step(delivered)).toMatchObject({ waitingOn: "us", title: "Make the handover pack.", tab: "design" });
    expect(step({ ...delivered, billing: [bill("handover", "other", "draft")] })).toMatchObject({
      title: "Publish the handover pack.",
      tab: "billing",
    });
  });

  it("handed over: nothing to do but honour the warranty, with its end date", () => {
    const s = step({ ...delivered, billing: [bill("handover", "other", "published")] });
    expect(s.waitingOn).toBe("nobody");
    expect(s.stage).toBe("warranty");
    expect(s.title).toBe("Delivered. The 30-day warranty runs until 2026-12-21.");
  });

  it("closed: says so, and asks for nothing", () => {
    expect(step({ stage: "closed" })).toMatchObject({ waitingOn: "nobody", title: "This project is closed." });
  });
});

describe("whose turn it is", () => {
  it("has a plain label for each answer", () => {
    expect(WAITING_LABEL).toEqual({
      us: "Your move",
      client: "Waiting on the client",
      nobody: "Nothing to do right now",
    });
  });
});
