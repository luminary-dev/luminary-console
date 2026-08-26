// Email OTP as the second factor: 6-digit code, store-backed so it's
// single-use, expiring, attempt-limited and resend-throttled.
//
// The stored value is a KEYED HMAC of the code, not a bare hash (LC-011). A
// 6-digit code is a 10^6 space, so sha256(email:code) is exhaustible offline
// in seconds: a leaked state file used to hand over the live code. Keyed with
// SESSION_SECRET, the same file is worthless without the key. The record path
// is derived the same way, so the file names stop being a lookup table of
// which operator emails have a code outstanding.
//
// There is no legacy-hash fallback on purpose. Codes live 10 minutes and a
// rejected one just means "request a new code", so keeping the brute-forcible
// format alive for one TTL window would buy nothing.
import { readState, writeState, clearState } from "./store";

const TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_TTL_MS = 10 * 1000;

type OtpRec = { v: 2; codeHash: string; exp: number; attempts: number; sentAt: number };
type LockRec = { token: string; at: number };

const enc = new TextEncoder();

function otpKey(): string {
  const s = process.env.SESSION_SECRET;
  // Failing loudly beats silently downgrading to an unkeyed hash.
  if (!s) throw new Error("SESSION_SECRET is required to hash OTP codes.");
  return s;
}

async function hmacHex(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(otpKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const recPath = async (email: string) => `auth/otp-${(await hmacHex(`path:${email}`)).slice(0, 24)}.json`;
const lockPath = (path: string) => path.replace(/\.json$/, ".lock.json");

/** Issue a fresh code (or refuse inside the resend cooldown). */
export async function issueOtp(email: string): Promise<{ code: string } | { retryInMs: number }> {
  const path = await recPath(email);
  const prev = await readState<OtpRec>(path);
  if (prev && Date.now() - prev.sentAt < RESEND_MS) {
    return { retryInMs: RESEND_MS - (Date.now() - prev.sentAt) };
  }
  const [rand] = crypto.getRandomValues(new Uint32Array(1));
  // Refuse rather than fall back to a constant: a predictable code is worse
  // than a failed sign-in.
  if (rand === undefined) throw new Error("crypto.getRandomValues produced no value");
  const code = String(rand % 1_000_000).padStart(6, "0");
  const rec: OtpRec = {
    v: 2,
    codeHash: await hmacHex(`code:${email}:${code}`),
    exp: Date.now() + TTL_MS,
    attempts: 0,
    sentAt: Date.now(),
  };
  await writeState(path, rec);
  // A new code voids whatever lease a previous verify left behind, so an
  // abandoned request cannot stall the first guess against the new code.
  await clearState(lockPath(path));
  return { code };
}

export type OtpResult = "ok" | "wrong" | "expired" | "locked";

// LC-015: the attempt counter used to be a plain read-modify-write, so N
// parallel guesses all read `attempts` before any of them wrote it back and
// each got a free guess. The store this module has (lib/store's
// readState/writeState) offers no compare-and-swap, so the counter cannot be
// made atomic directly. What it does offer is last-write-wins PUT with strong
// read-after-write consistency, which is enough for a lease:
//
//   write {token, at} -> read it back -> you hold the lease only if the token
//   that comes back is yours.
//
// Concurrent writers collapse to one surviving object, so at most one of them
// reads its own token. The important half is what a LOSER does: it returns
// "wrong" WITHOUT evaluating the code at all. Guesses are therefore refused
// rather than tested in parallel, and every guess that is actually tested is
// read-compare-increment-write inside the lease. The 5-attempt budget can no
// longer be multiplied by concurrency.
//
// This is a lease and not a mutex: two writers whose PUT and read-back
// interleave perfectly could both believe they hold it. That costs one extra
// tested guess in the worst case, not an unbounded budget, and the lease
// expires on its own after LOCK_TTL_MS so a crashed request cannot wedge the
// login. The visible cost is that a genuine double-submit gets one spurious
// "wrong"; retyping the code works.
async function acquire(path: string): Promise<string | null> {
  const lp = lockPath(path);
  const held = await readState<LockRec>(lp);
  if (held && Date.now() - held.at < LOCK_TTL_MS) return null;
  const token = crypto.randomUUID();
  await writeState(lp, { token, at: Date.now() });
  const back = await readState<LockRec>(lp);
  return back?.token === token ? lp : null;
}

export async function verifyOtp(email: string, code: string): Promise<OtpResult> {
  const path = await recPath(email);
  const lease = await acquire(path);
  if (!lease) return "wrong";
  try {
    const rec = await readState<OtpRec>(path);
    if (!rec || rec.exp < Date.now()) return "expired";
    if (rec.attempts >= MAX_ATTEMPTS) return "locked";
    if (rec.codeHash !== (await hmacHex(`code:${email}:${code.trim()}`))) {
      const attempts = rec.attempts + 1;
      await writeState(path, { ...rec, attempts });
      return attempts >= MAX_ATTEMPTS ? "locked" : "wrong";
    }
    await clearState(path); // single-use
    return "ok";
  } finally {
    // clearState is best-effort by contract; a release that does not land
    // only delays the next guess until the lease ages out.
    await clearState(lease);
  }
}
