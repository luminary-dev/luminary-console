// Fixed-window rate limiter for the public routes (questionnaire submit,
// uploads, quotation accept, login) — and reusable for future public
// endpoints (e.g. a portal "comment" bucket).
//
// LC-013: counters used to live ONLY in a module-scope Map, i.e. per function
// instance, so the real ceiling an attacker saw was `max × instances` and a
// cold start reset it. That is now fixed for the buckets where it matters,
// and deliberately NOT fixed for the ones where it does not:
//
//   - SHARED (store-backed, global): the buckets that guard a credential.
//     `auth` covers both the login (app/api/auth) and the client-deletion
//     password re-check (app/api/clients/[slug]), which is the one
//     irreversible endpoint in the product. A guessing budget that scales
//     with autoscaling is not a guessing budget.
//   - IN-MEMORY (per instance, as before): the per-IP web-form buckets.
//     `upload` fires once per file a client attaches; paying a store
//     round trip on every one of those, to tighten a limit whose job is to
//     stop a careless script rather than an attacker, is a bad trade. Same
//     reasoning for submit/accept/comment/assist, all of which sit behind a
//     honeypot and a session or a portal link already.
//
// The choice is a table (SHARED below), not a judgement call at the call site.
import { NextResponse } from "next/server";

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export const WINDOW_MS = 10 * 60 * 1000; // one shared 10-minute window size

/** Per-bucket ceilings per IP per 10 minutes. Future buckets just add a line
 *  here and call `rateLimit`. */
export const LIMITS = {
  submit: 5,
  upload: 30,
  accept: 5,
  auth: 10,
  comment: 10, // portal doc comment box
  // Operator-only and already behind the session gate, so this is a cost
  // guard rather than an abuse guard: each call is a full-context model
  // request, and a stuck retry loop in the browser shouldn't be able to run
  // up the bill unattended.
  assist: 20,
} as const;

export type Bucket = keyof typeof LIMITS;

/** Which buckets count in the shared store instead of (only) in this
 *  instance's memory. See the header for why each one is where it is.
 *  Written out per bucket rather than as a list so adding a bucket forces an
 *  explicit answer to "does this one need to be global?". */
export const SHARED: Record<Bucket, boolean> = {
  submit: false,
  upload: false,
  accept: false,
  auth: true,
  comment: false,
  assist: false,
};

/** First hop of x-forwarded-for = the real client IP on Vercel. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0]?.trim() || "unknown";
}

/** The 429 every bucket returns: a friendly `error` string, because every
 *  public form in this app surfaces `error` from a non-ok JSON body. */
function tooMany(resetAt: number, now: number): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000));
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60));
  return NextResponse.json(
    {
      error: `Too many requests from your connection — please wait about ${mins} minute${mins > 1 ? "s" : ""} and try again.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

/**
 * Count this request against `ip|bucket` IN THIS INSTANCE. Returns `null` when
 * allowed, or a ready-to-return 429.
 *
 * Synchronous, and staying that way: ~10 call sites depend on
 * `const limited = rateLimit(req, b); if (limited) return limited;`, and a
 * promise is always truthy, so quietly turning this async would turn every
 * unconverted call site into an unconditional 429. Shared buckets are reached
 * through `rateLimitShared` instead, which awaits this first.
 */
export function rateLimit(req: Request, bucket: Bucket): NextResponse | null {
  const key = `${clientIp(req)}|${bucket}`;
  const now = Date.now();

  // Opportunistic sweep so the Map can't grow unbounded over a long-lived
  // instance (entries are tiny; 4096 is far above legitimate traffic).
  if (windows.size > 4096) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }

  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  w.count += 1;
  if (w.count <= LIMITS[bucket]) return null;

  return tooMany(w.resetAt, now);
}

/** The IP is hashed into the key rather than written in clear: these objects
 *  live in the same bucket as the client records, and an enumerable list of
 *  "every IP that has tried to sign in" is PII we have no reason to keep.
 *  Truncated to 128 bits, which is far past any collision concern for a key
 *  space of at most a few thousand addresses. Web Crypto (not node:crypto) so
 *  this module stays runtime-agnostic like lib/auth.ts. */
async function ipHash(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Count this request against a GLOBAL window when `bucket` is shared, and
 * against this instance's memory either way.
 *
 * FAILURE MODE (deliberate): if the store read/write fails, this FAILS OPEN to
 * the in-memory limiter, i.e. it degrades to exactly the pre-LC-013 behaviour
 * (per-instance counting) rather than refusing the request. This is the same
 * trade proxy.ts documents for the session allowlist, and for the same reason:
 * an R2 hiccup must not become "nobody can sign in to the console, including
 * the person who would fix R2". The limiter is an abuse control, not an
 * authorisation control — the password, the OTP and the 800ms delay are still
 * in front of the login during the outage, and the window of degradation is
 * the length of the outage.
 *
 * The in-memory check runs FIRST, so an instance that is already over its own
 * limit answers 429 without a store round trip at all.
 */
export async function rateLimitShared(req: Request, bucket: Bucket): Promise<NextResponse | null> {
  const local = rateLimit(req, bucket);
  if (local) return local;
  if (!SHARED[bucket]) return null;

  const ip = clientIp(req);
  // Without a client IP every caller would share one global counter, and a
  // shared counter on the `auth` bucket is a denial-of-service on the login
  // for everyone. Per-instance counting is the safe answer here.
  if (ip === "unknown") return null;

  try {
    // Lazily imported: the store pulls in the S3 SDK, and the in-memory path
    // above answers most requests without ever needing it.
    const { updateState } = await import("./store");
    const now = Date.now();
    const w = await updateState<Window>(
      `ratelimit/${bucket}/${await ipHash(ip)}.json`,
      // Pure function of `current`: updateState re-runs it on every CAS retry.
      // One object per IP per bucket, reused across windows (rather than one
      // per window), so the key space is bounded by distinct addresses.
      (current) =>
        !current || current.resetAt <= now
          ? { count: 1, resetAt: now + WINDOW_MS }
          : { count: current.count + 1, resetAt: current.resetAt },
      // Short retry budget: a rate limiter that spends seconds resolving a
      // write race has become the thing it was protecting against.
      { attempts: 3, cache: false },
    );
    if (w.count <= LIMITS[bucket]) return null;
    return tooMany(w.resetAt, now);
  } catch {
    return null; // fail open to the in-memory count, see above
  }
}
