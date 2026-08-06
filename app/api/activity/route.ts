// Recent audit-log entries for the console activity feed. Authed like every
// other /api/* route — the proxy rejects requests without a session cookie.
import { NextResponse } from "next/server";
import { recentActivity } from "@/lib/activity";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await recentActivity(100));
}
