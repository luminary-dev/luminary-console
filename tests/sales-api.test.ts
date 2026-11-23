// The sales board's routes against an in-memory store: importing the shop
// list, recording a tap, and the case the console version exists for, two
// operators reaching for the same shop.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Progress, ProgressMap } from "@/lib/sales";
import type { LeadFile } from "@/lib/sales-store";

const ME = "dhanikaanupama2000@gmail.com";
const GAVEEN = "buddhikagaveen2021@gmail.com";

const mem = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  log: [] as string[][],
  operator: "",
}));

vi.mock("@/lib/store", () => {
  class StoreConflictError extends Error {}
  const get = (path: string) => (mem.state.has(path) ? structuredClone(mem.state.get(path)) : null);
  return {
    StoreConflictError,
    readState: async (path: string) => get(path),
    writeState: async (path: string, data: unknown) => void mem.state.set(path, structuredClone(data)),
    updateState: async (path: string, mutate: (current: unknown) => unknown) => {
      const next = mutate(get(path));
      mem.state.set(path, structuredClone(next));
      return next;
    },
  };
});

vi.mock("@/lib/operator", () => ({
  currentOperator: async () => mem.operator,
  logOperatorActivity: async (...args: string[]) => void mem.log.push(args),
}));

import { GET } from "@/app/api/sales/route";
import { POST as importLeads } from "@/app/api/sales/leads/route";
import { POST as tap } from "@/app/api/sales/progress/route";

const SHOPS = [
  { id: "sample-bakes", name: "Sample Bakes", ig: "sample_bakes", wa: "94770000002", waOk: true, hook: "Your bio links to an article." },
  { id: "paper-lantern", name: "Paper Lantern", ig: "paper.lantern", hook: "Your bio says DM to order." },
];

const post = (body: unknown) =>
  new Request("https://console.example.test/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const progressOf = () => (mem.state.get("sales/progress.json") ?? {}) as ProgressMap;

beforeEach(() => {
  mem.state.clear();
  mem.log.length = 0;
  mem.operator = ME;
});

describe("GET /api/sales", () => {
  it("answers an empty board before anything is imported", async () => {
    expect(await (await GET()).json()).toEqual({ leads: [], importedAt: null, importedBy: null, progress: {} });
  });
});

describe("POST /api/sales/leads", () => {
  it("imports a bare list or { leads }, and says how many are new", async () => {
    const first = await importLeads(post(SHOPS));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, total: 2, added: 2, removed: 0 });
    expect((mem.state.get("sales/leads.json") as LeadFile).importedBy).toBe(ME);

    const again = await importLeads(post({ leads: [...SHOPS, { id: "tide-tees", name: "Tide Tees", ig: "tide.tees" }] }));
    expect(await again.json()).toMatchObject({ total: 3, added: 1, removed: 0 });
    expect(mem.log.at(-1)).toEqual(["imported the shop list", "sales", "3 shops, 1 new"]);
  });

  it("keeps what the team has recorded when a new list is imported", async () => {
    await importLeads(post(SHOPS));
    await tap(post({ id: "sample-bakes", action: { type: "sent", step: 0 } }));
    await importLeads(post([SHOPS[0]]));
    expect(progressOf()["sample-bakes"]?.status).toBe("sent");
    expect(mem.log.at(-1)?.[2]).toBe("1 shops, 0 new, 1 removed");
  });

  it("refuses a file that is not JSON, and a list with problems, without storing anything", async () => {
    expect((await importLeads(post("not json"))).status).toBe(400);
    const bad = await importLeads(post([{ id: "Bad Id", name: "x" }]));
    expect(bad.status).toBe(400);
    expect((await bad.json()).problems[0]).toMatch(/^Shop 1: id/);
    expect(mem.state.has("sales/leads.json")).toBe(false);
  });

  it("refuses a body far too large to be a shop list", async () => {
    expect((await importLeads(post("x".repeat(1_500_001)))).status).toBe(413);
  });
});

describe("POST /api/sales/progress", () => {
  beforeEach(async () => {
    await importLeads(post(SHOPS));
    mem.log.length = 0;
  });

  it("records a first message against the operator who sent it", async () => {
    const res = await tap(post({ id: "sample-bakes", action: { type: "sent", step: 0 } }));
    expect(res.status).toBe(200);
    const { progress } = (await res.json()) as { progress: Progress };
    expect(progress).toMatchObject({ status: "sent", sentBy: ME, followUps: 0 });
    expect(progressOf()["sample-bakes"]).toEqual(progress);
    // A send is not a log line: the record carries it.
    expect(mem.log).toEqual([]);
  });

  it("tells the second operator who got there first, and leaves the record alone", async () => {
    mem.operator = GAVEEN;
    await tap(post({ id: "sample-bakes", action: { type: "sent", step: 0 } }));
    const before = progressOf()["sample-bakes"];

    mem.operator = ME;
    const res = await tap(post({ id: "sample-bakes", action: { type: "sent", step: 0 } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^Gaveen already messaged this shop on \d{4}-\d{2}-\d{2}\.$/);
    expect(progressOf()["sample-bakes"]).toEqual(before);
  });

  it("logs a status change for the team, by shop name", async () => {
    const res = await tap(post({ id: "paper-lantern", action: { type: "status", status: "won" } }));
    expect(res.status).toBe(200);
    expect(mem.log).toEqual([["marked a shop paid", "sales", "Paper Lantern"]]);
  });

  it("stores a note and refuses a preview link that is not https", async () => {
    const ok = await tap(post({ id: "paper-lantern", action: { type: "details", note: "call after 5" } }));
    expect((await ok.json()).progress.note).toBe("call after 5");
    const bad = await tap(post({ id: "paper-lantern", action: { type: "details", previewUrl: "http://plain.test" } }));
    expect(bad.status).toBe(400);
    expect(progressOf()["paper-lantern"]?.previewUrl).toBeUndefined();
  });

  it("answers 404 for a shop that is not on the board and 400 for an unknown action", async () => {
    expect((await tap(post({ id: "nope", action: { type: "sent", step: 0 } }))).status).toBe(404);
    expect((await tap(post({ id: "paper-lantern", action: { type: "delete" } }))).status).toBe(400);
    expect((await tap(post("{"))).status).toBe(400);
  });
});
