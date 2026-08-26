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

/** One published invoice and the payments actually attributed to it. */
export type InvoiceBalance = {
  /** Doc number, e.g. "LUM-INV-0044-01". */
  no: string;
  /** Billing slug the payments point at, e.g. "invoice-1". */
  slug: string;
  /** Grand total, or null when the stored string was not a single amount. */
  total: number | null;
  /** Payments carrying this invoice's slug. */
  paid: number;
  /** Still owed on this invoice. 0 when settled or when the total is unreadable. */
  outstanding: number;
  /** Paid beyond the total. 0 when the total is unreadable. */
  overpaid: number;
};

export type MoneySummary = {
  /** Sum of parsable published-invoice totals. */
  invoiced: number;
  /** Sum of ALL recorded payments, attributed or not. */
  paid: number;
  /** Sum of what each published invoice still owes, from its OWN payments.
   *  Payments that name no invoice, or name a draft or deleted one, do not
   *  reduce it: see `unattributed`. */
  outstanding: number;
  /** Doc numbers of published invoices whose total didn't parse (not summed). */
  unparsable: string[];
  /** Payments carrying the slug of a published invoice. */
  attributed: number;
  /** paid − attributed: money received that settles no published invoice.
   *  Shown, never quietly netted off the balance. */
  unattributed: number;
  /** Sum of per-invoice overpayment. Shown, never clamped to zero. */
  overpaid: number;
  /** Per-invoice attribution, published invoices only, in record order. */
  invoices: InvoiceBalance[];
};

/** Outstanding is computed per invoice from the payments attributed to it,
 *  then summed. The old version compared two aggregates (every published
 *  invoice against every recorded payment) and clamped the result at zero,
 *  so an untagged payment, or one tagged to an invoice still in draft, drove
 *  the balance to "settled" while money was genuinely owed, and overpayment
 *  vanished entirely (LC-003). See docs/adr/0001-outstanding-balance-semantics.md. */
export function summarizeMoney(
  billing: BillingDoc[] | undefined,
  payments: Payment[] | undefined,
): MoneySummary {
  let invoiced = 0;
  let outstanding = 0;
  let overpaid = 0;
  let attributed = 0;
  const unparsable: string[] = [];
  const invoices: InvoiceBalance[] = [];

  for (const b of billing ?? []) {
    if (b.kind !== "invoice" || b.status !== "published") continue;
    const total = invoiceTotal(b);
    const paidHere = paidAgainst(payments, b.slug);
    // Counted as attributed even when the total is unreadable: the money is
    // still pointed at a real published invoice, so it is not "unassigned".
    attributed += paidHere;
    if (total === null) {
      unparsable.push(b.no);
      invoices.push({ no: b.no, slug: b.slug, total: null, paid: paidHere, outstanding: 0, overpaid: 0 });
      continue;
    }
    invoiced += total;
    const owed = Math.max(0, total - paidHere);
    const over = Math.max(0, paidHere - total);
    outstanding += owed;
    overpaid += over;
    invoices.push({ no: b.no, slug: b.slug, total, paid: paidHere, outstanding: owed, overpaid: over });
  }

  const paid = (payments ?? []).reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  return {
    invoiced,
    paid,
    outstanding,
    unparsable,
    attributed,
    unattributed: Math.max(0, paid - attributed),
    overpaid,
    invoices,
  };
}

export const clientMoney = (c: ClientRecord): MoneySummary => summarizeMoney(c.billing, c.payments);

const DAY_MS = 86_400_000;

export type InvoiceStatus = {
  /** Unpaid remainder (invoice total − payments), 0 when settled/unparsable. */
  outstanding: number;
  /** ISO due date if known. */
  dueOn?: string;
  /** Whole days past due (0 when not overdue or no due date). */
  overdueDays: number;
  /** Unpaid and due within the next 3 days (but not yet overdue). */
  dueSoon: boolean;
  /** Unpaid and past its due date. */
  overdue: boolean;
};

/** Payment status of one invoice relative to `now`. Only meaningful for
 *  published invoices with an outstanding balance and a `dueOn`. */
export function invoiceStatus(b: BillingDoc, payments: Payment[] | undefined, now = Date.now()): InvoiceStatus {
  const total = invoiceTotal(b);
  const paid = paidAgainst(payments, b.slug);
  const outstanding = total === null ? 0 : Math.max(0, total - paid);
  const dueMs = b.dueOn ? Date.parse(b.dueOn) : NaN;
  const hasDue = Number.isFinite(dueMs);
  const unpaid = outstanding > 0;
  const overdue = unpaid && hasDue && dueMs < now;
  const overdueDays = overdue ? Math.floor((now - dueMs) / DAY_MS) : 0;
  const dueSoon = unpaid && hasDue && !overdue && dueMs - now <= 3 * DAY_MS;
  return { outstanding, ...(b.dueOn !== undefined ? { dueOn: b.dueOn } : {}), overdueDays, dueSoon, overdue };
}

/** Overdue published invoices for a client: count + total outstanding. */
export function overdueSummary(c: ClientRecord, now = Date.now()): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const b of c.billing ?? []) {
    if (b.kind !== "invoice" || b.status !== "published") continue;
    const s = invoiceStatus(b, c.payments, now);
    if (s.overdue) {
      count++;
      total += s.outstanding;
    }
  }
  return { count, total };
}
