// LC-014 — cookie-authenticated mutations must carry an Origin (or Referer)
// that belongs to us, and every non-browser caller that legitimately sends
// neither must keep working.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, makeSessionToken, newSid } from "@/lib/auth";
import { csrfViolation, isMutating, isTrustedOrigin } from "@/lib/csrf";

const SECRET = process.env.SESSION_SECRET as string;
const CONSOLE = "console.example.test";

// Same shape as tests/session.test.ts: the proxy reaches lib/sessions through
// a lazy import, so the gate has to be mocked at the module boundary.
const liveSids = vi.fn<() => Promise<string[]>>();
vi.mock("@/lib/sessions", () => ({ liveSids: () => liveSids() }));

type Proxy = (req: NextRequest) => Promise<Response>;

async function freshProxy(): Promise<Proxy> {
  vi.resetModules();
  const { proxy } = await import("@/proxy");
  return proxy as Proxy;
}

type CallOptions = {
  host?: string;
  method?: string;
  origin?: string | null;
  referer?: string;
  cookie?: string;
  authorization?: string;
};

/** One request through the real proxy, with a valid session cookie unless the
 *  test says otherwise. */
async function call(path: string, opts: CallOptions = {}): Promise<Response> {
  const sid = newSid();
  liveSids.mockResolvedValue([sid]);
  const host = opts.host ?? CONSOLE;
  const headers: Record<string, string> = { host };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.referer) headers.referer = opts.referer;
  if (opts.authorization) headers.authorization = opts.authorization;
  const cookie = opts.cookie === undefined ? `${SESSION_COOKIE}=${await makeSessionToken(SECRET, sid)}` : opts.cookie;
  if (cookie) headers.cookie = cookie;

  const proxy = await freshProxy();
  return proxy(new NextRequest(`https://${host}${path}`, { method: opts.method ?? "POST", headers }));
}

const refused = (res: Response) => res.status === 403;

beforeEach(() => {
  liveSids.mockReset();
  process.env.CONSOLE_USERS = "op@example.test:salt:" + "0".repeat(64);
});

afterEach(() => {
  vi.resetModules();
});

describe("LC-014 the origin allowlist itself", () => {
  it("treats the console host, the apex and any client subdomain as ours", () => {
    expect(isTrustedOrigin(`https://${CONSOLE}`, CONSOLE)).toBe(true);
    expect(isTrustedOrigin("https://example.test", CONSOLE)).toBe(true);
    expect(isTrustedOrigin("https://acme.example.test", CONSOLE)).toBe(true);
  });

  it("accepts an origin equal to the host it was sent to, so preview URLs work", () => {
    // The *.vercel.app project URL is never listed anywhere; same-origin is
    // what makes it work without listing it.
    expect(isTrustedOrigin("https://luminary-console-abc123.vercel.app", "luminary-console-abc123.vercel.app")).toBe(
      true,
    );
  });

  it("refuses another site, a lookalike suffix and plain http in production", () => {
    expect(isTrustedOrigin("https://evil.test", CONSOLE)).toBe(false);
    expect(isTrustedOrigin("https://notexample.test", CONSOLE)).toBe(false);
    // "example.test.evil.test" ends with neither ".example.test" nor the apex.
    expect(isTrustedOrigin("https://example.test.evil.test", CONSOLE)).toBe(false);
    expect(isTrustedOrigin(`http://${CONSOLE}`, CONSOLE)).toBe(false);
    expect(isTrustedOrigin("not a url", CONSOLE)).toBe(false);
  });

  it("only ever fires on a mutating method", () => {
    expect(isMutating("GET")).toBe(false);
    expect(isMutating("HEAD")).toBe(false);
    expect(isMutating("post")).toBe(true);
    expect(isMutating("DELETE")).toBe(true);
    const headers = new Headers({ origin: "https://evil.test" });
    expect(csrfViolation({ method: "GET", headers }, CONSOLE)).toBeNull();
    expect(csrfViolation({ method: "POST", headers }, CONSOLE)).not.toBeNull();
  });

  it("refuses the opaque 'null' origin a sandboxed design iframe would send", () => {
    // LC-016 serves design previews in a sandbox, which makes them
    // opaque-origin; they must not be able to POST with the operator cookie.
    const headers = new Headers({ origin: "null" });
    expect(csrfViolation({ method: "POST", headers }, CONSOLE)).toBe("opaque origin");
  });

  it("falls back to Referer when there is no Origin", () => {
    expect(
      csrfViolation({ method: "POST", headers: new Headers({ referer: `https://${CONSOLE}/clients/acme` }) }, CONSOLE),
    ).toBeNull();
    expect(
      csrfViolation({ method: "POST", headers: new Headers({ referer: "https://evil.test/x" }) }, CONSOLE),
    ).not.toBeNull();
  });
});

describe("LC-014 the proxy refuses cross-origin cookie-authed mutations", () => {
  it("refuses a cross-origin POST that carries the session cookie", async () => {
    expect(refused(await call("/api/clients/acme", { method: "POST", origin: "https://evil.test" }))).toBe(true);
  });

  it("refuses a cross-origin DELETE, the irreversible verb", async () => {
    expect(refused(await call("/api/clients/acme", { method: "DELETE", origin: "https://evil.test" }))).toBe(true);
  });

  it("lets a same-origin POST through", async () => {
    const res = await call("/api/clients/acme", { method: "POST", origin: `https://${CONSOLE}` });
    expect(refused(res)).toBe(false);
    expect(res.status).toBe(200);
  });

  it("does not touch GETs", async () => {
    const res = await call("/clients/acme", { method: "GET", origin: "https://evil.test" });
    expect(refused(res)).toBe(false);
  });
});

describe("LC-014 the callers that send no Origin must keep working", () => {
  it("does not refuse the GitHub webhook, which has no Origin and no cookie", async () => {
    const res = await call("/api/github/webhook", { method: "POST", cookie: "" });
    expect(refused(res)).toBe(false);
    // It is a public path, so it must not be bounced to /login either.
    expect(res.status).toBe(200);
  });

  it("does not refuse a Vercel Cron call, which has a bearer and no Origin", async () => {
    const res = await call("/api/cron/backup", {
      method: "POST",
      cookie: "",
      authorization: "Bearer cron-secret-value",
    });
    expect(refused(res)).toBe(false);
    expect(res.status).toBe(200);
  });

  it("does not refuse /api/github/process, whose cron caller sends no Origin", async () => {
    // It sits behind the session gate and authenticates cron itself, so what
    // matters here is that the CSRF check does not add a new refusal for a
    // request with no Origin at all.
    const res = await call("/api/github/process", { method: "POST" });
    expect(refused(res)).toBe(false);
  });

  it("does not refuse a public portal POST from a client subdomain", async () => {
    const res = await call("/submit", { host: "acme.example.test", method: "POST", origin: "https://acme.example.test", cookie: "" });
    expect(refused(res)).toBe(false);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/c/acme/submit");
  });

  it("does not refuse a portal POST that arrives with no Origin at all", async () => {
    const res = await call("/accept", { host: "acme.example.test", method: "POST", cookie: "" });
    expect(refused(res)).toBe(false);
  });
});
