// Session registry + revocation list, store-backed like all console state.
//
// - "console/sessions.json": every OTP redemption appends {sid, email, ua, at}
//   (cap 50, entries older than the 24h absolute session cap are pruned on
//   write — their tokens can't be valid anymore).
// - "console/revoked.json": sids whose tokens must stop working. It is folded
//   into liveSids() below, which proxy.ts caches for 60s, so revocation takes
//   effect within a minute without a store read per request.
//
// Since LC-010 the registry is an ALLOWLIST, not just a denylist: a token is
// only accepted while its sid is still listed here. See liveSids().
//
// Writes are sequential per the store's contract (no concurrency control);
// registry updates are best-effort — a store hiccup must never block a login.
import { readState, writeState } from "./store";
import { SESSION_ABS_MAX_AGE } from "./auth";
import { operatorEmails } from "./users";

export type SessionEntry = { sid: string; email: string; ua: string; at: string };
export type RevokedEntry = { sid: string; at: string };

const SESSIONS_PATH = "sessions.json";
const REVOKED_PATH = "revoked.json";
const CAP = 50;

const liveSince = () => Date.now() - SESSION_ABS_MAX_AGE * 1000;

/** All registered sessions, newest first (best-effort — [] on failure). */
export async function listSessions(): Promise<SessionEntry[]> {
  try {
    const all = (await readState<SessionEntry[]>(SESSIONS_PATH)) ?? [];
    return all
      .filter((s) => Date.parse(s.at) > liveSince()) // expired tokens are dead weight
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch (e) {
    console.error("Session registry read failed:", e);
    return [];
  }
}

/** Record a fresh login (best-effort — never blocks the sign-in).
 *  One entry per device: signing in again from the same browser (same email +
 *  user-agent) REPLACES that device's previous session rather than appending a
 *  new one, so the Sessions card shows a stable row per device instead of a
 *  new "session" on every sign-in (e.g. after an idle sign-out). Sessions on
 *  other devices are left untouched. */
export async function registerSession(sid: string, email: string, ua: string): Promise<void> {
  try {
    const cleanUa = ua.slice(0, 300);
    const all = (await readState<SessionEntry[]>(SESSIONS_PATH)) ?? [];
    const kept = all.filter(
      (s) =>
        Date.parse(s.at) > liveSince() && // drop expired
        !(s.email === email && s.ua === cleanUa), // drop this device's previous session
    );
    kept.push({ sid, email, ua: cleanUa, at: new Date().toISOString() });
    await writeState(SESSIONS_PATH, kept.slice(-CAP));
  } catch (e) {
    console.error("Session registry write failed:", e);
  }
}

/** Sids that may still authenticate a request, i.e. the proxy's allowlist.
 *
 *  A sid qualifies only if it is (a) registered here by a real OTP redemption,
 *  (b) not revoked, (c) inside the 24h absolute session cap, and (d) owned by
 *  an email that is STILL in CONSOLE_USERS. (d) is GAP-3.5a: taking an
 *  operator out of the allowlist has to end their live sessions, not just
 *  stop future logins.
 *
 *  This THROWS when the store is unreachable rather than returning [], so the
 *  caller can tell "nobody is signed in" from "I cannot tell" and choose its
 *  own failure mode. proxy.ts fails open on the second. */
export async function liveSids(): Promise<string[]> {
  const [sessions, revoked] = await Promise.all([
    readState<SessionEntry[]>(SESSIONS_PATH),
    readState<RevokedEntry[]>(REVOKED_PATH),
  ]);
  const dead = new Set((revoked ?? []).map((r) => r.sid));
  const operators = operatorEmails();
  return (sessions ?? [])
    .filter(
      (s) =>
        Date.parse(s.at) > liveSince() &&
        !dead.has(s.sid) &&
        operators.has((s.email || "").toLowerCase()),
    )
    .map((s) => s.sid);
}

/** Revoke sids: add to the revocation list and drop them from the registry.
 *  Revocations older than the 24h token cap are pruned (nothing to revoke). */
export async function revokeSessions(sids: string[]): Promise<void> {
  if (!sids.length) return;
  const now = new Date().toISOString();
  const revoked = ((await readState<RevokedEntry[]>(REVOKED_PATH)) ?? []).filter(
    (r) => Date.parse(r.at) > liveSince(),
  );
  const have = new Set(revoked.map((r) => r.sid));
  for (const sid of sids) if (!have.has(sid)) revoked.push({ sid, at: now });
  await writeState(REVOKED_PATH, revoked.slice(-200));
  const sessions = (await readState<SessionEntry[]>(SESSIONS_PATH)) ?? [];
  const gone = new Set(sids);
  await writeState(SESSIONS_PATH, sessions.filter((s) => !gone.has(s.sid)));
}
