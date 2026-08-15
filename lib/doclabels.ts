// Resolving a portal document key ("quotation", "invoice-1", "questionnaire")
// to the label and number a human recognises. Shared by the public comment
// endpoint and the console cards that render what clients referred to, so
// the two can never drift apart.
import { BILLING_LABELS, DOC_LABELS, type BillingDoc, type ClientRecord, type DocType } from "./types";

export const billingStageLabel = (s: string) =>
  s === "advance"
    ? "Advance "
    : s === "progress"
      ? "Progress "
      : s === "final"
        ? "Final "
        : "Additional ";

/** Human name for one entry of `client.billing`, e.g. "Final invoice" or
 *  "Handover pack". The stage prefix only makes sense for money documents —
 *  there is no "additional handover pack" — so handovers carry their label
 *  alone. Every surface that names a billing document goes through this. */
export function billingLabel(b: Pick<BillingDoc, "kind" | "stage">): string {
  if (b.kind === "handover") return BILLING_LABELS.handover;
  return `${billingStageLabel(b.stage)}${BILLING_LABELS[b.kind]}`;
}

export type ResolvedDoc = { label: string; no: string; published: boolean };

/** Null when the key doesn't name anything on this client's record. */
export function resolveDoc(client: ClientRecord, key: string): ResolvedDoc | null {
  if (key === "questionnaire") {
    // Always live for the client — there is nothing to publish.
    return { label: "Project questionnaire", no: `LUM-QST-${client.docNoBase}`, published: true };
  }
  const core = client.docs[key as DocType];
  if (core) {
    return { label: DOC_LABELS[core.type], no: core.no, published: core.status === "published" };
  }
  const b = (client.billing ?? []).find((x) => x.slug === key);
  if (b) {
    return { label: billingLabel(b), no: b.no, published: b.status === "published" };
  }
  return null;
}
