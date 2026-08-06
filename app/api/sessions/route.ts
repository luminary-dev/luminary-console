// Session registry API for the dashboard Sessions card. Authed like every
// other /api/* route — the proxy rejects requests without a valid session
// cookie — so here we only need the caller's own sid/email (to mark "this
// device" and to attribute revocations in the activity log).
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { listSessions, revokeSessions } from "@/lib/sessions";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

async function callerSid(req: Request): Promise<string | null> {
  const token = (req.headers.get("cookie") || "").match(
    new RegExp(`${SESSION_COOKIE}=([^;]+)`),
  )?.[1];
  const session = await verifySessionToken(process.env.SESSION_SECRET || "", token);
  return session?.sid ?? null;
}

export async function GET(req: Request) {
  const sid = await callerSid(req);
  const sessions = await listSessions();
  return NextResponse.json(
    sessions.map((s) => ({ ...s, current: s.sid === sid })),
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const sid = await callerSid(req);
  const body = await req.json().catch(() => ({}));
  const sessions = await listSessions();
  // Actor for the audit log = the caller's registered email (fall back to the
  // generic "operator" if the registry predates this login).
  const actor = sessions.find((s) => s.sid === sid)?.email || "operator";

  if (body.action === "revokeAll") {
    const sids = sessions.map((s) => s.sid);
    await revokeSessions(sids);
    await logActivity(actor, "signed out everywhere", "console", `${sids.length} session(s) revoked`);
    return NextResponse.json({ ok: true, revoked: sids.length, revokedSelf: sid ? sids.includes(sid) : false });
  }

  if (body.action === "revoke" && typeof body.sid === "string") {
    const target = sessions.find((s) => s.sid === body.sid);
    if (!target) return NextResponse.json({ error: "That session no longer exists." }, { status: 404 });
    await revokeSessions([target.sid]);
    await logActivity(actor, "revoked a session", "console", `${target.email} · ${target.ua.slice(0, 80)}`);
    return NextResponse.json({ ok: true, revoked: 1, revokedSelf: target.sid === sid });
  }

  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}
