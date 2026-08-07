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
