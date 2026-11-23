// The sales board's data: the shop list and the team's shared progress.
// Authed like every other /api/* route: the proxy refuses a request without a
// session cookie. The pages read lib/sales-store directly; this is for the
// board refreshing itself after another operator has been at work.
import { NextResponse } from "next/server";
import { getSalesState } from "@/lib/sales-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getSalesState());
}
