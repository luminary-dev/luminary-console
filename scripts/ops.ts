// Console ops runner — invokes the console's own API route handlers directly,
// no HTTP server and no session: the GitHub Actions "ops" workflows check out
// this repo and run exactly the code the console UI calls, with the same
// backend credentials from Actions secrets. Nothing here re-implements a
// route; scripts/invoke.ts resolves the path against app/** and calls the
// matching handler with a synthetic Request.
//
//   npx tsx scripts/ops.ts <METHOD> </api/path> [json-body]
//   npx tsx scripts/ops.ts GET  /api/clients
//   npx tsx scripts/ops.ts POST /api/clients/eco-mech/docs/quotation '{"action":"publish"}'
//
// Prints the handler's JSON (or text) response to stdout — stdout carries the
// response ONLY, so workflows can pipe it to jq; diagnostics go to stderr.
// Exits non-zero on a 4xx/5xx response.
//
// Relay hand-back: when OPS_REQUEST_ID is set (by ops-run.yml when the
// console UI dispatched the run via /api/ops/relay), the response is written
// to ops-results/<id>.json in the store so the relay can return it.
import { callRoute, resolveRoute } from "./invoke";

async function main(): Promise<void> {
  const [method, pathname, body] = process.argv.slice(2);
  if (!method || !pathname?.startsWith("/api/")) {
    console.error("usage: tsx scripts/ops.ts <METHOD> </api/path> [json-body]");
    process.exit(2);
  }

  const match = await resolveRoute(pathname);
  if (!match) {
    console.error(`No route matches ${pathname}`);
    process.exit(2);
  }
  console.error(`→ ${method.toUpperCase()} ${pathname}`);

  let res;
  try {
    res = await callRoute(method, pathname, body === undefined ? undefined : body);
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
  console.error(`← ${res.status}`);
  console.log(res.text);

  const requestId = process.env.OPS_REQUEST_ID;
  if (requestId && /^[a-f0-9-]{8,64}$/.test(requestId)) {
    try {
      const { writeState } = await import("../lib/store");
      await writeState(`ops-results/${requestId}.json`, {
        status: res.status,
        body: res.text,
        at: new Date().toISOString(),
      });
      console.error(`↳ result stored for relay ${requestId}`);
    } catch (e) {
      console.error("Result hand-back failed:", e);
    }
  }

  if (res.status >= 400) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
