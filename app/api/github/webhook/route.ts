// GitHub webhook receiver.
//
// The contract, from the mandate: verify the signature over the RAW body,
// respond 200 within 2 seconds no matter what, and never do work inline.
//
// Every line here serves that contract:
//   - `await req.text()` happens FIRST and nothing parses before verification.
//     This is the single most commonly broken thing in webhook integrations:
//     any body-parsing step before the HMAC invalidates it. There is a
//     regression test that fails if this order ever changes.
//   - persistence is one write to the delivery's own key, so a burst of
//     deliveries cannot race each other.
//   - processing is scheduled AFTER the response via after(), and a failure
//     to schedule is not allowed to fail the receipt, because GitHub will
//     disable a webhook that keeps erroring and a delivery we already stored
//     is not lost, only late.
//
// Auth note: this endpoint is PUBLIC by necessity, so the proxy's session
// gate must let it through and the HMAC is the only thing standing between
// the internet and this handler. It is checked before anything else touches
// the payload.
import { NextResponse, after } from "next/server";
import { verifyDelivery } from "@/lib/github/webhooks";
import { recordDelivery, isValidDeliveryId } from "@/lib/github/inbox";
import { processDelivery } from "@/lib/github/processor";

export const runtime = "nodejs";
// The receive path must be fast. Processing runs after the response, and the
// cron sweep is what guarantees a delivery is eventually handled.
export const maxDuration = 60;

export async function POST(req: Request) {
  // 1. RAW body, before any parsing. Do not move this.
  const rawBody = await req.text();

  // 2. Verify. An unverified body is untrusted input and is not parsed,
  //    stored, or logged beyond its length.
  const verified = verifyDelivery(rawBody, req.headers);
  if (!verified.ok) {
    // Deliberately terse: an attacker probing this endpoint learns only that
    // it refused, not which check failed.
    console.warn(
      `[github] rejected delivery: ${verified.reason} (${rawBody.length} bytes)`,
    );
    return NextResponse.json({ error: "Rejected." }, { status: verified.status });
  }

  const { deliveryId, event } = verified;
  if (!isValidDeliveryId(deliveryId)) {
    return NextResponse.json({ error: "Rejected." }, { status: 400 });
  }

  // 3. Parse only now that the signature proves GitHub sent this.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const action = (payload as { action?: unknown })?.action;
  const repo = (payload as { repository?: { full_name?: unknown } })?.repository?.full_name;

  // 4. Persist and acknowledge. Storage failure is the ONE case where a
  //    non-200 is right: we have not durably taken responsibility for the
  //    delivery, so GitHub should retry it.
  try {
    const { duplicate } = await recordDelivery({
      deliveryId,
      event,
      ...(typeof action === "string" ? { action } : {}),
      ...(typeof repo === "string" ? { repo } : {}),
      payload,
    });

    if (duplicate) {
      // A redelivery of something we already hold. Acknowledged without being
      // queued again: GitHub retries with the same delivery id, and handlers
      // are idempotent anyway, so this is belt and braces.
      return NextResponse.json({ ok: true, duplicate: true });
    }
  } catch (e) {
    console.error("[github] could not store delivery:", e);
    return NextResponse.json({ error: "Could not store the delivery." }, { status: 503 });
  }

  // 5. Schedule processing after the response is sent. A scheduling failure
  //    must not turn a stored delivery into a 500: the cron sweep picks up
  //    anything still pending.
  try {
    after(async () => {
      try {
        await processDelivery(deliveryId);
      } catch (e) {
        console.error(`[github] processing ${deliveryId} failed:`, e);
      }
    });
  } catch {
    // No request scope (the ops runner or a test invoking the handler
    // directly). The delivery is stored and pending; the sweep will get it.
  }

  return NextResponse.json({ ok: true });
}

/** A GET here is almost always a human checking the URL is live. Answer
 *  something useful without revealing configuration. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "github-webhook" });
}
