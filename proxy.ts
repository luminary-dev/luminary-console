// Host-based routing + console auth gate.
//
// - Client sites:  <slug>.luminary-dev.xyz/*  →  rewritten to /c/<slug>/*
//   (public: questionnaire, published docs, PDFs)
// - Console:       console host (or the *.vercel.app project URL) — every
//   path except /login and /api/auth requires the signed session cookie.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

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
    return NextResponse.rewrite(url);
  }

  // Console host: public paths first.
  if (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/_next") ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Direct /c/* access on the console host is allowed for previewing —
  // but still behind auth like everything else.
  const secret = process.env.SESSION_SECRET || "";
  const ok = await verifySessionToken(secret, request.cookies.get(SESSION_COOKIE)?.value);
  if (!ok) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
