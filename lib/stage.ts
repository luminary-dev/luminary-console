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

/** The one fact outside `deliveredAt` that establishes delivery: a published
 *  final receipt. Kept as a named predicate because both the warranty clock
 *  and the un-delivery path below ask the same question. */
function hasDeliveryEvidence(c: ClientRecord): boolean {
  return (c.billing ?? []).some(
    (b) => b.kind === "receipt" && b.stage === "final" && b.status === "published",
  );
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

/** Auto-advance from a pipeline event. Never demotes (skips when the current
 *  stage is already beyond the target) but DOES persist on equal rank: the
 *  triggering fact (published quotation, acceptance, payment) is usually
 *  written to the record before this runs, so inference already matches the
 *  target — writing it anyway pins the stage field (and deliveredAt) instead
 *  of leaving them forever implicit. Returns whether the field changed. */
export function advanceStage(c: ClientRecord, to: ClientStage): boolean {
  if (stageRank(to) < stageRank(currentStage(c))) return false;
  const changed = c.stage !== to;
  c.stage = to;
  if (to === "delivered" && !c.deliveredAt) c.deliveredAt = new Date().toISOString();
  return changed;
}

/** The reverse of the one auto-advance that can be undone: unpublishing the
 *  final receipt. Publishing it stamps `deliveredAt`; leaving that stamp
 *  behind on unpublish kept a 30-day warranty commitment alive and let
 *  currentStage() keep drifting delivered, warranty, closed off a delivery
 *  that no longer exists (LC-025).
 *
 *  Call it AFTER the receipt's status has been set back to "draft", so the
 *  evidence check sees the new state. Does nothing while another published
 *  final receipt still establishes delivery. "closed" is left alone: it is
 *  also how a lead is closed out unwon, so it is never inferred away.
 *  Returns whether the record changed. */
export function revertDelivery(c: ClientRecord): boolean {
  if (hasDeliveryEvidence(c)) return false;
  let changed = false;
  if (c.deliveredAt) {
    delete c.deliveredAt;
    changed = true;
  }
  if (c.stage === "delivered" || c.stage === "warranty") {
    const back = inferStage(c);
    if (c.stage !== back) {
      c.stage = back;
      changed = true;
    }
  }
  return changed;
}
