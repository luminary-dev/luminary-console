// Confirmation ping after a device subscribes (proves APNs delivery end to
// end), or a broadcast test when called without an endpoint. Authed by the
// proxy like every /api/* route.
import { NextResponse } from "next/server";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
  const sent = await sendPush(
    {
      title: "🔔 Notifications enabled",
      body: "This device now gets Luminary studio notices.",
      url: "/",
      tag: "push-test",
    },
    endpoint ? { endpoint } : undefined,
  );
  return NextResponse.json({ ok: sent > 0, sent });
}
