// Origin/Referer check for cookie-authenticated mutations (LC-014).
//
// The console's session cookie is `SameSite=Lax` and host-scoped, which
// already blocks the classic cross-site form POST, so this is defence in
// depth rather than the only control. It exists because "Lax" is the whole
// defence today: broaden the cookie to the parent domain, or compromise one
// client subdomain, and there is nothing else standing.
//
// It is an ORIGIN check and not a double-submit token by choice. A token
// would have to be minted into every one of the console's ~40 fetch call
// sites and into the portal's server-rendered forms; the origin check is one
// place, has no state, and stops the same attack. If a same-site subdomain is
// ever genuinely hostile, a token is the next step.
//
// WHAT MUST NOT BE BLOCKED, and why each one is safe here:
//   - /api/github/webhook — GitHub sends no Origin and no cookie. Guarded by
//     an HMAC over the raw body.
//   - /api/cron/* and /api/github/process — Vercel Cron sends a bearer token,
//     no Origin and no cookie. Guarded by a constant-time bearer compare.
//   - the public client-portal routes under /c/<slug>/… — posted from a
//     client subdomain and not cookie-authenticated at all.
// The first two are covered by the "no Origin, no Referer, so not a browser
// cross-site request" rule below, and by proxy.ts only ever running this
// check on a request that carried a valid session cookie. The third is
// covered by both that and by the client-subdomain allowance here.

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Methods that change state and therefore need the check. */
export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

// Derived the same way proxy.ts derives them, so the two can never disagree
// about which hosts are ours. Read at call time (not module load) because the
// test suite and `next dev` both set them after import.
function rootDomain(): string {
  return (process.env.ROOT_DOMAIN || "luminary-dev.xyz").toLowerCase();
}
function consoleHost(): string {
  return (process.env.CONSOLE_HOST || `console.${rootDomain()}`).toLowerCase();
}

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * Is `value` (an Origin, or a Referer to take the origin from) one of ours?
 *
 * `requestHost` is the raw Host header INCLUDING any port. Matching it first
 * is what makes this work on the *.vercel.app project URL and on preview
 * deployments without listing them: a request whose Origin equals the host it
 * was sent to is same-origin by definition, which is precisely the thing CSRF
 * is not.
 */
export function isTrustedOrigin(value: string, requestHost: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // includes the literal "null" opaque origin
  }
  const dev = process.env.NODE_ENV === "development";
  if (url.protocol !== "https:" && !dev) return false;

  const host = url.host.toLowerCase();
  if (requestHost && host === requestHost.toLowerCase()) return true;

  const root = rootDomain();
  // The console, the apex, and every client subdomain: one site, several
  // hosts, all served by this deployment.
  if (host === consoleHost() || host === root || host.endsWith(`.${root}`)) return true;

  return dev && LOCAL_HOST.test(host);
}

/** Just enough of a request for the check; keeps this testable without
 *  constructing a NextRequest. */
type RequestLike = { method: string; headers: { get(name: string): string | null } };

/**
 * `null` when the request may proceed, or a short reason when it must be
 * refused. The reason is for the log line, never for the response body.
 *
 * The rules, in order:
 *  1. Non-mutating methods are never refused.
 *  2. An Origin header must be one of ours. Browsers send it on every
 *     cross-origin request and on same-origin fetch/XHR, so this is the case
 *     that actually fires.
 *  3. `Origin: null` (a sandboxed iframe, a data: URL, some redirect chains)
 *     is refused outright. The design-preview iframes this app now serves are
 *     sandboxed and therefore opaque-origin, so this rule is load-bearing:
 *     an uploaded design must not be able to POST to the console API with the
 *     operator's cookie.
 *  4. No Origin: fall back to Referer if there is one.
 *  5. Neither header: allow. A browser always sends at least one on a
 *     cross-site POST, so "neither" means a server-to-server client (the
 *     GitHub webhook, Vercel Cron, curl) — which has no ambient cookie to
 *     abuse and is therefore not a CSRF vector at all. Refusing here would
 *     break exactly the callers listed at the top of this file.
 */
export function csrfViolation(req: RequestLike, requestHost: string): string | null {
  if (!isMutating(req.method)) return null;

  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === "null") return "opaque origin";
    return isTrustedOrigin(origin, requestHost) ? null : `cross-origin request from ${origin}`;
  }

  const referer = req.headers.get("referer");
  if (referer) {
    return isTrustedOrigin(referer, requestHost) ? null : `cross-origin referer ${referer}`;
  }

  return null;
}
