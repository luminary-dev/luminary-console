// Session tokens: issued after email+password+OTP at /login, then a signed
// HMAC session cookie (SESSION_SECRET) verified by proxy.ts on every console
// request. Web Crypto only, so the same code runs in the proxy and in routes.

export const SESSION_COOKIE = "lum_session";
export const SESSION_MAX_AGE = 30 * 60; // idle window: 30 min, slid on activity
export const SESSION_ABS_MAX_AGE = 60 * 60 * 24; // hard cap: re-auth daily

function toB64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toB64url(sig);
}

/** Session id embedded in every token — 8 random bytes as 16 hex chars.
 *  Identifies the login in the session registry so it can be revoked. */
export function newSid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SID_RE = /^[0-9a-f]{16}$/;

// Token: "<absExp>.<idleExp>.<sid>.<sig>" — idleExp slides forward on every
// request (30-min inactivity logout); absExp never moves (daily re-auth);
// sid is fixed for the login's lifetime and checked against the revocation
// list by the proxy. (This replaced "<absExp>.<idleExp>.<sig>" — old tokens
// fail verification, which just means everyone signs in again once.)
export async function makeSessionToken(secret: string, sid: string, absExp?: number): Promise<string> {
  const abs = absExp ?? Date.now() + SESSION_ABS_MAX_AGE * 1000;
  const idle = Math.min(Date.now() + SESSION_MAX_AGE * 1000, abs);
  return `${abs}.${idle}.${sid}.${await sign(secret, `lum-admin.${abs}.${idle}.${sid}`)}`;
}

/** Returns {absExp (for re-issuing a slid token), sid} or null. */
export async function verifySessionToken(
  secret: string,
  token: string | undefined,
): Promise<{ absExp: number; sid: string } | null> {
  if (!token) return null;
  const [abs, idle, sid, sig] = token.split(".");
  if (!abs || !idle || !sid || !sig) return null;
  const absN = Number(abs), idleN = Number(idle);
  if (!Number.isFinite(absN) || !Number.isFinite(idleN) || !SID_RE.test(sid)) return null;
  if (absN < Date.now() || idleN < Date.now()) return null;
  if ((await sign(secret, `lum-admin.${abs}.${idle}.${sid}`)) !== sig) return null;
  return { absExp: absN, sid };
}
