// LC-012 — Content-Security-Policy, COOP/CORP and HSTS preload.
import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { cspFor, newNonce, securityHeaders } from "@/lib/csp";
import { harden } from "@/proxy";

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(";").map((d) => {
      const parts = d.trim().split(/\s+/);
      // split always yields at least one element, so the name is never absent.
      return [parts[0] ?? "", parts.slice(1).join(" ")];
    }),
  );
}

describe("LC-012 harden() emits a strict console policy", () => {
  it("carries the request nonce, strict-dynamic and the object/base/frame lockdown", () => {
    const nonce = newNonce();
    const res = harden(NextResponse.next(), "console", nonce);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const d = directives(csp);

    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("script-src")).toContain(`'nonce-${nonce}'`);
    expect(d.get("script-src")).toContain("'strict-dynamic'");
    expect(d.get("script-src")).not.toContain("'unsafe-inline'");
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'none'");
    expect(d.get("frame-ancestors")).toBe("'none'");
  });

  it("sets COOP, CORP, HSTS with preload and the rest of the hardening", () => {
    const res = harden(NextResponse.next(), "console", newNonce(), true);
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves static console assets cacheable", () => {
    const res = harden(NextResponse.next(), "console", newNonce());
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("gives every nonce its own value", () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});

describe("LC-012 the stored-document policy stays loadable", () => {
  it("allows the inline scripts baked into stored documents, but nothing worse", () => {
    const d = directives(cspFor("document", null));
    // Stored HTML cannot receive a per-request nonce, so inline script is the
    // one concession. Everything an injected script would reach for is not.
    expect(d.get("script-src")).toContain("'unsafe-inline'");
    expect(d.get("script-src")).not.toContain("'unsafe-eval'");

    // Asserted against an explicit production NODE_ENV rather than relying on
    // the test environment happening not to be "development": the dev-only
    // 'unsafe-eval' that lets the portal page hot-reload must never ship.
    const prior = process.env.NODE_ENV;
    try {
      vi.stubEnv("NODE_ENV", "production");
      for (const surface of ["document", "console"] as const) {
        expect(directives(cspFor(surface, "n0nce")).get("script-src")).not.toContain("'unsafe-eval'");
      }
    } finally {
      vi.unstubAllEnvs();
      expect(process.env.NODE_ENV).toBe(prior);
    }
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'none'");
    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("form-action")).toBe("'self'");
    // The accept-quotation and sign-contract forms POST back to their own
    // origin with fetch, so connect-src must keep 'self'.
    expect(d.get("connect-src")).toBe("'self'");
    // The document shell pulls its typefaces from Google Fonts.
    expect(d.get("style-src")).toContain("https://fonts.googleapis.com");
    expect(d.get("font-src")).toContain("https://fonts.gstatic.com");
  });

  it("keeps the same-origin framing the client sites already allowed", () => {
    const headers = securityHeaders("document", null);
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    const csp = headers["Content-Security-Policy"];
    expect(csp).toBeTypeOf("string");
    expect(directives(csp ?? "").get("frame-ancestors")).toBe("'self'");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-site");
  });
});
