// The search inside client records: what it finds, and which tab of the client
// it sends you to. Invented clients only; this repository is public.
import { describe, expect, it, vi } from "vitest";

const record = {
  slug: "tide-tees",
  company: "Tide Tees",
  brief: "A shop for printed shirts.",
  notes: "Call before noon.",
  docs: { quotation: { no: "LUM-Q-0061", status: "published", data: { total: "LKR 90,000" } } },
  billing: [{ kind: "invoice", no: "LUM-INV-0061-1", data: { total: "LKR 27,000", amount: 27000 } }],
  payments: [{ at: "2026-11-01", amount: 27000, method: "bank transfer" }],
  comments: [{ by: "A client", text: "Can we change the logo colour?", at: "2026-11-02" }],
  uploads: [{ name: "shirt-photos.zip", at: "2026-11-03", size: 1, url: "/x" }],
};

vi.mock("@/lib/store", () => ({
  READ_CONCURRENCY: 4,
  getIndex: async () => [{ slug: "tide-tees", company: "Tide Tees" }],
  getClients: async () => [record],
}));

const { GET } = await import("@/app/api/search/route");

async function search(q: string) {
  const res = await GET(new Request(`http://x/api/search?q=${encodeURIComponent(q)}`));
  return ((await res.json()) as { results: { where: string; tab: string; snippet: string }[] }).results;
}

describe("search inside client records", () => {
  it("opens an invoice number on Money, with the words of the invoice and no JSON", async () => {
    const [hit] = await search("LUM-INV-0061-1");
    expect(hit).toMatchObject({ where: "invoice", tab: "billing" });
    expect(hit?.snippet).toContain("LKR 27,000");
    expect(hit?.snippet).not.toContain("{");
  });

  it("finds clients by the kind of thing they have", async () => {
    expect((await search("payment"))[0]?.tab).toBe("billing");
    expect((await search("quotation"))[0]?.tab).toBe("documents");
  });

  it("sends each kind of match to the tab it is on", async () => {
    expect((await search("logo colour"))[0]).toMatchObject({ where: "comment by A client", tab: "messages" });
    expect((await search("shirt-photos"))[0]?.tab).toBe("messages");
    expect((await search("before noon"))[0]?.tab).toBe("overview");
    expect((await search("printed shirts"))[0]?.tab).toBe("details");
  });

  it("asks for at least two letters", async () => {
    expect(await search("a")).toEqual([]);
  });
});
