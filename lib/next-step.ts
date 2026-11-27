// Where a client's project stands, and the one next thing to do about it.
//
// A client page shows a lot: documents, designs, invoices, messages. What it
// did not say was the thing a newcomer most needs: what happens next, and
// whose turn it is. This reads the record and answers that in one sentence.
//
// The order is not invented here. It is the order the console itself moves a
// project through (lib/stage.ts): publishing the quotation makes it Quoted,
// the client accepting makes it Accepted, the first payment makes it
// Development, the published final receipt makes it Delivered, then 30 days
// of warranty, then Closed. Inside each stage the step is whichever fact is
// still missing: a document not yet published, a design not yet chosen, an
// invoice not yet paid.
//
// Pure: no store, no clock except the one passed in.
import { invoiceStatus } from "./money";
import { currentStage } from "./stage";
import type { BillingDoc, ClientRecord, ClientStage } from "./types";

/** The client page's tab ids (components/ClientTabs.tsx), named here so this
 *  file stays free of component imports. */
export type StepTab = "documents" | "design" | "billing";

export type NextStep = {
  stage: ClientStage;
  /** Whose turn it is. "nobody" is "nothing to do right now". */
  waitingOn: "us" | "client" | "nobody";
  /** What happens next, as one sentence. */
  title: string;
  /** Why, or how to do it. */
  detail: string;
  /** The tab to do it on, when there is one. */
  tab?: StepTab;
};

export const WAITING_LABEL: Record<NextStep["waitingOn"], string> = {
  us: "Your move",
  client: "Waiting on the client",
  nobody: "Nothing to do right now",
};

const DAY_MS = 86_400_000;

const find = (c: ClientRecord, kind: BillingDoc["kind"], stage: BillingDoc["stage"]) =>
  (c.billing ?? []).find((b) => b.kind === kind && b.stage === stage);

/** An invoice is settled when nothing is left to pay on it. */
const paid = (c: ClientRecord, invoice: BillingDoc, now: number) =>
  invoiceStatus(invoice, c.payments, now).outstanding <= 0;

/** One payment's steps are the same shape for both halves of the price:
 *  make the invoice, send it, wait for the money. Returns null once paid. */
function payment(
  c: ClientRecord,
  stage: ClientStage,
  half: "progress" | "final",
  share: "30%" | "70%",
  why: string,
  now: number,
): NextStep | null {
  const invoice = find(c, "invoice", half);
  if (!invoice) {
    return { stage, waitingOn: "us", title: `Make the ${share} invoice.`, detail: why, tab: "billing" };
  }
  if (invoice.status === "draft") {
    return {
      stage,
      waitingOn: "us",
      title: `Check the ${share} invoice and send it.`,
      detail: "It is written and waiting. The client cannot see it until you publish.",
      tab: "billing",
    };
  }
  if (!paid(c, invoice, now)) {
    return {
      stage,
      waitingOn: "client",
      title: `Waiting for the ${share} payment.`,
      detail: "Press Mark paid on the invoice when the money arrives.",
      tab: "billing",
    };
  }
  return null;
}

export function nextStep(c: ClientRecord, now = Date.now()): NextStep {
  const stage = currentStage(c);

  if (stage === "closed") {
    return {
      stage,
      waitingOn: "nobody",
      title: "This project is closed.",
      detail: "Everything is kept here for the record. Set the stage back if work starts again.",
    };
  }

  if (stage === "delivered" || stage === "warranty") {
    const pack = (c.billing ?? []).find((b) => b.kind === "handover");
    if (!pack) {
      return {
        stage,
        waitingOn: "us",
        title: "Make the handover pack.",
        detail: "It closes the project out: what was built, every document we issued, the logins and the warranty.",
        tab: "design",
      };
    }
    if (pack.status === "draft") {
      return {
        stage,
        waitingOn: "us",
        title: "Publish the handover pack.",
        detail: "It is made and waiting under Money. The client cannot see it until you publish.",
        tab: "billing",
      };
    }
    const delivered = Date.parse(c.deliveredAt ?? "");
    const until = Number.isFinite(delivered)
      ? ` until ${new Date(delivered + 30 * DAY_MS).toISOString().slice(0, 10)}`
      : "";
    return {
      stage,
      waitingOn: "nobody",
      title: `Delivered. The 30-day warranty runs${until}.`,
      detail: "Fix any fault the client reports in that time at no charge. After it, the project closes by itself.",
    };
  }

  if (stage === "development") {
    if (!c.site) {
      return {
        stage,
        waitingOn: "us",
        title: "Build the website, then connect it here.",
        detail: "When the site is built, add it under Design & website. The client sees a holding page until you publish it.",
        tab: "design",
      };
    }
    if (c.site.status !== "published") {
      return {
        stage,
        waitingOn: "us",
        title: "Publish the finished website.",
        detail: "It is connected but the client still sees the holding page. Publish it when it is ready for them.",
        tab: "design",
      };
    }
    const due = payment(c, stage, "final", "70%", "The site is live, so the second and last payment is due.", now);
    if (due) return due;
    const receipt = find(c, "receipt", "final");
    return {
      stage,
      waitingOn: "us",
      title: receipt ? "Publish the receipt for the 70%." : "Make the receipt for the 70%.",
      detail: "Publishing it marks the project delivered and starts the 30-day warranty.",
      tab: "billing",
    };
  }

  if (stage === "accepted") {
    const designs = c.designs ?? [];
    if (designs.length === 0) {
      return {
        stage,
        waitingOn: "us",
        title: "Add design ideas for the client to choose from.",
        detail: "They have agreed the price. Up to three designs go on their page and they pick one.",
        tab: "design",
      };
    }
    if (!c.selectedDesign && !designs.some((d) => d.status === "published")) {
      return {
        stage,
        waitingOn: "us",
        title: "Publish the designs.",
        detail: "They are uploaded but the client cannot see them until you publish.",
        tab: "design",
      };
    }
    if (!c.selectedDesign) {
      return {
        stage,
        waitingOn: "client",
        title: "Waiting for the client to pick a design.",
        detail: "They choose on their own page. Remind them if it has been a few days.",
        tab: "design",
      };
    }
    const due = payment(
      c,
      stage,
      "progress",
      "30%",
      `They picked “${c.selectedDesign.title}”. The first payment is due now, and building starts once it is paid.`,
      now,
    );
    if (due) return due;
    return {
      stage,
      waitingOn: "us",
      title: "Start building the website.",
      detail: "The design is chosen and the first payment is in. Set the stage to Development when work begins.",
    };
  }

  if (stage === "quoted") {
    return {
      stage,
      waitingOn: "client",
      title: "Waiting for the client to accept the quotation.",
      detail: "They accept on their own page. Email the documents again if they have gone quiet.",
      tab: "documents",
    };
  }

  // Lead: nothing agreed yet.
  if (c.status === "answers_in") {
    return {
      stage,
      waitingOn: "nobody",
      title: "Their answers are in. The quotation, proposal and contract are being written.",
      detail: "This takes a few minutes. They appear under Documents as drafts for you to check.",
      tab: "documents",
    };
  }
  if (c.status === "drafts_ready") {
    return {
      stage,
      waitingOn: "us",
      title: "Check the quotation, proposal and contract, then publish them.",
      detail: "Read each one. Use Make changes to have a document rewritten. The client sees nothing until you publish.",
      tab: "documents",
    };
  }
  if (c.docs.estimate?.status === "draft") {
    return {
      stage,
      waitingOn: "us",
      title: "Check the estimate and send it.",
      detail: "It was written from your brief. The client cannot see it until you publish.",
      tab: "documents",
    };
  }
  return {
    stage,
    waitingOn: "client",
    title: "Waiting for the client to fill in the questions form.",
    detail: "Send them the link from Documents. The quotation is written from their answers.",
    tab: "documents",
  };
}
