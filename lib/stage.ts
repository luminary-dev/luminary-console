// Client lifecycle stage. Stored on the record (client.stage) and
// auto-advanced by pipeline events — publish quotation → "quoted", portal
// acceptance → "accepted", payment recorded → "development", final receipt
// published → "delivered" — plus a time-based drift after delivery:
// "delivered" (day of delivery) → "warranty" (30 days from deliveredAt) →
// "closed". Manual override via POST /api/clients/[slug]/stage; auto-advance
// only ever moves FORWARD, so an operator override is never undone by a
// later pipeline event of a lower rank.
import type { ClientRecord, ClientStage } from "./types";

export const STAGES: ClientStage[] = [
  "lead",
  "quoted",
  "accepted",
  "development",
  "delivered",
  "warranty",
  "closed",
];

export const STAGE_LABELS: Record<ClientStage, string> = {
  lead: "Lead",
  quoted: "Quoted",
  accepted: "Accepted",
  development: "Development",
  delivered: "Delivered",
  warranty: "Warranty",
  closed: "Closed",
};

export const stageRank = (s: ClientStage): number => STAGES.indexOf(s);

/** Records that predate the stage field derive one from what already happened. */
function inferStage(c: ClientRecord): ClientStage {
  if (c.billing?.some((b) => b.kind === "receipt" && b.stage === "final" && b.status === "published")) {
    return "delivered";
  }
  if (c.payments?.length) return "development";
  if (c.acceptance) return "accepted";
  if (c.docs.quotation?.status === "published") return "quoted";
  return "lead";
}

/** When delivery happened, for the warranty clock: explicit deliveredAt,
 *  falling back to the published final receipt's timestamp (legacy records). */
function deliveredMs(c: ClientRecord): number {
  const t = Date.parse(c.deliveredAt ?? "");
  if (Number.isFinite(t)) return t;
  const rcp = c.billing?.find((b) => b.kind === "receipt" && b.stage === "final" && b.status === "published");
  return Date.parse(rcp?.updatedAt ?? "");
}

/** Effective stage right now: the stored (or inferred) stage plus the
 *  time-based post-delivery drift. Pure read — never writes the record. */
export function currentStage(c: ClientRecord): ClientStage {
  let s = c.stage ?? inferStage(c);
  if (s === "delivered" || s === "warranty") {
    const t = deliveredMs(c);
    if (Number.isFinite(t)) {
      const days = (Date.now() - t) / 86_400_000;
      if (days > 30) s = "closed";
      else if (days >= 1) s = "warranty";
    }
  }
  return s;
}

/** Auto-advance from a pipeline event. Only moves forward (never demotes a
 *  manual override); returns whether the stage actually changed. */
export function advanceStage(c: ClientRecord, to: ClientStage): boolean {
  if (stageRank(to) <= stageRank(currentStage(c))) return false;
  c.stage = to;
  if (to === "delivered" && !c.deliveredAt) c.deliveredAt = new Date().toISOString();
  return true;
}
