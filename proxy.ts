// Host-based routing + console auth gate.
//
// - Client sites:  <slug>.luminary-dev.xyz/*  →  rewritten to /c/<slug>/*
//   (public: questionnaire, published docs, PDFs)
// - Console:       console host (or the *.vercel.app project URL) — every
//   path except /login and /api/auth requires the signed session cookie.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, makeSessionToken, verifySessionToken } from "@/lib/auth";

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
    return harden(NextResponse.rewrite(url), false);
  }

  // Console host: public paths first.
  if (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname === "/api/logout" ||
    pathname.startsWith("/_next") ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico"
  ) {
    return harden(NextResponse.next(), pathname === "/login");
  }

  // Direct /c/* access on the console host is allowed for previewing —
  // but still behind auth like everything else.
  const secret = process.env.SESSION_SECRET || "";
  const absExp = await verifySessionToken(secret, request.cookies.get(SESSION_COOKIE)?.value);
  if (!absExp) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Slide the idle window (capped at the absolute expiry).
  const res = harden(NextResponse.next(), true);
  res.cookies.set(SESSION_COOKIE, await makeSessionToken(secret, absExp), {
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
