// Host-based routing + console auth gate.
//
// - Client sites:  <slug>.luminary-dev.xyz/*  →  rewritten to /c/<slug>/*
//   (public: questionnaire, published docs, PDFs)
// - Console:       console host (or the *.vercel.app project URL) — every
//   path except /login and /api/auth requires the signed session cookie.
//
// It is also the single place every HTML response gets its security headers,
// including the per-request CSP nonce. See lib/csp.ts.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_ABS_MAX_AGE, SESSION_COOKIE, SESSION_MAX_AGE, makeSessionToken, verifySessionToken } from "@/lib/auth";
import { cspFor, newNonce, securityHeaders, type Surface } from "@/lib/csp";
import { csrfViolation } from "@/lib/csrf";
import { logger } from "@/lib/logger";

// Session allowlist cache: one store read per instance per minute instead of
// per request. lib/sessions.liveSids() returns every sid that is registered,
// unrevoked, inside the absolute cap and still owned by an allowlisted
// operator, so a sid missing from it is a sid that must not authenticate
// anything (LC-010, GAP-3.5a).
//
// FAILURE MODE (deliberate, unchanged in spirit from the revoked-list cache
// this replaces): when the store read throws, `sids` is null and the gate
// FAILS OPEN, accepting any signature-valid unexpired token. An allowlist
// that fails closed would turn an R2 hiccup into "every operator is locked
// out of the console until storage comes back", which is a worse outcome
// than a stolen cookie surviving the outage: the token is still HMAC-signed
// with SESSION_SECRET, still expires, and the window is the length of the
// outage. Signature verification is never skipped.
//
// STALENESS, and why a miss is not simply a rejection: with a denylist a
// stale cache only delayed a revocation, but with an allowlist it would also
// reject a session created after the snapshot was taken, i.e. every operator
// would bounce back to /login for up to 60s after signing in. So a miss is
// re-checked against the store when, and only when, the token was ISSUED
// after the snapshot was loaded. That timestamp comes out of the signed
// token, so a replayed old cookie cannot use this path to hammer the store.
//
// lib/sessions is imported lazily because it reaches the S3 SDK through the
// store: the proxy runs on EVERY request, and there is no reason to load a
// storage client on the ~59 seconds in 60 that this answers from cache, or
// on client-host requests, which never consult it at all.
const GATE_TTL_MS = 60_000;
let gate: { at: number; sids: Set<string> | null } = { at: 0, sids: null };
let gateLoad: Promise<void> | null = null;

function loadGate(): Promise<void> {
  // Concurrent misses share one store read rather than each firing their own.
  gateLoad ??= (async () => {
    try {
      const { liveSids } = await import("@/lib/sessions");
      gate = { at: Date.now(), sids: new Set(await liveSids()) };
    } catch {
      gate = { at: Date.now(), sids: null }; // fail open, see above
    } finally {
      gateLoad = null;
    }
  })();
  return gateLoad;
}

async function sidAllowed(sid: string, absExp: number): Promise<boolean> {
  if (Date.now() - gate.at > GATE_TTL_MS) await loadGate();
  if (gate.sids === null) return true;
  if (gate.sids.has(sid)) return true;
  // absExp never moves, so this is the login's own creation time.
  const issuedAt = absExp - SESSION_ABS_MAX_AGE * 1000;
  if (issuedAt <= gate.at) return false;
  await loadGate();
  return gate.sids === null || gate.sids.has(sid);
}

// Standard hardening. `surface` picks the CSP: see lib/csp.ts for why the
// generated client documents cannot take the strict one.
export function harden(
  res: NextResponse,
  surface: Surface,
  nonce: string | null = null,
  noStore = false,
): NextResponse {
  for (const [k, v] of Object.entries(securityHeaders(surface, nonce))) res.headers.set(k, v);
  if (noStore) res.headers.set("Cache-Control", "no-store"); // back/hard-reload never shows stale authed pages
  return res;
}

// Next reads the nonce back out of the REQUEST's CSP header to stamp it on
// the framework's own script tags; app/layout.tsx reads x-nonce for the
// pre-paint theme script. Both have to be set on the request, not just the
// response.
function nonceRequest(request: NextRequest, nonce: string): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", cspFor("console", nonce));
  return headers;
}

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;

// Portal "last visit" stamp — the portal page compares each published
// document's updatedAt against it to decide what gets a "New" badge. It is
// written here rather than in the page because a Server Component can read
// cookies but not set them, and doing it client-side would need JS for a
// badge that is otherwise pure server markup. Per-slug, so console-side
// previews of several clients don't overwrite each other.
//
// The PREVIOUS value travels to the page in a request header, not in the
// cookie: Next propagates cookies set on a middleware response back onto the
// request, so by render time `cookies()` already holds the stamp we just
// wrote and every document would look old. The header is overwritten
// unconditionally (empty on a first visit) so a client can't forge one.
const VISIT_COOKIE_PREFIX = "lum_visit_";
const VISIT_HEADER = "x-lum-last-visit";
const VISIT_MAX_AGE = 60 * 60 * 24 * 365;

/** Request headers carrying the previous visit stamp for `slug`. */
function visitHeaders(request: NextRequest, slug: string): Headers {
  const headers = new Headers(request.headers);
  headers.set(VISIT_HEADER, request.cookies.get(`${VISIT_COOKIE_PREFIX}${slug}`)?.value ?? "");
  return headers;
}

function stampVisit(res: NextResponse, slug: string): NextResponse {
  res.cookies.set(`${VISIT_COOKIE_PREFIX}${slug}`, String(Date.now()), {
    httpOnly: false, // no secret in it; readable is harmless
    secure: true,
    sameSite: "lax",
    maxAge: VISIT_MAX_AGE,
    path: "/",
  });
  return res;
}

// LC-016: the console's own preview of an operator-uploaded design serves the
// same untrusted HTML the client subdomain serves. The route answers it as a
// wrapper page around a sandboxed iframe, and the strict console policy would
// break both halves of that (frame-src 'none' kills the wrapper, no
// 'unsafe-inline' kills the design's own demo script), so the preview takes
// the document policy like every other stored HTML file this app serves.
const DESIGN_PREVIEW = /^\/api\/clients\/[a-z0-9-]+\/designs\/[^/]+\/?$/;

export async function proxy(request: NextRequest) {
  // Port included: the CSRF same-origin comparison needs it on localhost.
  const rawHost = (request.headers.get("host") || "").toLowerCase();
  const host = rawHost.split(":")[0] ?? "";
  const { pathname } = request.nextUrl;

  const isClientHost =
    host.endsWith(`.${ROOT}`) && host !== CONSOLE_HOST && host !== ROOT;

  if (isClientHost) {
    // Shared assets (favicon etc.) resolve as-is on client hosts.
    if (pathname === "/icon.svg" || pathname === "/favicon.ico") {
      return NextResponse.next();
    }
    const slug = host.slice(0, -(ROOT.length + 1));
    // Client hosts may only reach client-site routes.
    const url = request.nextUrl.clone();
    url.pathname = `/c/${slug}${pathname === "/" ? "" : pathname}`;
    if (pathname !== "/") return harden(NextResponse.rewrite(url), "document");
    return stampVisit(
      harden(NextResponse.rewrite(url, { request: { headers: visitHeaders(request, slug) } }), "document"),
      slug,
    );
  }

  // A stored document previewed on the console host is the same immutable
  // HTML the client subdomain serves, inline scripts and all, so it needs the
  // document policy here too. The portal page under the same prefix is a Next
  // page, and it renders and hydrates cleanly under the document policy: its
  // bundles load from 'self'. It needs the dev-only 'unsafe-eval' in
  // lib/csp.ts to hot-reload, which is why that concession exists.
  // The design preview is GET-only here: publish/unpublish and delete use the
  // same path and answer JSON, which wants the console policy.
  const surface: Surface =
    pathname.startsWith("/c/") || (request.method === "GET" && DESIGN_PREVIEW.test(pathname))
      ? "document"
      : "console";
  const nonce = newNonce();
  // The document policy has no nonce source, so handing one out there would
  // be theatre: a browser ignores nonce attributes a policy never named.
  const cspNonce = surface === "console" ? nonce : null;

  // Console host: public paths first.
  if (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname === "/api/logout" ||
    // Cron endpoints skip the session gate — each route guards itself with
    // the CRON_SECRET bearer check (Vercel Cron can't hold a session cookie).
    pathname.startsWith("/api/cron/") ||
    // The GitHub webhook receiver is necessarily public: GitHub cannot hold a
    // session cookie. Its guard is the HMAC signature over the raw body,
    // verified before the payload is parsed, stored or logged
    // (lib/github/webhooks.ts). It is listed as an exact path, not a prefix,
    // so nothing else under /api/github/ inherits the exemption: the delivery
    // inbox and the processing sweep stay behind the session gate.
    pathname === "/api/github/webhook" ||
    pathname.startsWith("/_next") ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico" ||
    // PWA plumbing must survive a signed-out state: the service worker's
    // update fetch and the manifest/icon fetches iOS makes while installing
    // would otherwise get a redirect to /login and break the installed app.
    // All static public assets, nothing sensitive.
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png" ||
    pathname === "/badge.png" ||
    // The hub's comic strip. A prefix rather than four exact paths because
    // the strip is a whole directory of decorative artwork that is meant to
    // be extended, and nothing but artwork is ever written there.
    //
    // This exemption is load-bearing, not cosmetic: next/image optimises
    // these through an internal fetch that carries no session cookie, so
    // without it the gate answers the optimiser with the /login HTML and
    // every panel fails as "isn't a valid image ... received null" while the
    // reserved boxes still lay out perfectly and hide the breakage.
    pathname.startsWith("/comic/")
  ) {
    // /login is a rendered page and needs the nonce; the rest are static
    // assets that must stay cacheable, so only /login gets no-store.
    const isLogin = pathname === "/login";
    return harden(
      isLogin
        ? NextResponse.next({ request: { headers: nonceRequest(request, nonce) } })
        : NextResponse.next(),
      surface,
      cspNonce,
      isLogin,
    );
  }

  // Direct /c/* access on the console host is allowed for previewing —
  // but still behind auth like everything else.
  const secret = process.env.SESSION_SECRET || "";
  const session = await verifySessionToken(secret, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session || !(await sidAllowed(session.sid, session.absExp))) {
    // These are console responses too. Skipping harden() here left the most
    // requested path on the host — an unauthenticated GET / — with no
    // nosniff, no X-Frame-Options, no HSTS of ours and a cacheable
    // Cache-Control, which is exactly the response a shared cache or a
    // framing attack would want.
    if (pathname.startsWith("/api/")) {
      return harden(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), "console", cspNonce, true);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return harden(NextResponse.redirect(url), "console", cspNonce, true);
  }

  // LC-014: Origin/Referer check on cookie-authenticated mutations.
  //
  // It sits HERE, after the session gate, and that placement is the whole
  // design: reaching this line proves the request carried a valid session
  // cookie, which is exactly the ambient credential a CSRF attack borrows. So
  // the check applies to every cookie-authed mutation and to nothing else.
  // The callers that must never be blocked are all already past:
  //   - /api/github/webhook and /api/cron/* returned from the public-path
  //     list above,
  //   - /api/github/process authenticates cron with a bearer and no cookie,
  //     so a cron call is refused by the session gate exactly as it was
  //     before this check existed (its own behaviour, unchanged here),
  //   - the public portal routes under /c/<slug>/… on a client host returned
  //     from the isClientHost branch long before this point.
  const violation = csrfViolation(request, rawHost);
  if (violation) {
    // Through lib/logger, because the reason string quotes an attacker-chosen
    // Origin/Referer and the request carries a session cookie (LC-017).
    logger.warn("csrf refusal", { path: pathname, method: request.method, reason: violation });
    const body = { error: "Request blocked: cross-origin state change." };
    return harden(
      pathname.startsWith("/api/")
        ? NextResponse.json(body, { status: 403 })
        : new NextResponse(body.error, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
      "console",
      cspNonce,
      true,
    );
  }

  // Slide the idle window (capped at the absolute expiry).
  const { absExp, sid } = session;
  // Previewing a portal from the console stamps the same visit cookie, so the
  // "New" badges behave identically to what the client sees.
  const previewSlug = /^\/c\/([a-z0-9-]+)\/?$/.exec(pathname)?.[1] ?? null;
  // A preview path always lives under /c/, so it is always the document
  // surface and never carries a nonce; the two branches cannot overlap.
  const requestHeaders =
    surface === "console"
      ? nonceRequest(request, nonce)
      : previewSlug
        ? visitHeaders(request, previewSlug)
        : null;
  let res = harden(
    requestHeaders ? NextResponse.next({ request: { headers: requestHeaders } }) : NextResponse.next(),
    surface,
    cspNonce,
    true,
  );
  if (previewSlug) res = stampVisit(res, previewSlug);
  res.cookies.set(SESSION_COOKIE, await makeSessionToken(secret, sid, absExp), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: Math.min(SESSION_MAX_AGE, Math.max(1, Math.floor((absExp - Date.now()) / 1000))),
    path: "/",
  });
  return res;
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
