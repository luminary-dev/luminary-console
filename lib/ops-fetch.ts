"use client";

// Drop-in fetch for console business calls. Mutations (POST/PATCH/PUT/DELETE)
// under /api/clients and /api/publish are routed through /api/ops/relay, which
// executes them on a GitHub Actions runner and returns the route's own
// response — every operation gets a visible run as its receipt. Reads pass
// straight through, and if the relay reports itself unconfigured (no
// CONSOLE_REPO_TOKEN, or OPS_VIA_ACTIONS off) the call falls back to direct
// execution so the console never bricks on missing plumbing.
//
// Expect relayed calls to take noticeably longer than direct ones (runner
// spin-up ≈ 30–60s before the operation itself) — busy states in the UI
// already cover this.

const RELAYABLE = /^\/api\/(clients|publish)(\/|$)/;
const METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export async function opsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = String(init.method || "GET").toUpperCase();
  if (!METHODS.has(method) || !RELAYABLE.test(path)) return fetch(path, init);

  const res = await fetch(`/api/ops/relay?path=${encodeURIComponent(path)}`, init);
  if (res.status === 503) {
    const data = (await res.clone().json().catch(() => null)) as { fallback?: boolean } | null;
    if (data?.fallback) return fetch(path, init);
  }
  return res;
}
