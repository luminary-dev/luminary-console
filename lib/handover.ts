// Assembling the handover pack's data from the client record. Everything here
// is derived, never generated: doc numbers, issue dates and money all come off
// the record, and the prose is fixed studio copy. See lib/templates/handover.ts
// for the renderer.
import type { ClientRecord, DocType } from "./types";
import { DOC_LABELS } from "./types";
import { billingLabel } from "./doclabels";
import { fmtLKR, invoiceTotal, paidAgainst, summarizeMoney } from "./money";
import { currentStage, stageRank } from "./stage";
import type { HandoverData } from "./templates/handover";
import type { ProposalData, QuotationData } from "./templates/docs";

/** Days of post-launch defect cover — the studio-wide policy (see the
 *  POLICY_ITEMS in lib/templates/shell.ts, which states the same window). */
export const WARRANTY_DAYS = 30;

/** "2026-08-07T…Z" → "07 Aug 2026" (Colombo). Empty input → "—". */
export function dayLabel(iso?: string): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Colombo",
  });
}

/** When the project was delivered: the explicit stamp, else the published
 *  final receipt (legacy records never got a `deliveredAt`). */
export function deliveredAtIso(c: ClientRecord): string | undefined {
  if (c.deliveredAt && Number.isFinite(Date.parse(c.deliveredAt))) return c.deliveredAt;
  const rcp = c.billing?.find(
    (b) => b.kind === "receipt" && b.stage === "final" && b.status === "published",
  );
  return rcp?.updatedAt && Number.isFinite(Date.parse(rcp.updatedAt)) ? rcp.updatedAt : undefined;
}

/** A handover pack is only meaningful once the work is actually delivered:
 *  stage ≥ delivered, or a published final receipt (which is what normally
 *  advances the stage in the first place). */
export function handoverEligible(c: ClientRecord): boolean {
  if (stageRank(currentStage(c)) >= stageRank("delivered")) return true;
  return !!c.billing?.some(
    (b) => b.kind === "receipt" && b.stage === "final" && b.status === "published",
  );
}

const CORE_ORDER: DocType[] = [
  "estimate",
  "quotation",
  "proposal",
  "contract",
  "invoice",
  "receipt",
];

const CARE_PITCH =
  "Sites drift: dependencies age, content goes stale, and small problems compound quietly. Our monthly care plan covers hosting oversight, security and dependency updates, backups, uptime monitoring and a bank of small content or design changes each month — so you have someone who already knows this build when something needs doing. Reply to this pack and we'll size a plan around how much you expect to change.";

const NEXT_STEPS =
  "Confirm you can sign in to everything in the access table, then change the passwords we hand over. Anything that looks wrong in the first 30 days, email support@luminary-dev.xyz with a screenshot and the page address — that's a warranty item and it's free. New features or new pages are quoted separately as a change order.";

export function buildHandoverData(client: ClientRecord): HandoverData {
  const quotation = client.docs.quotation?.data as QuotationData | undefined;
  const proposal = client.docs.proposal?.data as ProposalData | undefined;

  // Deliberately NOT falling back to client.brief: the brief is the
  // operator's private intake note — /clients/new asks for internal figures
  // ("UX 5–10k, development 30–40k LKR") right in its hint — and this
  // document is signed by the client.
  const summary =
    quotation?.scopeSummary?.trim() ||
    proposal?.overview?.trim() ||
    `The ${client.projectLabel || "project"} for ${client.company} is complete and handed over.`;

  // Prefer the proposal's explicit deliverables list, then the quotation's
  // line items (which are what the client actually paid for).
  const deliverables = (
    proposal?.deliverables?.length
      ? proposal.deliverables
      : (quotation?.items ?? []).map((i) => i.title)
  )
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, 14);

  // Everything the client can see, oldest first. The handover pack itself is
  // excluded — a document doesn't index itself.
  const docIndex = [
    ...CORE_ORDER.filter((t) => client.docs[t]?.status === "published").map((t) => ({
      label: DOC_LABELS[t],
      no: client.docs[t]!.no,
      at: client.docs[t]!.updatedAt,
    })),
    ...(client.billing ?? [])
      .filter((b) => b.status === "published" && b.kind !== "handover")
      .map((b) => ({ label: billingLabel(b), no: b.no, at: b.updatedAt })),
  ]
    .sort((a, b) => (a.at || "").localeCompare(b.at || ""))
    .map((r) => ({ label: r.label, no: r.no, date: dayLabel(r.at) }));

  const delivered = deliveredAtIso(client);
  const warrantyUntil = delivered
    ? dayLabel(new Date(Date.parse(delivered) + WARRANTY_DAYS * 86_400_000).toISOString())
    : "—";

  const money = summarizeMoney(client.billing, client.payments);
  const lines = (client.billing ?? [])
    .filter((b) => b.kind === "invoice" && b.status === "published")
    .map((b) => {
      const total = invoiceTotal(b);
      const paid = paidAgainst(client.payments, b.slug);
      return {
        no: b.no,
        label: billingLabel(b),
        amount: total === null ? "see document" : fmtLKR(total),
        paid: paid > 0 ? fmtLKR(paid) : "—",
      };
    });

  // Per-invoice "received" only counts payments tagged with that invoice's
  // slug, but "Total received" counts every payment. Without this line the
  // two disagree on the same page whenever a payment was recorded without
  // picking an invoice (the field is optional).
  const attributed = (client.billing ?? [])
    .filter((b) => b.kind === "invoice" && b.status === "published")
    .reduce((s, b) => s + paidAgainst(client.payments, b.slug), 0);
  const otherPaid = money.paid - attributed;
  if (lines.length && otherPaid > 0) {
    lines.push({
      no: "Not assigned to an invoice",
      label: "Other payments received",
      amount: "—",
      paid: fmtLKR(otherPaid),
    });
  }

  return {
    projectLabel: client.projectLabel || "—",
    summary,
    deliverables,
    deliveredOn: dayLabel(delivered),
    warrantyUntil,
    warranty: `Every defect in what we built is fixed at no charge for ${WARRANTY_DAYS} days from delivery — anything that doesn't work the way this pack and the quotation say it should. New features, new pages, content changes and third-party outages sit outside the warranty and are quoted as change orders.`,
    docIndex,
    credentials: [
      { system: "Website / hosting", detail: "Control panel or dashboard sign-in" },
      { system: "Domain & DNS", detail: "Registrar account holding the domain" },
      { system: "Content management", detail: "Where you edit pages and content" },
      { system: "Analytics", detail: "Traffic and conversion reporting" },
      { system: "Business email", detail: "Mailbox / forwarding configuration" },
      { system: "Source files", detail: "Code repository and design files" },
    ],
    payment: {
      invoiced: fmtLKR(money.invoiced),
      paid: fmtLKR(money.paid),
      outstanding: fmtLKR(money.outstanding),
      // "Settled in full" is a statement about invoices that were actually
      // issued. With nothing published, invoiced/outstanding are both 0 and
      // this used to declare a project with no invoices at all "Account
      // settled in full · IP transferred" — on a signed document.
      settled: money.invoiced > 0 && money.outstanding <= 0 && money.unparsable.length === 0,
      lines,
      unparsable: money.unparsable,
    },
    care: CARE_PITCH,
    nextSteps: NEXT_STEPS,
  };
}
