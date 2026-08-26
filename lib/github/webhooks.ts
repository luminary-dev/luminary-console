// Webhook signature verification.
//
// This is the single most commonly broken thing in a webhook integration, for
// one reason: the signature covers the RAW REQUEST BODY, byte for byte, and
// any middleware that parses the body first (or re-serialises it, or
// normalises its encoding) invalidates the signature. In this codebase the
// rule is enforced structurally: `verifyDelivery` takes a string that the
// route obtained from `await request.text()` BEFORE any JSON.parse, and the
// route never parses first. tests/github-webhooks.test.ts fails if that ever
// regresses.
//
// Three defences, all required:
//   1. HMAC-SHA256 over the raw body, compared in constant time.
//   2. A freshness window, so a captured body cannot be replayed forever.
//   3. Delivery-id dedup, so a redelivery (GitHub retries) cannot double-apply.
//      Processing is idempotent on top of this, because dedup alone is a
//      best-effort defence and out-of-order arrival still has to be correct.
import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_MAX_AGE_MS, webhookSecret } from "./config";

export type VerifyResult =
  | { ok: true; deliveryId: string; event: string }
  | { ok: false; reason: VerifyFailure; status: number };

export type VerifyFailure =
  | "not_configured"
  | "missing_signature"
  | "missing_delivery_id"
  | "missing_event"
  | "bad_signature"
  | "stale_delivery"
  | "body_too_large";

/** GitHub caps payloads at 25MB; anything beyond that is not ours. Bounding
 *  it here keeps a hostile body from becoming a memory problem before we have
 *  even authenticated it. */
export const MAX_BODY_BYTES = 26 * 1024 * 1024;

/** Constant-time compare of two hex signatures. Length is compared first
 *  because timingSafeEqual throws on a length mismatch, and a thrown
 *  comparison is a leak of a different kind: it turns into a 500 that tells
 *  an attacker their guess had the wrong shape. */
export function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The signature GitHub should have sent for this body. */
export function expectedSignature(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/**
 * Verify one delivery.
 *
 * `rawBody` MUST be the exact bytes GitHub sent. Do not parse, re-encode or
 * pretty-print it before calling this.
 */
export function verifyDelivery(rawBody: string, headers: Headers): VerifyResult {
  const secret = webhookSecret();
  if (!secret) {
    // Refusing beats trusting: an unverifiable delivery is indistinguishable
    // from a forged one, and this endpoint is public.
    return { ok: false, reason: "not_configured", status: 503 };
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, reason: "body_too_large", status: 413 };
  }

  const signature = headers.get("x-hub-signature-256");
  if (!signature) return { ok: false, reason: "missing_signature", status: 401 };

  const deliveryId = headers.get("x-github-delivery");
  if (!deliveryId) return { ok: false, reason: "missing_delivery_id", status: 400 };

  const event = headers.get("x-github-event");
  if (!event) return { ok: false, reason: "missing_event", status: 400 };

  if (!signaturesMatch(expectedSignature(rawBody, secret), signature)) {
    return { ok: false, reason: "bad_signature", status: 401 };
  }

  // Replay window. GitHub does not sign a timestamp, so the best available
  // clock is the payload's own. Not every event carries one, and a missing
  // timestamp must not reject a legitimate delivery, so this only rejects
  // when we can positively establish the delivery is old.
  const sentAt = payloadTimestamp(rawBody);
  if (sentAt !== null && Date.now() - sentAt > WEBHOOK_MAX_AGE_MS) {
    return { ok: false, reason: "stale_delivery", status: 400 };
  }

  return { ok: true, deliveryId, event };
}

/**
 * Best-effort send time from the payload.
 *
 * Deliberately a shallow scan of the few fields GitHub actually stamps, not a
 * deep search: a hostile body must not be able to steer us to an attacker
 * controlled "timestamp" buried somewhere in the tree. Returns null when we
 * cannot establish a time, which means the freshness check is skipped rather
 * than failing closed on an unparsable body.
 */
export function payloadTimestamp(rawBody: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const body = parsed as Record<string, unknown>;

  // `repository.pushed_at` is a number on push events and a string elsewhere;
  // workflow/check events stamp their own objects.
  const checkRun = body.check_run as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    (body.workflow_run as Record<string, unknown> | undefined)?.updated_at,
    // completed_at BEFORE started_at. A completed check reports when it began,
    // which for a slow build is far in the past and says nothing about when
    // this delivery was sent. Reading started_at first is what made every
    // check longer than the window look like a replay.
    checkRun?.completed_at ?? checkRun?.started_at,
    (body.check_suite as Record<string, unknown> | undefined)?.updated_at,
    (body.pull_request as Record<string, unknown> | undefined)?.updated_at,
    (body.comment as Record<string, unknown> | undefined)?.updated_at,
    (body.issue as Record<string, unknown> | undefined)?.updated_at,
    body.created_at,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      // Seconds vs milliseconds: GitHub sends seconds in the numeric form.
      return candidate > 1e11 ? candidate : candidate * 1000;
    }
    if (typeof candidate === "string") {
      const ms = Date.parse(candidate);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return null;
}
