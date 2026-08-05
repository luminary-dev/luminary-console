import { NextResponse } from "next/server";
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const expected = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!expected || !secret) {
    return NextResponse.json({ error: "Auth not configured." }, { status: 503 });
  }
  if (typeof password !== "string" || password !== expected) {
    // Small constant delay to blunt brute force.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  const token = await makeSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
