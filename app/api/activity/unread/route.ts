// How many updates the signed-in team has not seen yet: the number on History
// in the menu. Behind the session gate like every /api route (proxy.ts). The
// menu asks for it after a page is up, so no screen waits on this read.
import { NextResponse } from "next/server";
import { loadUnreadActivity } from "@/lib/console-overview";

export const dynamic = "force-dynamic";

export async function GET() {
  const { unread } = await loadUnreadActivity();
  return NextResponse.json({ unread }, { headers: { "Cache-Control": "no-store" } });
}
