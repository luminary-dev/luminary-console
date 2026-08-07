// Fixed-window rate limiter for the public routes (questionnaire submit,
// uploads, quotation accept, login) — and reusable for future public
// endpoints (e.g. a portal "comment" bucket).
//
// LIMITATION (deliberate, documented): the counters live in a module-scope
// Map, so they are PER FUNCTION INSTANCE. Vercel may run several instances
// concurrently, and a cold start resets the counts — so the real ceiling an
// attacker sees is `max × instances`. That's fine for this console's threat
// model (stop naive abuse/scripts, protect the object store and email quota);
// a shared store (Upstash/KV) can replace the Map later without changing
// call sites.
import { NextResponse } from "next/server";

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export const WINDOW_MS = 10 * 60 * 1000; // one shared 10-minute window size

/** Per-bucket ceilings per IP per 10 minutes. Future buckets (e.g. "comment"
 *  for portal doc comments) just add a line here and call `rateLimit`. */
export const LIMITS = {
  submit: 5,
  upload: 30,
  accept: 5,
  auth: 10,
  comment: 10, // reserved for the Wave 4 portal comment box
} as const;

export type Bucket = keyof typeof LIMITS;

/** First hop of x-forwarded-for = the real client IP on Vercel. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

/**
 * Count this request against `ip|bucket`. Returns `null` when allowed, or a
 * ready-to-return 429 JSON response (friendly `error` string — every public
 * form in this app surfaces `error` from a non-ok JSON body).
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

  const retryAfterSec = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60));
  return NextResponse.json(
    {
      error: `Too many requests from your connection — please wait about ${mins} minute${mins > 1 ? "s" : ""} and try again.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
