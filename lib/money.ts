// Outstanding-balance arithmetic. Invoice grand totals live inside generated
// doc data as pre-formatted strings ("LKR 45,000"); parseAmount extracts the
// number and returns null unless the string holds exactly one clean amount,
// so callers can fall back to asking the operator instead of mis-summing a
// range or a sentence. Pure functions — shared by server pages and client
// components (BillingCard).
import type { BillingDoc, ClientRecord, Payment } from "./types";

/** "LKR 45,000" / "45,000" / 45000 → 45000. Null when not a single clean
 *  amount (ranges like "5,000–10,000" or prose stay null on purpose). */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/LKR|Rs\.?|,|\s/gi, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const fmtLKR = (n: number): string => `LKR ${n.toLocaleString("en-US")}`;

/** The invoice's grand total as a number, or null when unparsable. */
export function invoiceTotal(b: BillingDoc): number | null {
  const data = b.data as { total?: unknown } | null;
  return parseAmount(data?.total);
}

/** Sum of recorded payments that settle a given invoice slug. */
export function paidAgainst(payments: Payment[] | undefined, invoiceSlug: string): number {
  return (payments ?? [])
    .filter((p) => p.invoiceSlug === invoiceSlug)
    .reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);
}

export type MoneySummary = {
  /** Sum of parsable published-invoice totals. */
  invoiced: number;
  /** Sum of all recorded payments. */
  paid: number;
  /** max(0, invoiced − paid). */
  outstanding: number;
  /** Doc numbers of published invoices whose total didn't parse (not summed). */
  unparsable: string[];
};

/** Outstanding = published invoices − payments. */
export function summarizeMoney(
  billing: BillingDoc[] | undefined,
  payments: Payment[] | undefined,
): MoneySummary {
  let invoiced = 0;
  const unparsable: string[] = [];
  for (const b of billing ?? []) {
    if (b.kind !== "invoice" || b.status !== "published") continue;
    const t = invoiceTotal(b);
    if (t === null) unparsable.push(b.no);
    else invoiced += t;
  }
  const paid = (payments ?? []).reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  return { invoiced, paid, outstanding: Math.max(0, invoiced - paid), unparsable };
}

export const clientMoney = (c: ClientRecord): MoneySummary => summarizeMoney(c.billing, c.payments);
