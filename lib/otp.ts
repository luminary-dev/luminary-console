// Email OTP as the second factor: 6-digit code, store-backed so it's
// single-use, expiring, attempt-limited and resend-throttled.
import { readState, writeState, clearState } from "./store";

const TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

type OtpRec = { codeHash: string; exp: number; attempts: number; sentAt: number };

const enc = new TextEncoder();
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const recPath = async (email: string) => `auth/otp-${(await sha256Hex(email)).slice(0, 24)}.json`;

/** Issue a fresh code (or refuse inside the resend cooldown). */
export async function issueOtp(email: string): Promise<{ code: string } | { retryInMs: number }> {
  const path = await recPath(email);
  const prev = await readState<OtpRec>(path);
  if (prev && Date.now() - prev.sentAt < RESEND_MS) {
    return { retryInMs: RESEND_MS - (Date.now() - prev.sentAt) };
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const rec: OtpRec = { codeHash: await sha256Hex(`${email}:${code}`), exp: Date.now() + TTL_MS, attempts: 0, sentAt: Date.now() };
  await writeState(path, rec);
  return { code };
}

export type OtpResult = "ok" | "wrong" | "expired" | "locked";

export async function verifyOtp(email: string, code: string): Promise<OtpResult> {
  const path = await recPath(email);
  const rec = await readState<OtpRec>(path);
  if (!rec || rec.exp < Date.now()) return "expired";
  if (rec.attempts >= MAX_ATTEMPTS) return "locked";
  if (rec.codeHash !== (await sha256Hex(`${email}:${code.trim()}`))) {
    rec.attempts += 1;
    await writeState(path, rec);
    return rec.attempts >= MAX_ATTEMPTS ? "locked" : "wrong";
  }
  await clearState(path); // single-use
  return "ok";
}
