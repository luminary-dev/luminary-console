// Public liveness / readiness probe (AUDIT.md OPS-12).
//
// /api/ping is an authed no-op that only slides session expiry, so external
// uptime monitoring had no way to see whether the deployment was up and its
// dependencies reachable without a session cookie. This route is exempt from
// the proxy session gate (see proxy.ts) and returns no secrets.
//
//   GET /api/health          liveness — always 200 {ok:true} unless the process
//                            itself is down, so a monitor can alert on it.
//   GET /api/health?deep=1   readiness — also does one shallow, time-boxed R2
//                            read; 200 when the store answers, 503 when it does
//                            not, so a monitor can distinguish "app up but
//                            storage unreachable" from a clean outage.
import { NextResponse } from "next/server";
import { getIndex } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const DEEP_TIMEOUT_MS = 3_000;

export async function GET(req: Request) {
  const at = new Date().toISOString();
  const deep = new URL(req.url).searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json({ ok: true, at }, { headers: noStore });
  }

  // Shallow dependency check: prove the store is reachable with one index read,
  // time-boxed so a hung R2 can't hold the probe open. No detail leaks — just
  // "ok" or "error" — so this is safe on a public endpoint.
  let store: "ok" | "error" = "ok";
  try {
    await Promise.race([
      getIndex(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DEEP_TIMEOUT_MS)),
    ]);
  } catch {
    store = "error";
  }

  return NextResponse.json(
    { ok: store === "ok", at, store },
    { status: store === "ok" ? 200 : 503, headers: noStore },
  );
}
