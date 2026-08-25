// LC-025: unpublishing the final receipt must take the delivery stamp back
// off, or the warranty clock keeps running and currentStage() drifts
// delivered, warranty, closed off a delivery that no longer exists.
import { describe, expect, it } from "vitest";
import { advanceStage, currentStage, revertDelivery } from "@/lib/stage";
import type { BillingDoc, ClientRecord } from "@/lib/types";

const DAY = 86_400_000;

function finalReceipt(status: BillingDoc["status"] = "published"): BillingDoc {
  return {
    kind: "receipt",
    stage: "final",
    slug: "receipt-2",
    no: "LUM-RCP-0044-02",
    status,
    // Just published: the legacy fallback in deliveredMs reads this when the
    // record carries no deliveredAt of its own.
    updatedAt: new Date().toISOString(),
    htmlUrl: "/api/asset/receipt-2.html",
    pdfUrl: "/api/asset/receipt-2.pdf",
    data: { total: "LKR 70,000" },
  };
}

/** The minimum of a real record: only what the stage functions read. */
function record(over: Partial<ClientRecord> = {}): ClientRecord {
  return {
    slug: "acme",
    company: "Acme",
    brief: "",
    projectLabel: "Website",
    docNoBase: "0044",
    status: "drafts_ready",
    createdAt: "2026-06-01T00:00:00.000Z",
    domain: "acme.example.test",
    dnsStatus: "automated",
    extraQuestions: [],
    docs: {},
    ...over,
  } as ClientRecord;
}

describe("LC-025: unpublishing the final receipt clears the delivery stamp", () => {
  it("removes deliveredAt when nothing else establishes delivery", () => {
    const c = record({ billing: [finalReceipt()], payments: [{ at: "2026-07-01T00:00:00.000Z", amount: 30_000, method: "bank transfer" }] });
    advanceStage(c, "delivered");
    // Backdate the stamp the way a real record would be after 45 days.
    c.deliveredAt = new Date(Date.now() - 45 * DAY).toISOString();
    expect(currentStage(c)).toBe("closed");

    // The route sets the document back to draft, then reverts delivery.
    c.billing![0]!.status = "draft";
    const changed = revertDelivery(c);

    expect(changed).toBe(true);
    expect(c.deliveredAt).toBeUndefined();
  });

  it("stops the stage drifting to closed off the stale timestamp", () => {
    const c = record({ billing: [finalReceipt()], payments: [{ at: "2026-07-01T00:00:00.000Z", amount: 30_000, method: "bank transfer" }] });
    advanceStage(c, "delivered");
    c.deliveredAt = new Date(Date.now() - 45 * DAY).toISOString();

    c.billing![0]!.status = "draft";
    revertDelivery(c);

    // Before the fix this was still "closed": deliveredAt survived and the
    // 45-day drift ran off it.
    expect(currentStage(c)).toBe("development");
  });

  it("keeps the stamp while another published final receipt still stands", () => {
    const other = { ...finalReceipt(), slug: "receipt-3", no: "LUM-RCP-0044-03" };
    const c = record({ billing: [finalReceipt("draft"), other] });
    c.stage = "delivered";
    const stamp = new Date(Date.now() - 45 * DAY).toISOString();
    c.deliveredAt = stamp;

    expect(revertDelivery(c)).toBe(false);
    expect(c.deliveredAt).toBe(stamp);
    expect(currentStage(c)).toBe("closed");
  });

  it("leaves a deliberately closed client closed", () => {
    // "Closed" is also how a lead is closed out unwon, so it is never
    // inferred away by this path.
    const c = record({
      billing: [finalReceipt("draft")],
      stage: "closed",
      deliveredAt: new Date(Date.now() - 45 * DAY).toISOString(),
    });

    expect(revertDelivery(c)).toBe(true);
    expect(c.deliveredAt).toBeUndefined();
    expect(c.stage).toBe("closed");
  });

  it("is a no-op on a client that was never delivered", () => {
    const c = record({ stage: "development" });

    expect(revertDelivery(c)).toBe(false);
    expect(c.stage).toBe("development");
  });
});

describe("LC-025: the forward path is unchanged", () => {
  it("stamps deliveredAt on advance and drifts to warranty then closed", () => {
    const c = record();
    advanceStage(c, "delivered");
    expect(c.deliveredAt).toBeTruthy();
    expect(currentStage(c)).toBe("delivered");

    c.deliveredAt = new Date(Date.now() - 5 * DAY).toISOString();
    expect(currentStage(c)).toBe("warranty");

    c.deliveredAt = new Date(Date.now() - 40 * DAY).toISOString();
    expect(currentStage(c)).toBe("closed");
  });

  it("never demotes on a lower-ranked event", () => {
    const c = record({ stage: "development" });
    expect(advanceStage(c, "quoted")).toBe(false);
    expect(c.stage).toBe("development");
  });
});
