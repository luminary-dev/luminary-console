// LC-010 — "Sign out" must invalidate the session server-side, and the proxy
// must treat the session registry as an allowlist rather than a denylist.
// GAP-3.5a — dropping an operator from CONSOLE_USERS must end their sessions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_ABS_MAX_AGE, SESSION_COOKIE, makeSessionToken, newSid } from "@/lib/auth";

const SECRET = process.env.SESSION_SECRET as string;

// The proxy reaches lib/sessions through a lazy import, so the mock has to be
// hoisted. `liveSids` is the whole gate: what it returns (or throws) is what
// the proxy decides on.
const liveSids = vi.fn<() => Promise<string[]>>();
vi.mock("@/lib/sessions", () => ({
  liveSids: () => liveSids(),
  revokeSessions: (sids: string[]) => revokeSessions(sids),
}));
const revokeSessions = vi.fn<(sids: string[]) => Promise<void>>();

type Proxy = (req: NextRequest) => Promise<Response>;

/** A fresh proxy instance: it caches the allowlist for 60s in module scope,
 *  so a test that wants an uncached decision needs a new module registry. */
async function freshProxy(): Promise<Proxy> {
  vi.resetModules();
  const { proxy } = await import("@/proxy");
  return proxy as Proxy;
}

function call(proxy: Proxy, token: string, path = "/"): Promise<Response> {
  return proxy(
    new NextRequest(`https://console.example.test${path}`, {
      headers: { host: "console.example.test", cookie: `${SESSION_COOKIE}=${token}` },
    }),
  );
}

async function consoleRequest(token: string, path = "/"): Promise<Response> {
  return call(await freshProxy(), token, path);
}

const allowed = (res: Response) => res.status === 200 && !res.headers.get("location");
const bouncedToLogin = (res: Response) =>
  res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").endsWith("/login");

beforeEach(() => {
  liveSids.mockReset();
  revokeSessions.mockReset();
  revokeSessions.mockResolvedValue(undefined);
  process.env.CONSOLE_USERS = "op@example.test:salt:" + "0".repeat(64);
});

afterEach(() => {
  vi.resetModules();
});

describe("LC-010 the proxy uses the session registry as an allowlist", () => {
  it("accepts a token whose sid is registered", async () => {
    const sid = newSid();
    liveSids.mockResolvedValue([sid]);
    expect(allowed(await consoleRequest(await makeSessionToken(SECRET, sid)))).toBe(true);
  });

  it("rejects a signature-valid token whose sid was never registered", async () => {
    // This is the baseline finding: a minted token with an unknown sid used to
    // be accepted by every authed route.
    liveSids.mockResolvedValue([newSid()]);
    const res = await consoleRequest(await makeSessionToken(SECRET, newSid()));
    expect(bouncedToLogin(res)).toBe(true);
  });

  it("401s an API call whose sid is not registered", async () => {
    liveSids.mockResolvedValue([]);
    const res = await consoleRequest(await makeSessionToken(SECRET, newSid()), "/api/activity");
    expect(res.status).toBe(401);
  });

  it("re-reads the registry for a session minted after the cached snapshot", async () => {
    // A stale snapshot must not bounce an operator who signed in seconds ago,
    // so a miss on a token ISSUED after the snapshot triggers one fresh read.
    const proxy = await freshProxy();
    const old = newSid();
    liveSids.mockResolvedValue([old]);
    expect(allowed(await call(proxy, await makeSessionToken(SECRET, old)))).toBe(true);
    expect(liveSids).toHaveBeenCalledTimes(1); // snapshot taken

    const sid = newSid();
    liveSids.mockResolvedValue([old, sid]);
    const justIssued = Date.now() + 1000 + SESSION_ABS_MAX_AGE * 1000;
    expect(allowed(await call(proxy, await makeSessionToken(SECRET, sid, justIssued)))).toBe(true);
    expect(liveSids).toHaveBeenCalledTimes(2); // one extra read, on the miss
  });

  it("does not re-read the registry for an old sid that is simply gone", async () => {
    // A replayed cookie must not be able to turn every request into a store
    // read: only a token newer than the snapshot earns the second look.
    const proxy = await freshProxy();
    const live = newSid();
    liveSids.mockResolvedValue([live]);
    expect(allowed(await call(proxy, await makeSessionToken(SECRET, live)))).toBe(true);

    const stale = await makeSessionToken(SECRET, newSid(), Date.now() - 1000 + SESSION_ABS_MAX_AGE * 1000);
    expect(bouncedToLogin(await call(proxy, stale))).toBe(true);
    expect(bouncedToLogin(await call(proxy, stale))).toBe(true);
    expect(liveSids).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN when the store is unreachable, so an outage cannot lock operators out", async () => {
    liveSids.mockRejectedValue(new Error("R2 is down"));
    expect(allowed(await consoleRequest(await makeSessionToken(SECRET, newSid())))).toBe(true);
  });

  it("still rejects a token that does not verify against SESSION_SECRET", async () => {
    liveSids.mockResolvedValue([]);
    const sid = newSid();
    const forged = (await makeSessionToken("not-the-secret", sid));
    expect(bouncedToLogin(await consoleRequest(forged))).toBe(true);
  });
});

describe("LC-010 sign-out revokes the session", () => {
  it("revokes the caller's sid, and the replayed cookie then fails", async () => {
    const sid = newSid();
    const token = await makeSessionToken(SECRET, sid);

    liveSids.mockResolvedValue([sid]);
    expect(allowed(await consoleRequest(token))).toBe(true);

    vi.resetModules();
    const { POST } = await import("@/app/api/logout/route");
    const res = await POST(
      new Request("https://console.example.test/api/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(revokeSessions).toHaveBeenCalledWith([sid]);
    // The browser's copy goes too.
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);

    // revokeSessions drops the sid from the registry, so the allowlist no
    // longer holds it and the captured cookie is dead.
    liveSids.mockResolvedValue([]);
    expect(bouncedToLogin(await consoleRequest(token))).toBe(true);
  });

  it("reports a failure rather than pretending the session ended", async () => {
    revokeSessions.mockRejectedValue(new Error("R2 is down"));
    vi.resetModules();
    const { POST } = await import("@/app/api/logout/route");
    const res = await POST(
      new Request("https://console.example.test/api/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${await makeSessionToken(SECRET, newSid())}` },
      }),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("is a no-op for a caller with no valid session", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/logout/route");
    const res = await POST(new Request("https://console.example.test/api/logout", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});

describe("GAP-3.5a removing an operator ends their live sessions", () => {
  it("drops registry entries whose email is no longer in CONSOLE_USERS", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/sessions");
    const now = new Date().toISOString();
    vi.doMock("@/lib/store", () => ({
      readState: async (path: string) =>
        path === "sessions.json"
          ? [
              { sid: "aaaaaaaaaaaaaaaa", email: "op@example.test", ua: "x", at: now },
              { sid: "bbbbbbbbbbbbbbbb", email: "gone@example.test", ua: "x", at: now },
              { sid: "cccccccccccccccc", email: "op@example.test", ua: "x", at: now },
            ]
          : [{ sid: "cccccccccccccccc", at: now }],
      writeState: async () => {},
    }));
    const { liveSids: real } = await import("@/lib/sessions");
    // Only op@ is an operator; gone@ was removed from CONSOLE_USERS and
    // cccc… was revoked.
    expect(await real()).toEqual(["aaaaaaaaaaaaaaaa"]);
  });
});
