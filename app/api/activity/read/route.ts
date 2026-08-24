import { NextResponse } from "next/server";
import { markNotificationsSeen } from "@/lib/activity";

export const runtime = "nodejs";

// "Mark all as read" on the dashboard's Recent updates card — same effect as
// opening the Activity page. (The proxy's session gate protects this route.)
export async function POST() {
  await markNotificationsSeen();
  return NextResponse.json({ ok: true });
}
