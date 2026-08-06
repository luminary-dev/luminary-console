// Operator accounts. CONSOLE_USERS holds "email:salt:sha256(salt:password)"
// entries, comma-separated — only these emails can log in, and each has its
// own strong password. Web Crypto only (shared with proxy-adjacent code).
const enc = new TextEncoder();

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type UserRec = { email: string; salt: string; hash: string };

export function parseUsers(): UserRec[] {
  return (process.env.CONSOLE_USERS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const [email, salt, hash] = e.split(":");
      return { email: (email || "").toLowerCase(), salt: salt || "", hash: (hash || "").toLowerCase() };
    })
    .filter((u) => u.email && u.salt && u.hash);
}

/** Constant-shape check: hashes even for unknown emails so timing doesn't
 *  reveal which addresses exist. Returns the canonical email on success. */
export async function verifyUser(email: string, password: string): Promise<string | null> {
  const users = parseUsers();
  const target = email.trim().toLowerCase();
  const u = users.find((x) => x.email === target) ?? { email: "", salt: "decoy", hash: "" };
  const got = await sha256Hex(`${u.salt}:${password}`);
  return u.email && got === u.hash ? u.email : null;
}

export const hashPassword = (salt: string, password: string) => sha256Hex(`${salt}:${password}`);
