// GitHub rate limit accounting.
//
// GitHub has TWO limits with different semantics, and treating them the same
// is the classic integration bug:
//
//   PRIMARY   x-ratelimit-remaining hits 0. Deterministic, and the response
//             tells you exactly when it resets (x-ratelimit-reset, a UNIX
//             second). The correct response is to wait until the reset.
//   SECONDARY An abuse/concurrency guard. It does NOT decrement the primary
//             counter and does NOT reveal a reset time in the same way; it
//             answers 403 (sometimes 429) with a "secondary rate limit"
//             message and usually a Retry-After. The correct response is an
//             exponential backoff with jitter, and to reduce concurrency,
//             because retrying at the same rate re-trips it immediately.
//
// A third case bites in practice: x-ratelimit-reset can be in the PAST, from
// clock skew or a cached response. Waiting for a past deadline means waiting
// zero, hammering the API. We clamp it.

export type RateLimitSnapshot = {
  limit: number | null;
  remaining: number | null;
  /** Epoch ms. */
  resetAt: number | null;
  /** Which bucket the response was accounted against (core, search, graphql). */
  resource: string | null;
  observedAt: number;
};

let latest: RateLimitSnapshot | null = null;

const num = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Record what a response told us about our budget. */
export function recordRateLimit(headers: Headers): RateLimitSnapshot {
  const resetSeconds = num(headers.get("x-ratelimit-reset"));
  const snapshot: RateLimitSnapshot = {
    limit: num(headers.get("x-ratelimit-limit")),
    remaining: num(headers.get("x-ratelimit-remaining")),
    resetAt: resetSeconds === null ? null : resetSeconds * 1000,
    resource: headers.get("x-ratelimit-resource"),
    observedAt: Date.now(),
  };
  // Only advance the snapshot: a 304 or a response from another resource
  // bucket should not overwrite a fresher core reading with staler numbers.
  if (!latest || snapshot.observedAt >= latest.observedAt) latest = snapshot;
  return snapshot;
}

/** The last observed budget, for the UI's rate limit indicator. */
export const currentRateLimit = (): RateLimitSnapshot | null => latest;

/** Reset the module cache. Test seam. */
export const __resetRateLimit = (): void => {
  latest = null;
};

export type LimitKind = "primary" | "secondary" | null;

/** Classify a failing response. Reads the parsed body message where present,
 *  because a secondary limit is a 403 that looks exactly like a permissions
 *  403 until you read the message. */
export function classifyLimit(status: number, headers: Headers, bodyMessage?: string): LimitKind {
  const message = (bodyMessage ?? "").toLowerCase();
  if (message.includes("secondary rate limit") || message.includes("abuse detection")) {
    return "secondary";
  }
  const remaining = num(headers.get("x-ratelimit-remaining"));
  if ((status === 403 || status === 429) && remaining === 0) return "primary";
  // A 429 with budget left is a secondary limit by elimination.
  if (status === 429) return "secondary";
  return null;
}

/** Milliseconds to wait before retrying, given the limit kind and attempt. */
export function backoffMs(kind: LimitKind, attempt: number, headers: Headers): number {
  const retryAfter = num(headers.get("retry-after"));
  if (retryAfter !== null) {
    // Retry-After is authoritative when GitHub sends it, in seconds.
    return Math.min(retryAfter * 1000, MAX_WAIT_MS);
  }
  if (kind === "primary") {
    const resetSeconds = num(headers.get("x-ratelimit-reset"));
    if (resetSeconds !== null) {
      const waitFor = resetSeconds * 1000 - Date.now();
      // A reset in the past (clock skew, cached response) must not mean "retry
      // instantly" — that is how a rate limit becomes a hot loop.
      return Math.min(Math.max(waitFor, MIN_WAIT_MS), MAX_WAIT_MS);
    }
  }
  // Secondary limits and anything unlabelled: exponential with full jitter.
  const ceiling = Math.min(BASE_WAIT_MS * 2 ** attempt, MAX_WAIT_MS);
  return Math.max(MIN_WAIT_MS, Math.floor(Math.random() * ceiling));
}

const MIN_WAIT_MS = 1_000;
const BASE_WAIT_MS = 1_000;
/** Never block a request for longer than this; past it, fail and let the
 *  caller degrade rather than holding a serverless function open. */
export const MAX_WAIT_MS = 60_000;
