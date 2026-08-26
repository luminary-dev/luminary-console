// Shared route invoker: resolves an app-router path against app/** and calls
// that route handler in-process with a synthetic Request — the engine behind
// scripts/ops.ts (GitHub Actions ops) and scripts/tests/* (the QA suites).
// Handles /api/** and the public /c/** routes alike.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(__dirname, "..");
const APP_DIR = join(ROOT, "app");

export type Match = { file: string; params: Record<string, string | string[]> };

// Literal directory first, else the single [param] directory — the same
// matching Next does for these routes. A [...catchall] swallows the rest and,
// exactly like Next, its param is a string ARRAY (the asset route joins it).
export async function resolveRoute(pathname: string): Promise<Match | null> {
  const segs = pathname.split("/").filter(Boolean);
  let dir = APP_DIR;
  const params: Record<string, string | string[]> = {};
  for (const [i, seg] of segs.entries()) {
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
      params[name.slice(3)] = segs.slice(i).map(decodeURIComponent);
      dir = join(dir, dyn.name);
      break;
    }
    params[name] = decodeURIComponent(seg);
    dir = join(dir, dyn.name);
  }
  const file = join(dir, "route.ts");
  return existsSync(file) ? { file, params } : null;
}

export type CallResult = {
  status: number;
  text: string;
  json: Record<string, unknown> | null;
  headers: Record<string, string>;
};

/** Invoke METHOD <path> with an optional JSON body (object or raw string). */
export async function callRoute(
  method: string,
  pathname: string,
  body?: unknown,
  query?: Record<string, string>,
  headers?: Record<string, string>,
): Promise<CallResult> {
  const match = await resolveRoute(pathname.split("?")[0] ?? pathname);
  if (!match) throw new Error(`No route matches ${pathname}`);
  // The path is resolved by resolveRoute against our own app/ directory and
  // is never attacker-controlled, so this dynamic import is safe.
  // eslint-disable-next-line no-unsanitized/method
  const mod = await import(pathToFileURL(match.file).href);
  const handler = mod[method.toUpperCase()];
  if (typeof handler !== "function") {
    throw new Error(`${pathname} has no ${method.toUpperCase()} handler`);
  }
  const url = new URL(`https://ops.local${pathname}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const req = new Request(url, {
    method: method.toUpperCase(),
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    ...(payload !== undefined ? { body: payload } : {}),
  });
  const res: Response = await handler(req, { params: Promise.resolve(match.params) });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A non-JSON response body is normal here (HTML, PDF); callers use .text.
  }
  return {
    status: res.status,
    text,
    json,
    headers: Object.fromEntries(res.headers.entries()),
  };
}
