// Session registry + revocation list, store-backed like all console state.
//
// - "console/sessions.json": every OTP redemption appends {sid, email, ua, at}
//   (cap 50, entries older than the 24h absolute session cap are pruned on
//   write — their tokens can't be valid anymore).
// - "console/revoked.json": sids whose tokens must stop working. proxy.ts
//   checks it with a 60s module-scope cache, so revocation takes effect
//   within a minute without a store read per request.
//
// Writes are sequential per the store's contract (no concurrency control);
// registry updates are best-effort — a store hiccup must never block a login.
import { readState, writeState } from "./store";
import { SESSION_ABS_MAX_AGE } from "./auth";

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

/** Record a fresh login (best-effort — never blocks the sign-in). */
export async function registerSession(sid: string, email: string, ua: string): Promise<void> {
  try {
    const all = (await readState<SessionEntry[]>(SESSIONS_PATH)) ?? [];
    const kept = all.filter((s) => Date.parse(s.at) > liveSince());
    kept.push({ sid, email, ua: ua.slice(0, 300), at: new Date().toISOString() });
    await writeState(SESSIONS_PATH, kept.slice(-CAP));
  } catch (e) {
    console.error("Session registry write failed:", e);
  }
}

/** Currently revoked sids (raw — proxy caches this for 60s). */
export async function revokedSids(): Promise<string[]> {
  const all = (await readState<RevokedEntry[]>(REVOKED_PATH)) ?? [];
  return all.filter((r) => Date.parse(r.at) > liveSince()).map((r) => r.sid);
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
