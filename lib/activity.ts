// Append-only audit log. One JSON array in store state ("activity.json" via
// readState/writeState, one fixed key overwritten in place), capped to the last
// 500 entries. Logging is strictly best-effort: a failure here must never
// break the action being logged, so every write is wrapped and swallowed.
import { readState, writeState } from "./store";

export type ActivityEntry = {
  /** ISO timestamp. */
  at: string;
  /** Operator email where the session knows it, "operator" otherwise, or the
   *  client contact's name for portal-side actions. */
  actor: string;
  /** Past-tense verb phrase, e.g. "published quotation". */
  action: string;
  /** What it happened to — usually a client slug, or "console" for logins. */
  target: string;
  detail?: string;
};

const PATH = "activity.json";
const CAP = 500;

/** Append one entry (best-effort — never throws). */
export async function logActivity(
  actor: string,
  action: string,
  target: string,
  detail?: string,
): Promise<void> {
  try {
    const entries = (await readState<ActivityEntry[]>(PATH)) ?? [];
    entries.push({
      at: new Date().toISOString(),
      actor,
      action,
      target,
      ...(detail ? { detail } : {}),
    });
    await writeState(PATH, entries.slice(-CAP));
  } catch (e) {
    console.error("Activity log write failed:", e);
  }
}

/** Actions that originate from a client on their portal (not operator work) —
 *  the things admins want to be notified about. */
export const CLIENT_ACTIONS = new Set([
  "accepted quotation",
  "submitted questionnaire",
  "asked about a document",
  "uploaded a file",
]);

/** Is this a client-initiated portal event (vs an operator/console action)? */
export function isClientEvent(e: ActivityEntry): boolean {
  return CLIENT_ACTIONS.has(e.action) && e.target !== "console";
}

// A single shared "admins have looked" marker for the client-activity feed.
// Global (not per-admin) — opening Activity clears the badge for the team.
const NOTIF_PATH = "notifications.json";

/** ISO time the client-activity feed was last marked seen ("" if never). */
export async function getNotificationsSeenAt(): Promise<string> {
  try {
    const s = await readState<{ seenAt?: string }>(NOTIF_PATH);
    return s?.seenAt ?? "";
  } catch {
    return "";
  }
}

/** Mark the client-activity feed seen as of now (best-effort — never throws). */
export async function markNotificationsSeen(): Promise<void> {
  try {
    await writeState(NOTIF_PATH, { seenAt: new Date().toISOString() });
  } catch (e) {
    console.error("Notifications seen write failed:", e);
  }
}

/** Most recent entries, newest first (best-effort — returns [] on failure). */
export async function recentActivity(limit = 100): Promise<ActivityEntry[]> {
  try {
    const entries = (await readState<ActivityEntry[]>(PATH)) ?? [];
    return entries.slice(-limit).reverse();
  } catch (e) {
    console.error("Activity log read failed:", e);
    return [];
  }
}
