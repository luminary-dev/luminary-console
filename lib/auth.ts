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

// Token: "<absExp>.<idleExp>.<sig>" — idleExp slides forward on every
// request (30-min inactivity logout); absExp never moves (daily re-auth).
export async function makeSessionToken(secret: string, absExp?: number): Promise<string> {
  const abs = absExp ?? Date.now() + SESSION_ABS_MAX_AGE * 1000;
  const idle = Math.min(Date.now() + SESSION_MAX_AGE * 1000, abs);
  return `${abs}.${idle}.${await sign(secret, `lum-admin.${abs}.${idle}`)}`;
}

/** Returns the absolute expiry (for re-issuing a slid token) or null. */
export async function verifySessionToken(
  secret: string,
  token: string | undefined,
): Promise<number | null> {
  if (!token) return null;
  const [abs, idle, sig] = token.split(".");
  if (!abs || !idle || !sig) return null;
  const absN = Number(abs), idleN = Number(idle);
  if (!Number.isFinite(absN) || !Number.isFinite(idleN)) return null;
  if (absN < Date.now() || idleN < Date.now()) return null;
  if ((await sign(secret, `lum-admin.${abs}.${idle}`)) !== sig) return null;
  return absN;
}
