// Who is doing this? Resolves the signed-in admin's email from the session
// cookie (sid) via the session registry, so the activity log attributes each
// action to the actual admin instead of a generic "operator". Request-scoped
// (uses next/headers cookies) and strictly best-effort — never throws, falls
// back to "operator" so logging can't break the action.
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./auth";
import { listSessions } from "./sessions";
import { logActivity } from "./activity";

/** The signed-in admin's email, or "operator" if it can't be resolved. */
export async function currentOperator(): Promise<string> {
  // Ops runs on GitHub Actions: ops-run.yml sets OPS_ACTOR (per-process, one
  // operation per run) to the admin who dispatched from the console, so the
  // activity log keeps its attribution even though there is no session there.
  if (process.env.OPS_ACTOR) return process.env.OPS_ACTOR;
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = await verifySessionToken(process.env.SESSION_SECRET || "", token);
    if (!session) return "operator";
    const entry = (await listSessions()).find((s) => s.sid === session.sid);
    return entry?.email || "operator";
  } catch {
    return "operator";
  }
}

/** Log an operator action attributed to the current admin. */
export async function logOperatorActivity(
  action: string,
  target: string,
  detail?: string,
): Promise<void> {
  await logActivity(await currentOperator(), action, target, detail);
}
