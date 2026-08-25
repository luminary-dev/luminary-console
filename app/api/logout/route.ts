// Sign out. LC-010: this used to clear the cookie and nothing else, which
// made "Sign out" a local cookie wipe rather than a logout — a cookie copied
// beforehand kept working until the token expired. The sid is now revoked
// server-side, and since the proxy treats the session registry as an
// allowlist, revoking it kills every copy of that cookie everywhere.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { revokeSessions } from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = (req.headers.get("cookie") || "").match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  )?.[1];
  const session = await verifySessionToken(process.env.SESSION_SECRET || "", token);

  let revoked = true;
  if (session) {
    try {
      await revokeSessions([session.sid]);
    } catch (e) {
      // The caller is already navigating away, so this status is for the logs
      // and for anything that does check: the browser's copy of the cookie is
      // gone either way, but the session itself outlived the sign-out and
      // that is exactly the defect this route exists to close.
      console.error("Sign-out could not revoke the session:", e);
      revoked = false;
    }
  }

  // Clearing the cookie happens whatever the store did — never leave the
  // browser holding a session it just asked to end.
  const res = revoked
    ? NextResponse.json({ ok: true })
    : NextResponse.json(
        { error: "Signed out on this device, but the session could not be revoked. Try again." },
        { status: 502 },
      );
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
