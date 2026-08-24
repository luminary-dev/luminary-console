// The GitHub-Actions execution relay. When OPS_VIA_ACTIONS is on, the proxy
// rewrites every authed business mutation (POST/PATCH/PUT/DELETE under
// /api/clients and /api/publish) here instead of its route. The relay
// dispatches the "Ops: console API" workflow with the original method, path
// and body plus a request id, then long-polls the store for the result the
// runner writes back (scripts/ops.ts) and returns it with the original
// status — so the UI sees exactly the response it always saw, while the
// operation itself ran, visibly, on GitHub Actions.
import { NextResponse } from "next/server";
import { readState, clearState } from "@/lib/store";
import { dispatchOps, opsDispatchConfigured } from "@/lib/ghops";
import { currentOperator } from "@/lib/operator";

export const runtime = "nodejs";
export const maxDuration = 300;

type OpsResult = { status: number; body: string; at: string };

// The business surface the proxy relays — validated again here so a direct
// call can't use the relay to reach arbitrary routes.
const ALLOWED = /^\/api\/(clients|publish)(\/|$)/;
const METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Leave headroom under maxDuration for dispatch + response.
const POLL_DEADLINE_MS = 270_000;
const POLL_EVERY_MS = 2_500;

async function relay(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = url.searchParams.get("path") || "";
  if (!ALLOWED.test(target) || target.startsWith("/api/ops")) {
    return NextResponse.json({ error: "Path not relayable." }, { status: 400 });
  }
  if (!METHODS.has(req.method)) {
    return NextResponse.json({ error: "Method not relayable." }, { status: 405 });
  }
  // Not configured (flag off or no dispatch token): tell opsFetch to fall
  // back to direct execution instead of failing the operation.
  if (process.env.OPS_VIA_ACTIONS !== "1" || !opsDispatchConfigured()) {
    return NextResponse.json(
      { error: "Ops-via-Actions is not configured — execute directly.", fallback: true },
      { status: 503 },
    );
  }

  const body = await req.text();
  const requestId = crypto.randomUUID();
  const resultKey = `ops-results/${requestId}.json`;
  const actor = await currentOperator();

  await dispatchOps({
    method: req.method,
    path: target,
    ...(body ? { body } : {}),
    request_id: requestId,
    actor,
  });

  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    const result = await readState<OpsResult>(resultKey).catch(() => null);
    if (result && typeof result.status === "number") {
      clearState(resultKey).catch(() => {});
      return new Response(result.body, {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return NextResponse.json(
    {
      error:
        "The operation is still running on GitHub Actions — check the Actions tab; the change will land when the run finishes.",
      requestId,
    },
    { status: 504 },
  );
}

export const POST = relay;
export const PATCH = relay;
export const PUT = relay;
export const DELETE = relay;
