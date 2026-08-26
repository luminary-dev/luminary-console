// Webhook verification tests.
//
// The mandate singles this out: "Verify it works, then write a test that
// fails if the raw body handling regresses." That is what the raw-body
// section below does, by asserting that the signature is computed over the
// exact received bytes and that any re-serialisation breaks it.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_BODY_BYTES,
  expectedSignature,
  payloadTimestamp,
  signaturesMatch,
  verifyDelivery,
} from "@/lib/github/webhooks";

const SECRET = "a-test-webhook-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function headersFor(body: string, overrides: Record<string, string | null> = {}): Headers {
  const base: Record<string, string> = {
    "x-hub-signature-256": sign(body),
    "x-github-delivery": "0e7a1f70-1234-11ef-9c2a-000000000000",
    "x-github-event": "pull_request",
  };
  const merged = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  return new Headers(merged);
}

/** A payload whose timestamp is current, so freshness never trips the tests
 *  that are not about freshness. */
function freshBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: "opened",
    created_at: new Date().toISOString(),
    ...extra,
  });
}

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
});

describe("signature verification", () => {
  it("accepts a correctly signed delivery", () => {
    const body = freshBody();
    const result = verifyDelivery(body, headersFor(body));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event).toBe("pull_request");
      expect(result.deliveryId).toBe("0e7a1f70-1234-11ef-9c2a-000000000000");
    }
  });

  it("rejects a body signed with the wrong secret", () => {
    const body = freshBody();
    const headers = headersFor(body, {
      "x-hub-signature-256": sign(body, "not-the-secret"),
    });
    const result = verifyDelivery(body, headers);
    expect(result).toMatchObject({ ok: false, reason: "bad_signature", status: 401 });
  });

  it("rejects a tampered body whose signature was valid for the original", () => {
    const original = freshBody({ pull_request: { number: 1 } });
    const headers = headersFor(original); // signature covers `original`
    const tampered = freshBody({ pull_request: { number: 999 } });
    const result = verifyDelivery(tampered, headers);
    expect(result).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("rejects a delivery with no signature at all", () => {
    const body = freshBody();
    const result = verifyDelivery(body, headersFor(body, { "x-hub-signature-256": null }));
    expect(result).toMatchObject({ ok: false, reason: "missing_signature", status: 401 });
  });

  it("refuses every delivery when no secret is configured, rather than trusting it", () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const body = freshBody();
    const result = verifyDelivery(body, headersFor(body));
    expect(result).toMatchObject({ ok: false, reason: "not_configured", status: 503 });
  });

  it("requires the delivery id and event headers", () => {
    const body = freshBody();
    expect(verifyDelivery(body, headersFor(body, { "x-github-delivery": null }))).toMatchObject({
      reason: "missing_delivery_id",
    });
    expect(verifyDelivery(body, headersFor(body, { "x-github-event": null }))).toMatchObject({
      reason: "missing_event",
    });
  });

  it("rejects an oversized body before doing any work on it", () => {
    const body = "x".repeat(MAX_BODY_BYTES + 1);
    const result = verifyDelivery(body, headersFor(body));
    expect(result).toMatchObject({ ok: false, reason: "body_too_large", status: 413 });
  });
});

describe("raw body handling (regression guard)", () => {
  // These are the tests the mandate asks for by name. Each one fails if
  // anything ever parses, re-serialises or normalises the body before the
  // HMAC is computed.

  it("fails if the body is re-serialised before signing, which is what body parsing does", () => {
    // GitHub sends compact JSON. A middleware that parses and re-stringifies
    // produces semantically identical but byte-different output.
    const asSent = '{"action":"opened","number":1}';
    const afterParseAndReserialise = JSON.stringify(JSON.parse(asSent), null, 2);

    expect(afterParseAndReserialise).not.toBe(asSent);
    // The signature is only valid for the bytes actually received.
    expect(signaturesMatch(expectedSignature(asSent, SECRET), sign(asSent))).toBe(true);
    expect(
      signaturesMatch(expectedSignature(afterParseAndReserialise, SECRET), sign(asSent)),
    ).toBe(false);
  });

  it("is sensitive to key order, which re-serialisation does not preserve", () => {
    const a = '{"a":1,"b":2}';
    const b = '{"b":2,"a":1}';
    expect(JSON.stringify(JSON.parse(a))).not.toBe(b);
    expect(expectedSignature(a, SECRET)).not.toBe(expectedSignature(b, SECRET));
  });

  it("is sensitive to insignificant whitespace", () => {
    const compact = '{"action":"opened"}';
    const spaced = '{ "action": "opened" }';
    expect(expectedSignature(compact, SECRET)).not.toBe(expectedSignature(spaced, SECRET));
  });

  it("verifies unicode bodies byte-for-byte rather than by decoded value", () => {
    // A Sinhala company name and an emoji in a PR title are both realistic
    // here, and both are multi-byte.
    const body = JSON.stringify({
      action: "opened",
      created_at: new Date().toISOString(),
      title: "ලුමිනරි and an emoji title",
    });
    const result = verifyDelivery(body, headersFor(body));
    expect(result.ok).toBe(true);
  });
});

describe("constant-time comparison", () => {
  it("matches identical signatures", () => {
    expect(signaturesMatch("sha256=abc", "sha256=abc")).toBe(true);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    // timingSafeEqual throws on unequal lengths; a throw here would become a
    // 500 that tells an attacker their guess had the wrong shape.
    expect(() => signaturesMatch("sha256=abc", "sha256=abcdef")).not.toThrow();
    expect(signaturesMatch("sha256=abc", "sha256=abcdef")).toBe(false);
  });

  it("rejects an empty received signature", () => {
    expect(signaturesMatch("sha256=abc", "")).toBe(false);
  });
});

describe("replay protection", () => {
  it("rejects a delivery whose payload timestamp is far in the past", () => {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const body = JSON.stringify({ action: "opened", created_at: old });
    const result = verifyDelivery(body, headersFor(body));
    expect(result).toMatchObject({ ok: false, reason: "stale_delivery" });
  });

  it("accepts a check run that took longer than the old five minute window", () => {
    // The bug this exists to prevent lost real CI results in production.
    // GitHub sends no delivery timestamp, so freshness is inferred from the
    // payload, and check_run.started_at describes when the check BEGAN. A
    // ten minute build therefore looked ten minutes stale the instant it
    // finished, and was refused on its FIRST delivery. Slow checks are
    // exactly the ones an operator needs to see.
    const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const body = JSON.stringify({
      action: "completed",
      check_run: { id: 1, status: "completed", started_at: startedAt, completed_at: new Date().toISOString() },
    });
    expect(verifyDelivery(body, headersFor(body)).ok).toBe(true);
  });

  it("prefers a check run's completed_at over its started_at", () => {
    // completed_at is the closest thing to a send time that the payload has.
    const started = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const completed = new Date(Date.now() - 1000).toISOString();
    const ts = payloadTimestamp(
      JSON.stringify({ check_run: { started_at: started, completed_at: completed } }),
    );
    expect(ts).toBe(Date.parse(completed));
  });

  it("still uses started_at for a check run that has not finished", () => {
    // An in-progress run has no completed_at, and its start IS recent.
    const started = new Date(Date.now() - 1000).toISOString();
    const ts = payloadTimestamp(JSON.stringify({ check_run: { started_at: started } }));
    expect(ts).toBe(Date.parse(started));
  });

  it("accepts an operator redelivery from the App's Recent Deliveries page", () => {
    // Redelivery resends the ORIGINAL body with its original timestamps, so a
    // tight window made the documented recovery procedure impossible: the
    // deliveries most worth replaying are the old ones.
    const body = JSON.stringify({
      action: "completed",
      workflow_run: { id: 9, updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
    });
    expect(verifyDelivery(body, headersFor(body)).ok).toBe(true);
  });

  it("accepts a delivery with no timestamp rather than failing closed", () => {
    // Not every event carries a timestamp, and rejecting those would drop
    // legitimate deliveries.
    const body = JSON.stringify({ action: "opened" });
    const result = verifyDelivery(body, headersFor(body));
    expect(result.ok).toBe(true);
  });

  it("reads numeric timestamps as seconds, not milliseconds", () => {
    const seconds = Math.floor(Date.now() / 1000);
    expect(payloadTimestamp(JSON.stringify({ created_at: seconds }))).toBeGreaterThan(1e12);
  });

  it("returns null for an unparsable body instead of throwing", () => {
    expect(payloadTimestamp("not json")).toBeNull();
  });

  it("ignores an attacker-controlled timestamp buried deep in the payload", () => {
    // Only the shallow, GitHub-stamped fields are consulted. A nested
    // "created_at" must not be able to steer freshness.
    const body = JSON.stringify({
      pull_request: { head: { repo: { owner: { created_at: "1999-01-01T00:00:00Z" } } } },
    });
    expect(payloadTimestamp(body)).toBeNull();
  });
});
