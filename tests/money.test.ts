// LC-003: outstanding-balance semantics. See
// docs/adr/0001-outstanding-balance-semantics.md for the decision these
// assertions pin down.
import { describe, expect, it } from "vitest";
import { summarizeMoney, invoiceStatus, overdueSummary } from "@/lib/money";
import type { BillingDoc, ClientRecord, Payment } from "@/lib/types";

function invoice(
  slug: string,
  no: string,
  total: string | number | null,
  status: BillingDoc["status"] = "published",
  extra: Partial<BillingDoc> = {},
): BillingDoc {
  return {
    kind: "invoice",
    stage: "progress",
    slug,
    no,
    status,
    updatedAt: "2026-08-01T00:00:00.000Z",
    htmlUrl: `/api/asset/${slug}.html`,
    pdfUrl: `/api/asset/${slug}.pdf`,
    data: total === null ? { total: "5,000 to 10,000" } : { total },
    ...extra,
  };
}

const pay = (amount: number, invoiceSlug?: string): Payment => ({
  at: "2026-08-02T00:00:00.000Z",
  amount,
  method: "bank transfer",
  ...(invoiceSlug ? { invoiceSlug } : {}),
});

describe("LC-003: an unattributed payment never settles the account", () => {
  it("keeps the balance owed when the money names no published invoice", () => {
    // The reproduction from the finding: a published invoice is genuinely
    // unpaid, while payments sit against a draft invoice and against nothing.
    const billing = [
      invoice("invoice-1", "LUM-INV-0044-01", "LKR 100,000"),
      invoice("invoice-2", "LUM-INV-0044-02", "LKR 50,000", "draft"),
    ];
    const payments = [pay(50_000), pay(50_000, "invoice-2")];

    const m = summarizeMoney(billing, payments);

    expect(m.invoiced).toBe(100_000);
    expect(m.paid).toBe(100_000); // unchanged meaning: every recorded payment
    // The old arithmetic returned max(0, 100000 - 100000) = 0, i.e. "settled".
    expect(m.outstanding).toBe(100_000);
    expect(m.attributed).toBe(0);
    expect(m.unattributed).toBe(100_000);
  });

  it("does not let a payment on one invoice pay off another", () => {
    const billing = [
      invoice("invoice-1", "LUM-INV-0044-01", 100_000),
      invoice("invoice-2", "LUM-INV-0044-02", 40_000),
    ];
    const m = summarizeMoney(billing, [pay(100_000, "invoice-1")]);

    expect(m.outstanding).toBe(40_000);
    expect(m.invoices.find((i) => i.slug === "invoice-1")?.outstanding).toBe(0);
    expect(m.invoices.find((i) => i.slug === "invoice-2")?.outstanding).toBe(40_000);
  });
});

describe("LC-003: overpayment is visible, not clamped", () => {
  it("reports the excess instead of hiding it at zero", () => {
    const m = summarizeMoney([invoice("invoice-1", "LUM-INV-0044-01", 40_000)], [pay(50_000, "invoice-1")]);

    expect(m.outstanding).toBe(0);
    expect(m.overpaid).toBe(10_000);
    expect(m.invoices[0]?.overpaid).toBe(10_000);
    expect(m.unattributed).toBe(0);
  });

  it("does not let an overpaid invoice cancel a genuinely unpaid one", () => {
    const billing = [
      invoice("invoice-1", "LUM-INV-0044-01", 40_000),
      invoice("invoice-2", "LUM-INV-0044-02", 30_000),
    ];
    const m = summarizeMoney(billing, [pay(60_000, "invoice-1")]);

    expect(m.outstanding).toBe(30_000);
    expect(m.overpaid).toBe(20_000);
  });
});

describe("LC-003: per-invoice attribution", () => {
  it("splits payments by the invoice they name, including partials", () => {
    const billing = [
      invoice("invoice-1", "LUM-INV-0044-01", 100_000),
      invoice("invoice-2", "LUM-INV-0044-02", 60_000),
    ];
    const payments = [pay(30_000, "invoice-1"), pay(20_000, "invoice-1"), pay(60_000, "invoice-2")];

    const m = summarizeMoney(billing, payments);

    expect(m.invoices).toHaveLength(2);
    expect(m.invoices[0]).toMatchObject({
      slug: "invoice-1",
      no: "LUM-INV-0044-01",
      total: 100_000,
      paid: 50_000,
      outstanding: 50_000,
      overpaid: 0,
    });
    expect(m.invoices[1]).toMatchObject({ slug: "invoice-2", paid: 60_000, outstanding: 0 });
    expect(m.outstanding).toBe(50_000);
    expect(m.attributed).toBe(110_000);
    expect(m.unattributed).toBe(0);
  });

  it("counts payments on an unreadable invoice as attributed, not unassigned", () => {
    // The invoice contributes nothing to `invoiced` (its total is a range),
    // but the money is still pointed at a real published invoice.
    const m = summarizeMoney([invoice("invoice-1", "LUM-INV-0044-01", null)], [pay(25_000, "invoice-1")]);

    expect(m.invoiced).toBe(0);
    expect(m.unparsable).toEqual(["LUM-INV-0044-01"]);
    expect(m.attributed).toBe(25_000);
    expect(m.unattributed).toBe(0);
    expect(m.outstanding).toBe(0);
    expect(m.overpaid).toBe(0);
  });

  it("ignores drafts, receipts and handover packs", () => {
    const billing: BillingDoc[] = [
      invoice("invoice-1", "LUM-INV-0044-01", 100_000, "draft"),
      { ...invoice("receipt-1", "LUM-RCP-0044-01", 100_000), kind: "receipt" },
      { ...invoice("handover-1", "LUM-HOP-0044-01", 100_000), kind: "handover", stage: "other" },
    ];
    const m = summarizeMoney(billing, []);

    expect(m.invoiced).toBe(0);
    expect(m.outstanding).toBe(0);
    expect(m.invoices).toHaveLength(0);
  });
});

describe("LC-003: the existing consumers' expectations still hold", () => {
  it("keeps the settled case settled", () => {
    const m = summarizeMoney([invoice("invoice-1", "LUM-INV-0044-01", "LKR 45,000")], [pay(45_000, "invoice-1")]);

    expect(m.outstanding).toBe(0);
    expect(m.overpaid).toBe(0);
    expect(m.unattributed).toBe(0);
  });

  it("keeps `paid` meaning every recorded payment, which the handover pack derives from", () => {
    // lib/handover.ts prints "Other payments received" as
    // money.paid - (payments attributed to published invoices).
    const billing = [invoice("invoice-1", "LUM-INV-0044-01", 100_000)];
    const payments = [pay(60_000, "invoice-1"), pay(15_000)];
    const m = summarizeMoney(billing, payments);

    expect(m.paid).toBe(75_000);
    expect(m.paid - m.attributed).toBe(15_000);
    expect(m.unattributed).toBe(15_000);
  });

  it("answers empty records with zeroes rather than throwing", () => {
    const m = summarizeMoney(undefined, undefined);

    expect(m).toMatchObject({
      invoiced: 0,
      paid: 0,
      outstanding: 0,
      attributed: 0,
      unattributed: 0,
      overpaid: 0,
    });
    expect(m.invoices).toEqual([]);
    expect(m.unparsable).toEqual([]);
  });

  it("leaves invoiceStatus and overdueSummary on their own per-invoice math", () => {
    const now = Date.parse("2026-08-20T00:00:00.000Z");
    const overdue = invoice("invoice-1", "LUM-INV-0044-01", 100_000, "published", {
      dueOn: "2026-08-10T00:00:00.000Z",
    });
    const client = { billing: [overdue], payments: [pay(40_000, "invoice-1")] } as ClientRecord;

    expect(invoiceStatus(overdue, client.payments, now)).toMatchObject({
      outstanding: 60_000,
      overdue: true,
      overdueDays: 10,
    });
    expect(overdueSummary(client, now)).toEqual({ count: 1, total: 60_000 });
  });
});
