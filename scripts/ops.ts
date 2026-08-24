// Console ops runner — invokes the console's own API route handlers directly,
// no HTTP server and no session: the GitHub Actions "ops" workflows check out
// this repo and run exactly the code the console UI calls, with the same
// backend credentials from Actions secrets. Nothing here re-implements a
// route; the path is resolved against app/api/** and the matching handler is
// imported and called with a synthetic Request.
//
//   npx tsx scripts/ops.ts <METHOD> </api/path> [json-body]
//   npx tsx scripts/ops.ts GET  /api/clients
//   npx tsx scripts/ops.ts POST /api/clients/eco-mech/docs/quotation '{"action":"publish"}'
//
// Prints the handler's JSON (or text) response to stdout — stdout carries the
// response ONLY, so workflows can pipe it to jq; diagnostics go to stderr.
// Exits non-zero on a 4xx/5xx response.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(__dirname, "..");
const API_DIR = join(ROOT, "app", "api");

type Match = { file: string; params: Record<string, string> };

// Resolve /api/a/b/c against app/api/**: literal directory first, else the
// single [param] directory — the same matching Next does for these routes.
async function resolve(pathname: string): Promise<Match | null> {
  const segs = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  let dir = API_DIR;
  const params: Record<string, string> = {};
  for (const seg of segs) {
    const literal = join(dir, seg);
    if (existsSync(literal)) {
      dir = literal;
      continue;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    const dyn = entries.find((e) => e.isDirectory() && /^\[\.{0,3}[^\]]+\]$/.test(e.name));
    if (!dyn) return null;
    const name = dyn.name.slice(1, -1);
    if (name.startsWith("...")) {
      // catch-all: the rest of the segments belong to it
      params[name.slice(3)] = segs.slice(segs.indexOf(seg)).join("/");
      dir = join(dir, dyn.name);
      break;
    }
    params[name] = decodeURIComponent(seg);
    dir = join(dir, dyn.name);
  }
  const file = join(dir, "route.ts");
  return existsSync(file) ? { file, params } : null;
}

async function main(): Promise<void> {
  const [method, pathname, body] = process.argv.slice(2);
  if (!method || !pathname?.startsWith("/api/")) {
    console.error("usage: tsx scripts/ops.ts <METHOD> </api/path> [json-body]");
    process.exit(2);
  }

  const match = await resolve(pathname);
  if (!match) {
    console.error(`No route matches ${pathname}`);
    process.exit(2);
  }
  console.error(`→ ${method.toUpperCase()} ${pathname}  (${match.file.replace(ROOT + "/", "")})`);

  const mod = await import(pathToFileURL(match.file).href);
  const handler = mod[method.toUpperCase()];
  if (typeof handler !== "function") {
    console.error(`Route has no ${method.toUpperCase()} handler.`);
    process.exit(2);
  }

  const req = new Request(`https://ops.local${pathname}`, {
    method: method.toUpperCase(),
    headers: { "content-type": "application/json" },
    ...(body ? { body } : {}),
  });
  const res: Response = await handler(req, { params: Promise.resolve(match.params) });
  const text = await res.text();
  console.error(`← ${res.status}`);
  console.log(text);
  if (res.status >= 400) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
