// LC-011 — operator passwords move to a slow KDF, OTP codes to a keyed HMAC.
// LC-015 — the OTP attempt counter survives parallel guesses.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atIndex } from "./helpers";

const SECRET = process.env.SESSION_SECRET as string;

const enc = new TextEncoder();

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ——— an in-memory stand-in for lib/store's state records ———
// Every operation yields to the microtask queue first, so a Promise.all of
// concurrent callers really does interleave rather than run to completion one
// at a time. That is what LC-015 is about.
const state = new Map<string, unknown>();
vi.mock("@/lib/store", () => ({
  readState: async (path: string) => {
    await Promise.resolve();
    return state.has(path) ? structuredClone(state.get(path)) : null;
  },
  writeState: async (path: string, data: unknown) => {
    await Promise.resolve();
    state.set(path, structuredClone(data));
  },
  clearState: async (path: string) => {
    await Promise.resolve();
    state.delete(path);
  },
}));

beforeEach(() => {
  state.clear();
});

afterEach(() => {
  delete process.env.CONSOLE_USERS;
});

describe("LC-011 operator passwords", () => {
  it("still verifies a legacy salt:sha256 credential, so nobody is locked out mid-migration", async () => {
    const { verifyUser } = await import("@/lib/users");
    const salt = "s0me-legacy-salt";
    process.env.CONSOLE_USERS = `Legacy@Example.test:${salt}:${await sha256Hex(`${salt}:hunter2`)}`;

    expect(await verifyUser("legacy@example.test", "hunter2")).toBe("legacy@example.test");
    expect(await verifyUser("legacy@example.test", "hunter3")).toBeNull();
  });

  it("verifies a scrypt credential", async () => {
    const { encodePassword, verifyUser } = await import("@/lib/users");
    const cred = await encodePassword("correct horse battery staple");
    expect(cred.startsWith("scrypt$")).toBe(true);
    process.env.CONSOLE_USERS = `op@example.test:${cred}`;

    expect(await verifyUser("op@example.test", "correct horse battery staple")).toBe("op@example.test");
    expect(await verifyUser("op@example.test", "correct horse battery stapl")).toBeNull();
  });

  it("costs real work per guess, unlike the single SHA-256 it replaces", async () => {
    const { encodePassword } = await import("@/lib/users");
    const started = Date.now();
    await encodePassword("whatever");
    // A fast hash is microseconds. The exact figure is machine-dependent, so
    // this only asserts the order of magnitude the finding asked for.
    expect(Date.now() - started).toBeGreaterThan(10);
  });

  it("accepts both formats side by side and rejects unknown emails", async () => {
    const { encodePassword, verifyUser } = await import("@/lib/users");
    const salt = "legacy-salt";
    process.env.CONSOLE_USERS = [
      `legacy@example.test:${salt}:${await sha256Hex(`${salt}:pw-one`)}`,
      `new@example.test:${await encodePassword("pw-two")}`,
    ].join(",");

    expect(await verifyUser("legacy@example.test", "pw-one")).toBe("legacy@example.test");
    expect(await verifyUser("new@example.test", "pw-two")).toBe("new@example.test");
    expect(await verifyUser("new@example.test", "pw-one")).toBeNull();
    expect(await verifyUser("nobody@example.test", "pw-two")).toBeNull();
  });

  it("keeps hashPassword(salt, pw) === hash working for both formats", async () => {
    // app/api/clients/[slug]/route.ts re-confirms a deletion with exactly
    // this comparison, so the contract has to survive the new format.
    const { encodePassword, hashPassword, parseUsers } = await import("@/lib/users");
    const salt = "legacy-salt";
    process.env.CONSOLE_USERS = [
      `legacy@example.test:${salt}:${await sha256Hex(`${salt}:pw-one`)}`,
      `new@example.test:${await encodePassword("pw-two")}`,
    ].join(",");

    const users = parseUsers();
    expect(users).toHaveLength(2);
    for (const [i, pw] of ["pw-one", "pw-two"].entries()) {
      const user = atIndex(users, i);
      expect(await hashPassword(user.salt, pw)).toBe(user.hash);
      expect(await hashPassword(user.salt, "wrong")).not.toBe(user.hash);
    }
  });

  it("refuses a credential asking for absurd scrypt cost", async () => {
    const { hashPassword } = await import("@/lib/users");
    expect(await hashPassword("scrypt$1048576$32$1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaA", "pw")).toBe("");
  });
});

describe("LC-011 OTP codes are stored as a keyed HMAC", () => {
  it("does not store a bare sha256 of email:code", async () => {
    const { issueOtp } = await import("@/lib/otp");
    const issued = await issueOtp("op@example.test");
    if (!("code" in issued)) throw new Error("expected a fresh code");

    const stored = [...state.values()][0] as { codeHash: string };
    expect(stored.codeHash).not.toBe(await sha256Hex(`op@example.test:${issued.code}`));
    expect(stored.codeHash).not.toBe(await sha256Hex(issued.code));
    // Keyed with SESSION_SECRET: an attacker holding the state file cannot
    // recompute the value without it, whatever they guess the code to be.
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`code:op@example.test:${issued.code}`));
    expect(stored.codeHash).toBe(
      [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
  });

  it("verifies the right code once and refuses the wrong one", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/otp");
    const issued = await issueOtp("op@example.test");
    if (!("code" in issued)) throw new Error("expected a fresh code");

    expect(await verifyOtp("op@example.test", "000000" === issued.code ? "111111" : "000000")).toBe("wrong");
    expect(await verifyOtp("op@example.test", issued.code)).toBe("ok");
    expect(await verifyOtp("op@example.test", issued.code)).toBe("expired"); // single use
  });

  it("keeps the record path out of the clear, so state files are not an email list", async () => {
    const { issueOtp } = await import("@/lib/otp");
    await issueOtp("op@example.test");
    const path = [...state.keys()][0];
    expect(path).not.toContain((await sha256Hex("op@example.test")).slice(0, 24));
  });
});

describe("LC-015 parallel OTP guesses cannot outrun the lockout", () => {
  it("increments the counter at most once per round of concurrent guesses", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/otp");
    const issued = await issueOtp("op@example.test");
    if (!("code" in issued)) throw new Error("expected a fresh code");
    const wrong = issued.code === "000000" ? "111111" : "000000";
    const recPath = atIndex([...state.keys()], 0);

    // 8 rounds of 12 parallel guesses: 96 attempts fired at a 5-attempt
    // budget. Before the fix each round burned only one attempt off the
    // counter while granting twelve real guesses.
    for (let round = 0; round < 8; round++) {
      await Promise.all(Array.from({ length: 12 }, () => verifyOtp("op@example.test", wrong)));
    }

    const rec = state.get(recPath) as { attempts: number } | undefined;
    expect(rec?.attempts).toBeLessThanOrEqual(5);
    expect(await verifyOtp("op@example.test", issued.code)).toBe("locked");
  });

  it("never lets a parallel loser test its guess", async () => {
    const { issueOtp, verifyOtp } = await import("@/lib/otp");
    const issued = await issueOtp("op@example.test");
    if (!("code" in issued)) throw new Error("expected a fresh code");

    // One of these holds the correct code. Whoever loses the lease is told
    // "wrong" without the code being looked at, so at most one "ok" is
    // possible and a redemption is never silently duplicated.
    const results = await Promise.all([
      verifyOtp("op@example.test", issued.code),
      verifyOtp("op@example.test", issued.code),
      verifyOtp("op@example.test", issued.code),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
  });
});
