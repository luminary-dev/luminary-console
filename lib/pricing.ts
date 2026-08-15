// Deterministic pricing engine. This is the single source of truth for
// Luminary's commercial model: fixed per-page build prices, phase multipliers
// for pages added later, the aftercare change-request fee, and the 30/70
// payment split. Everything here is pure and testable — the AI layer imports
// these numbers so it quotes them verbatim instead of inventing figures, and
// the pipeline reconciles generated quotations against them so money never
// drifts. All amounts are LKR; formatting reuses lib/money.fmtLKR.
import { fmtLKR as fmtMoney } from "./money";

/** Fixed per-page build prices (LKR). The primary page price INCLUDES the 3
 *  prototype concepts, selection plus up to 2 revision rounds, a responsive
 *  build, light and dark themes, accessibility, an enquiry form wired to
 *  email, and deployment. Add-on pages reuse that design direction, so they
 *  are cheaper. */
export const PAGE_RATES = {
  primary: 65000,
  standard: 22000,
  functional: 42000,
} as const;

/** Pages added AFTER the SOW is signed are charged on the page base rate with
 *  a multiplier by the phase the work lands in. */
export const PHASE_MULTIPLIERS = {
  design: 1.0,
  development: 1.4,
  prelaunch: 1.8,
} as const;

/** Additional requirements: quoted per item, or this per working day (LKR). */
export const DAY_RATE = 20000;

/** Aftercare: the first FREE_CHANGE_REQUESTS change requests are free, then
 *  this per change request (LKR). */
export const CHANGE_REQUEST_FEE = 6000;
export const FREE_CHANGE_REQUESTS = 5;

/** Payment split: 30% on design approval (development begins), 70% on
 *  delivery. There is no upfront signing payment — the design work is done
 *  first, and the 30% falls due once the client approves the design. */
export const PAYMENT_SPLIT = {
  designApproval: 0.3,
  delivery: 0.7,
} as const;

export type PageType = keyof typeof PAGE_RATES;
export type Phase = keyof typeof PHASE_MULTIPLIERS;

const PAGE_TITLES: Record<PageType, string> = {
  primary: "Primary page (landing / long-scroll)",
  standard: "Standard page",
  functional: "Functional page (form / listing / dynamic / integration)",
};

/** Format an LKR amount, e.g. "LKR 65,000". Rounds to the whole rupee. */
export const fmtLKR = (n: number): string => fmtMoney(Math.round(n));

/** One priced page line. `phase` only matters for pages added later (design
 *  phase is x1.0, i.e. the base rate); the initial build uses "design". */
export function pageLineItem(
  type: PageType,
  phase: Phase = "design",
): { title: string; unitRate: number; amount: number } {
  const unitRate = PAGE_RATES[type];
  const amount = Math.round(unitRate * PHASE_MULTIPLIERS[phase]);
  const title =
    phase === "design"
      ? PAGE_TITLES[type]
      : `${PAGE_TITLES[type]} (added in ${phase}, x${PHASE_MULTIPLIERS[phase]})`;
  return { title, unitRate, amount };
}

/** Sum a set of line-item amounts. */
export function computeQuoteTotal(items: { amount: number }[]): number {
  return items.reduce((s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0), 0);
}

export type PaymentStageKey = "designApproval" | "delivery";
export type PaymentStage = {
  stage: PaymentStageKey;
  label: string;
  pct: number;
  amount: number;
  /** Days from issue the milestone invoice is due. */
  dueOffsetDays: number;
};

/** The 30/70 schedule for a fixed total. The delivery amount is the exact
 *  remainder, so the two milestones always sum back to the total even after
 *  rounding. */
export function paymentSchedule(total: number): PaymentStage[] {
  const designApproval = Math.round(total * PAYMENT_SPLIT.designApproval);
  const delivery = total - designApproval;
  return [
    {
      stage: "designApproval",
      label: "On design approval (development begins)",
      pct: PAYMENT_SPLIT.designApproval,
      amount: designApproval,
      dueOffsetDays: 7,
    },
    {
      stage: "delivery",
      label: "On delivery",
      pct: PAYMENT_SPLIT.delivery,
      amount: delivery,
      dueOffsetDays: 14,
    },
  ];
}

/** Aftercare change-request price by position after launch: the first 5
 *  (index 0-4) are free/included, every one after that is CHANGE_REQUEST_FEE. */
export function changeOrderAmount(indexAfterLaunch: number): number {
  return indexAfterLaunch < FREE_CHANGE_REQUESTS ? 0 : CHANGE_REQUEST_FEE;
}

/** Ordered payment-terms lines for a quotation at a fixed total: the exact
 *  30/70 amounts followed by the standing policy. Deterministic, so the
 *  quotation's money can be reconciled to it without model drift. */
export function quotationPaymentTerms(total: number): string[] {
  const s = paymentSchedule(total);
  return [
    `30% on design approval: ${fmtLKR(s[0].amount)}. Falls due once you approve the design; development begins once it is settled. It covers the discovery and the 3 prototype concepts delivered in the design stage.`,
    `70% on delivery: ${fmtLKR(s[1].amount)}. Due on delivery, payable before final handover.`,
    "Included: 3 prototype concepts, selection plus up to 2 revision rounds, and refinements to the approved design during development.",
    "New pages, features or changes requested after delivery are quoted first as a written change order and invoiced once that change is completed.",
    "Aftercare: the first 5 change requests are free, then LKR 6,000 per change request; additional requirements are quoted per item or LKR 20,000 per working day.",
    "A 30-day post-launch warranty covers defects at no charge. Intellectual property transfers to you on full payment. Once signed the price is fixed unless you add pages or requirements.",
  ];
}

/** The commercial model in plain language. Reused wherever the policy has to
 *  be stated verbatim (templates, prompts). No em-dashes or en-dashes. */
export const POLICY: string[] = [
  "Payment is staged 30/70: 30% on design approval (development begins; this also covers the discovery and 3 prototype concepts delivered in the design stage), 70% on delivery before final handover.",
  "Design stage delivers 3 prototype concepts; you pick 1, then we run up to 2 revision rounds on it.",
  "Development includes refinements to the approved design; new pages, features or changes requested after delivery are billable, quoted first as a written change order, and invoiced once the change is completed.",
  "Aftercare: the first 5 change requests are free, then LKR 6,000 per change request. A change request is one discrete self-contained change; larger work is several change requests and is quoted first.",
  "Additional requirements are quoted per item, or LKR 20,000 per working day.",
  "A 30-day post-launch warranty covers defects at no charge; new features are excluded.",
  "Intellectual property transfers to you on full payment. Once the SOW is signed the price is fixed unless you request additional pages or requirements.",
];

/** Fixed pricing figures as a compact reference block for AI prompts, so the
 *  model quotes the exact rates rather than inventing ranges. */
export const PRICING_REFERENCE = `FIXED PRICING MODEL (use these exact figures, do not invent other rates):
- Primary page (landing / long-scroll): ${fmtLKR(PAGE_RATES.primary)}. INCLUDES 3 prototype concepts, selection plus up to 2 revision rounds, responsive build, light and dark themes, accessibility, an enquiry form wired to email, and deployment.
- Standard page: ${fmtLKR(PAGE_RATES.standard)}.
- Functional page (form / listing / dynamic / integration): ${fmtLKR(PAGE_RATES.functional)}.
- The 3 prototypes are a one-time design-direction exploration delivered with the primary page; add-on pages reuse that direction and are cheaper.
- Pages added later use a multiplier on the page base rate by phase: Design x${PHASE_MULTIPLIERS.design}, Development x${PHASE_MULTIPLIERS.development}, Late development / pre-launch x${PHASE_MULTIPLIERS.prelaunch}.
- Additional requirements: quoted per item, or ${fmtLKR(DAY_RATE)} per working day.
- Aftercare: first ${FREE_CHANGE_REQUESTS} change requests free, then ${fmtLKR(CHANGE_REQUEST_FEE)} per change request.
- Payment split: 30% on design approval (development begins), 70% on delivery before final handover. No upfront signing payment.`;
