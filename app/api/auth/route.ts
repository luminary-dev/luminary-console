// Two-step login: email+password (allowlisted operators only) → 6-digit code
// emailed to that address → session cookie. The step between them is a short
// HMAC "pending" cookie so the code can only be redeemed by the same browser.
import { NextResponse } from "next/server";
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { verifyUser } from "@/lib/users";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { emailAddresses } from "@/lib/email";

export const runtime = "nodejs";

const PENDING_COOKIE = "lum_pending";
const PENDING_MAX_AGE = 10 * 60;

const enc = new TextEncoder();
async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

async function makePending(secret: string, email: string): Promise<string> {
  const exp = Date.now() + PENDING_MAX_AGE * 1000;
  const body = `${b64(email)}.${exp}`;
  return `${body}.${await hmac(secret, `otp.${body}`)}`;
}
async function readPending(secret: string, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [e, exp, sig] = token.split(".");
  if (!e || !exp || !sig || Number(exp) < Date.now()) return null;
  if ((await hmac(secret, `otp.${e}.${exp}`)) !== sig) return null;
  return unb64(e);
}

export async function POST(req: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "Auth not configured." }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  // ——— step 2: redeem the emailed code ———
  if (typeof body.code === "string") {
    const cookie = req.headers.get("cookie") || "";
    const token = cookie.match(new RegExp(`${PENDING_COOKIE}=([^;]+)`))?.[1];
    const email = await readPending(secret, token);
    if (!email) {
      return NextResponse.json({ error: "Login expired — start again." }, { status: 401 });
    }
    const result = await verifyOtp(email, body.code);
    if (result !== "ok") {
      await new Promise((r) => setTimeout(r, 800));
      const msg = result === "locked"
        ? "Too many wrong codes — start the login again for a fresh code."
        : result === "expired"
          ? "That code has expired — start the login again."
          : "Wrong code — check the email and try again.";
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, await makeSessionToken(secret), {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: SESSION_MAX_AGE, path: "/",
    });
    res.cookies.set(PENDING_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });
    return res;
  }

  // ——— step 1: email + password ———
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const verified = await verifyUser(email, password);
  if (!verified) {
    await new Promise((r) => setTimeout(r, 800));
    // One generic message: don't reveal which emails exist.
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }
  const issued = await issueOtp(verified);
  if ("retryInMs" in issued) {
    return NextResponse.json(
      { ok: true, step: "otp", note: `A code was already sent — wait ${Math.ceil(issued.retryInMs / 1000)}s to resend.` },
    );
  }
  const sent = await emailAddresses(
    [verified],
    `${issued.code} is your Luminary Console code`,
    `<p>Your one-time sign-in code:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:.2em">${issued.code}</p>
<p>It expires in 10 minutes and works once. If you didn't try to sign in to the Luminary Console, change your password.</p>`,
  );
  if (!sent) return NextResponse.json({ error: "Couldn't send the code — try again." }, { status: 502 });
  const res = NextResponse.json({ ok: true, step: "otp" });
  res.cookies.set(PENDING_COOKIE, await makePending(secret, verified), {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: PENDING_MAX_AGE, path: "/",
  });
  return res;
}
