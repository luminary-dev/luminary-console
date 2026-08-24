// Device push registration for the installed console app. Authed like every
// other /api/* route — the proxy rejects requests without a session cookie.
//
//   GET    → { configured, publicKey }  (what the browser needs to subscribe)
//   POST   { subscription }             → store/refresh this device
//   DELETE { endpoint }                 → forget this device
import { NextResponse } from "next/server";
import { removeSubscription, saveSubscription, vapidPublicKey } from "@/lib/push";
import { currentOperator } from "@/lib/operator";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

export async function GET() {
  const publicKey = vapidPublicKey();
  return NextResponse.json({ configured: Boolean(publicKey), publicKey });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }
  const operator = await currentOperator();
  const device = String(body?.device || "").slice(0, 80);
  await saveSubscription(
    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    [operator, device].filter(Boolean).join(" · "),
  );
  await logActivity(operator, "enabled push notifications", "console", device || undefined);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  }
  await removeSubscription(endpoint);
  await logActivity(await currentOperator(), "disabled push notifications", "console");
  return NextResponse.json({ ok: true });
}
