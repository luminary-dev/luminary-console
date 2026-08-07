// Host-based routing + console auth gate.
//
// - Client sites:  <slug>.luminary-dev.xyz/*  →  rewritten to /c/<slug>/*
//   (public: questionnaire, published docs, PDFs)
// - Console:       console host (or the *.vercel.app project URL) — every
//   path except /login and /api/auth requires the signed session cookie.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, makeSessionToken, verifySessionToken } from "@/lib/auth";

// Revoked-sid cache: one store read per instance per minute instead of per
// request. Revocation therefore takes up to ~60s to propagate — acceptable
// staleness for "sign that device out". Fails open (treats the list as
// empty) so a store hiccup can't lock the operator out of the console.
//
// lib/sessions is imported lazily because it reaches the S3 SDK through the
// store: the proxy runs on EVERY request, and there is no reason to load a
// storage client on the ~59 seconds in 60 that this answers from cache, or
// on client-host requests, which never consult it at all.
let revokedCache: { at: number; sids: Set<string> } | null = null;
async function sidRevoked(sid: string): Promise<boolean> {
  if (!revokedCache || Date.now() - revokedCache.at > 60_000) {
    try {
      const { revokedSids } = await import("@/lib/sessions");
      revokedCache = { at: Date.now(), sids: new Set(await revokedSids()) };
    } catch {
      revokedCache = { at: Date.now(), sids: new Set() };
    }
  }
  return revokedCache.sids.has(sid);
}

// Standard hardening for a private operations console.
function harden(res: NextResponse, console_: boolean) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.headers.set("X-Frame-Options", console_ ? "DENY" : "SAMEORIGIN");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (console_) res.headers.set("Cache-Control", "no-store"); // back/hard-reload never shows stale authed pages
  return res;
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

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
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
    if (pathname !== "/") return harden(NextResponse.rewrite(url), false);
    return stampVisit(
      harden(NextResponse.rewrite(url, { request: { headers: visitHeaders(request, slug) } }), false),
      slug,
    );
  }

  // Console host: public paths first.
  if (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname === "/api/logout" ||
    // Cron endpoints skip the session gate — each route guards itself with
    // the CRON_SECRET bearer check (Vercel Cron can't hold a session cookie).
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next") ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico"
  ) {
    return harden(NextResponse.next(), pathname === "/login");
  }

  // Direct /c/* access on the console host is allowed for previewing —
  // but still behind auth like everything else.
  const secret = process.env.SESSION_SECRET || "";
  const session = await verifySessionToken(secret, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session || (await sidRevoked(session.sid))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Slide the idle window (capped at the absolute expiry).
  const { absExp, sid } = session;
  // Previewing a portal from the console stamps the same visit cookie, so the
  // "New" badges behave identically to what the client sees.
  const preview = /^\/c\/([a-z0-9-]+)\/?$/.exec(pathname);
  let res = harden(
    preview
      ? NextResponse.next({ request: { headers: visitHeaders(request, preview[1]) } })
      : NextResponse.next(),
    true,
  );
  if (preview) res = stampVisit(res, preview[1]);
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
