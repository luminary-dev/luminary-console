// Operator accounts. CONSOLE_USERS is a comma-separated allowlist; only these
// emails can sign in, and each has its own strong password.
//
// Two entry formats are accepted (LC-011):
//
//   legacy   email:salt:sha256hex(salt:password)
//   current  email:scrypt$N$r$p$saltB64url$hashB64url
//
// The legacy format is one round of SHA-256, which is a few microseconds per
// guess offline. The current format runs scrypt, which is memory-hard and
// ~100ms per guess with the parameters below. Both verify so nobody is
// locked out mid-migration; only the current format should be written.
//
// MIGRATION (the three live operators):
//   1. Generate a replacement credential for each operator, one at a time:
//        npx tsx -e "import('./lib/users.ts').then(async m => \
//          console.log(await m.encodePassword('<their password>')))"
//      That prints `scrypt$32768$8$1$…$…`.
//   2. In CONSOLE_USERS, replace that operator's `salt:hash` tail with the
//      printed string, keeping `email:` in front. The entry goes from three
//      colon-separated fields to two; parseUsers handles both.
//   3. Redeploy and have that operator sign in once to confirm, then repeat
//      for the next. A half-migrated CONSOLE_USERS is a supported state, so
//      each operator can be cut over independently and rolled back by
//      restoring their old tail.
//
// node:crypto is imported LAZILY, inside the scrypt path only. Web Crypto has
// no KDF, but this module's static import graph has to stay Web-Crypto-only:
// it is the operator allowlist, so it is the kind of module that gets pulled
// into the proxy. Today its only importers are app/api/auth/route.ts and
// app/api/clients/[slug]/route.ts, both `runtime = "nodejs"`, and the proxy
// reaches it through lib/sessions (also Node since Next 16). The lazy import
// keeps that from being load-bearing.
const enc = new TextEncoder();

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_N = 32768; // 2^15: ~32 MB and ~100ms per guess at r=8
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
// A malformed or hostile CONSOLE_USERS entry must not turn a login into a
// memory bomb, so the cost parameters a stored credential may ask for are
// capped at 4x the current defaults.
const MAX_NR = SCRYPT_N * SCRYPT_R * 4;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant time for equal-length inputs. Length itself is not a secret: the
 *  key length is published in the stored credential. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  // Both reads are inside both arrays (equal lengths, checked above), so the
  // fallbacks never fire and every iteration costs the same.
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function scryptKey(
  password: string,
  salt: Uint8Array,
  N: number,
  r: number,
  p: number,
  keylen: number,
): Promise<Uint8Array> {
  const { scrypt } = await import("node:crypto");
  return new Promise<Uint8Array>((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(salt),
      keylen,
      // Node's default maxmem is 32 MB, which is exactly what N=32768,r=8
      // needs, so the call would fail on the boundary without this.
      { N, r, p, maxmem: 256 * N * r },
      (err, key) => (err ? reject(err) : resolve(new Uint8Array(key))),
    );
  });
}

/** Mint a credential for CONSOLE_USERS. See the MIGRATION note above. */
export async function encodePassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await scryptKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN);
  return `${SCRYPT_PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${b64url(salt)}$${b64url(key)}`;
}

async function verifyScrypt(cred: string, password: string): Promise<boolean> {
  const parts = cred.split("$");
  if (parts.length !== 6) return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  // The length check above already guarantees these, but a malformed
  // credential must fail closed rather than be asserted away.
  if (saltRaw === undefined || hashRaw === undefined) return false;
  const N = Number(nRaw), r = Number(rRaw), p = Number(pRaw);
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) return false; // N must be a power of two
  if (!Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1) return false;
  if (N * r > MAX_NR || p > 16) return false;
  let salt: Uint8Array, want: Uint8Array;
  try {
    salt = unb64url(saltRaw);
    want = unb64url(hashRaw);
  } catch {
    return false;
  }
  if (!salt.length || want.length < 16) return false;
  return sameBytes(await scryptKey(password, salt, N, r, p, want.length), want);
}

export type UserRec = { email: string; salt: string; hash: string };

export function parseUsers(): UserRec[] {
  return (process.env.CONSOLE_USERS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry): UserRec => {
      const at = entry.indexOf(":");
      if (at < 0) return { email: "", salt: "", hash: "" };
      const email = entry.slice(0, at).toLowerCase();
      const cred = entry.slice(at + 1);
      // A scrypt credential is self-describing, so it occupies both fields:
      // `salt` is what hashPassword needs to recompute the key and `hash` is
      // what the result is compared against. That keeps the {email, salt,
      // hash} shape that callers outside this module already destructure.
      if (cred.startsWith(SCRYPT_PREFIX)) return { email, salt: cred, hash: cred };
      const [salt, hash] = cred.split(":");
      return { email, salt: salt || "", hash: (hash || "").toLowerCase() };
    })
    .filter((u) => u.email && u.salt && u.hash);
}

/** Emails that may currently hold a session. Removing an entry from
 *  CONSOLE_USERS has to end that operator's live sessions (GAP-3.5a), and
 *  lib/sessions consults this to enforce it. */
export function operatorEmails(): Set<string> {
  return new Set(parseUsers().map((u) => u.email));
}

/** Recompute the stored `hash` field for a stored `salt` field, so a caller
 *  can `hashPassword(u.salt, typed) === u.hash`.
 *
 *  For a legacy entry that is literally sha256(salt:password). For a scrypt
 *  entry the only value comparable to the stored credential is the stored
 *  credential itself, so a correct password echoes it back and a wrong one
 *  returns "" — which parseUsers guarantees can never be a stored hash. The
 *  shape is preserved rather than replaced because it is the contract
 *  app/api/clients/[slug]/route.ts uses to re-confirm a deletion. */
export async function hashPassword(salt: string, password: string): Promise<string> {
  if (salt.startsWith(SCRYPT_PREFIX)) return (await verifyScrypt(salt, password)) ? salt : "";
  return sha256Hex(`${salt}:${password}`);
}

/** Constant-shape check: an unknown email is hashed against a real entry's
 *  parameters so the response time does not reveal which addresses exist.
 *  Returns the canonical email on success. */
export async function verifyUser(email: string, password: string): Promise<string | null> {
  const users = parseUsers();
  const target = email.trim().toLowerCase();
  // The decoy borrows the first entry's salt so the KDF cost matches. Its
  // hash is a byte no stored hash can contain, so it can never match.
  const decoy: UserRec = { email: "", salt: users[0]?.salt ?? "decoy", hash: " " };
  const u = users.find((x) => x.email === target) ?? decoy;
  const got = await hashPassword(u.salt, password);
  return u.email && got !== "" && got === u.hash ? u.email : null;
}
