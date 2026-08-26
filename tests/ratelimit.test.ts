// LC-013 — the security-critical buckets must count in a SHARED window, so
// the ceiling is the limit rather than "the limit times however many function
// instances happen to be warm", and a cold start must not hand the attacker a
// fresh budget.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// A stand-in for R2 that survives a module reset, which is how an instance
// restart is simulated: the in-memory Map inside lib/ratelimit is rebuilt, the
// objects here are not. `fail` turns the store into an outage.
const store = vi.hoisted(() => {
  const objects = new Map<string, unknown>();
  const state = { fail: false, writes: 0 };
  return {
    objects,
    state,
    reset() {
      objects.clear();
      state.fail = false;
      state.writes = 0;
    },
  };
});

vi.mock("@/lib/store", () => ({
  updateState: async <T>(path: string, mutate: (current: T | null) => T): Promise<T> => {
    if (store.state.fail) throw new Error("R2 is unreachable");
    store.state.writes += 1;
    const next = mutate((store.objects.get(path) as T | undefined) ?? null);
    store.objects.set(path, next);
    return next;
  },
}));

type Limiter = typeof import("@/lib/ratelimit");

/** A cold instance: fresh module registry, therefore a fresh in-memory Map. */
async function coldStart(): Promise<Limiter> {
  vi.resetModules();
  return (await import("@/lib/ratelimit")) as Limiter;
}

const req = (ip = "203.0.113.5") =>
  new Request("https://console.example.test/api/auth", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
  });

beforeEach(() => {
  store.reset();
});

afterEach(() => {
  vi.resetModules();
});

describe("LC-013 the shared window survives an instance restart", () => {
  it("keeps counting the auth bucket across a cold start and enforces one global ceiling", async () => {
    const first = await coldStart();
    const max = first.LIMITS.auth;

    // Six attempts on one instance.
    for (let i = 0; i < 6; i++) {
      expect(await first.rateLimitShared(req(), "auth")).toBeNull();
    }

    // The instance dies and a new one comes up with an empty Map. Before this
    // fix that reset the attacker's budget to zero-of-ten all over again.
    const second = await coldStart();
    for (let i = 6; i < max; i++) {
      expect(await second.rateLimitShared(req(), "auth")).toBeNull();
    }

    const blocked = await second.rateLimitShared(req(), "auth");
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(blocked?.json()).resolves.toMatchObject({ error: expect.stringContaining("Too many requests") });
  });

  it("counts each IP separately", async () => {
    const lim = await coldStart();
    for (let i = 0; i < lim.LIMITS.auth; i++) {
      expect(await lim.rateLimitShared(req("198.51.100.1"), "auth")).toBeNull();
    }
    expect((await lim.rateLimitShared(req("198.51.100.1"), "auth"))?.status).toBe(429);
    // A different address starts clean.
    expect(await lim.rateLimitShared(req("198.51.100.2"), "auth")).toBeNull();
  });

  it("does not put the IP in the store key in clear", async () => {
    const lim = await coldStart();
    await lim.rateLimitShared(req("203.0.113.9"), "auth");
    const keys = [...store.objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ratelimit\/auth\/[0-9a-f]{32}\.json$/);
    expect(keys[0]).not.toContain("203.0.113.9");
  });
});

describe("LC-013 only the buckets that need it pay for the store", () => {
  it("marks auth as shared and the per-IP web-form buckets as in-memory", async () => {
    const lim = await coldStart();
    expect(lim.SHARED.auth).toBe(true);
    // An upload fires once per attached file; a store round trip each time is
    // a bad trade for a limit that exists to stop a careless script.
    expect(lim.SHARED.upload).toBe(false);
    expect(lim.SHARED.submit).toBe(false);
    expect(lim.SHARED.accept).toBe(false);
    expect(lim.SHARED.comment).toBe(false);
    expect(lim.SHARED.assist).toBe(false);
  });

  it("never touches the store for an in-memory bucket", async () => {
    const lim = await coldStart();
    for (let i = 0; i < 5; i++) await lim.rateLimitShared(req(), "upload");
    expect(store.state.writes).toBe(0);
    expect(store.objects.size).toBe(0);
  });

  it("answers 429 from memory without a store round trip once this instance is over", async () => {
    const lim = await coldStart();
    for (let i = 0; i < lim.LIMITS.auth; i++) await lim.rateLimitShared(req(), "auth");
    const writesBefore = store.state.writes;
    expect((await lim.rateLimitShared(req(), "auth"))?.status).toBe(429);
    expect(store.state.writes).toBe(writesBefore);
  });

  it("falls back to per-instance counting when there is no client IP", async () => {
    // Every caller would otherwise share one global auth counter, which is a
    // denial of service on the login for everybody.
    const lim = await coldStart();
    const anonymous = new Request("https://console.example.test/api/auth", { method: "POST" });
    expect(await lim.rateLimitShared(anonymous, "auth")).toBeNull();
    expect(store.objects.size).toBe(0);
  });
});

describe("LC-013 a store outage degrades, it does not lock anyone out", () => {
  it("keeps serving the login and falls back to the in-memory ceiling", async () => {
    store.state.fail = true;
    const lim = await coldStart();

    // Documented failure mode: fail open to the pre-LC-013 behaviour rather
    // than refuse. An R2 hiccup must not lock every operator out of the
    // console, including whoever would go and fix R2.
    for (let i = 0; i < lim.LIMITS.auth; i++) {
      expect(await lim.rateLimitShared(req(), "auth")).toBeNull();
    }
    // "Fail open" means open to the in-memory limiter, not open to everything.
    expect((await lim.rateLimitShared(req(), "auth"))?.status).toBe(429);
  });

  it("resumes global counting the moment the store comes back", async () => {
    store.state.fail = true;
    const outage = await coldStart();
    for (let i = 0; i < 3; i++) await outage.rateLimitShared(req(), "auth");
    expect(store.objects.size).toBe(0);

    store.state.fail = false;
    const recovered = await coldStart();
    for (let i = 0; i < recovered.LIMITS.auth; i++) {
      expect(await recovered.rateLimitShared(req(), "auth")).toBeNull();
    }
    expect((await recovered.rateLimitShared(req(), "auth"))?.status).toBe(429);
  });
});

describe("LC-013 the synchronous API the existing call sites use is unchanged", () => {
  it("still returns null or a 429 without a promise", async () => {
    const lim = await coldStart();
    for (let i = 0; i < lim.LIMITS.submit; i++) expect(lim.rateLimit(req(), "submit")).toBeNull();
    const blocked = lim.rateLimit(req(), "submit");
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
  });

  it("takes the first hop of x-forwarded-for as the client", async () => {
    const lim = await coldStart();
    expect(lim.clientIp(req("203.0.113.7"))).toBe("203.0.113.7");
    expect(lim.clientIp(new Request("https://console.example.test/"))).toBe("unknown");
  });
});
