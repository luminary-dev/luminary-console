// Single-operator auth: ADMIN_PASSWORD checked once at /login, then a signed
// HMAC session cookie (SESSION_SECRET) verified by proxy.ts on every console
// request. Web Crypto only, so the same code runs in the proxy and in routes.

export const SESSION_COOKIE = "lum_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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

export async function makeSessionToken(secret: string): Promise<string> {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  return `${exp}.${await sign(secret, `lum-admin.${exp}`)}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await sign(secret, `lum-admin.${exp}`);
  return token.slice(dot + 1) === expected;
}
