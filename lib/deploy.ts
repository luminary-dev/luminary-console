// Vercel deployment automation for delivered client SITES — the CLI's method,
// not the GitHub integration: fetch the repo's files (GitHub tarball API) and
// UPLOAD them to Vercel to build, using VERCEL_TOKEN. This avoids the
// Vercel<->GitHub OAuth integration entirely; private repos just need a GitHub
// token (GH_TOKEN, a fine-grained PAT with read access to the org). Public
// repos need no token. Raw HTTP + Node zlib/crypto — a tiny in-memory untar.
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const API = "https://api.vercel.com";
const teamQs = () => (process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "");

export type ParsedRepo = { org: string; name: string };

/** Accepts a full GitHub URL, "org/name", or an SSH URL → {org, name}. */
export function parseRepo(input: string): ParsedRepo | null {
  const s = (input || "").trim().replace(/\.git$/, "");
  let m = s.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i);
  if (!m) m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  const [, org, name] = m;
  if (!org || !name) return null;
  return { org, name };
}

export type DeployState = "QUEUED" | "INITIALIZING" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
export type DeployResult = { id: string; state: DeployState; url?: string; inspectorUrl?: string };

const asState = (s: unknown): DeployState => {
  const v = String(s || "").toUpperCase();
  return (["QUEUED", "INITIALIZING", "BUILDING", "READY", "ERROR", "CANCELED"] as const).includes(v as DeployState)
    ? (v as DeployState)
    : "QUEUED";
};

function vercelToken(): string {
  const t = process.env.VERCEL_TOKEN;
  if (!t) throw new Error("manual:VERCEL_TOKEN not set");
  return t;
}

// ——— minimal in-memory tar extraction (GitHub .tar.gz) ———

type TarFile = { path: string; data: Buffer };

const readOctal = (buf: Buffer, off: number, len: number): number => {
  const s = buf.toString("ascii", off, off + len).replace(/\0.*$/, "").trim();
  return s ? parseInt(s, 8) : 0;
};

/** Extract regular files from a (gunzipped) tar buffer. Strips the single
 *  top-level folder GitHub wraps the archive in. Skips dirs + pax/global
 *  headers. Handles ustar name+prefix. */
export function untar(tar: Buffer): TarFile[] {
  const out: TarFile[] = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    // Two consecutive zero blocks mark the end.
    if (header.every((b) => b === 0)) break;
    const name = header.toString("ascii", 0, 100).replace(/\0.*$/, "");
    const prefix = header.toString("ascii", 345, 500).replace(/\0.*$/, "");
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48); // '0' default
    off += 512;
    const dataStart = off;
    off += Math.ceil(size / 512) * 512; // advance past the (padded) data
    if (type === "0" || type === "\0" || type === "7") {
      const full = prefix ? `${prefix}/${name}` : name;
      out.push({ path: full, data: tar.subarray(dataStart, dataStart + size) });
    }
    // dirs ('5'), pax ('x','g'), GNU long ('L','K'), symlinks etc. are skipped.
  }
  // Strip the leading "org-repo-sha/" folder every GitHub tarball has.
  const top = out[0]?.path.split("/")[0];
  return out
    .map((f) => ({ path: top && f.path.startsWith(top + "/") ? f.path.slice(top.length + 1) : f.path, data: f.data }))
    .filter((f) => f.path && !f.path.endsWith("/"));
}

/** Download + extract a repo at a ref via the GitHub tarball API. */
async function fetchRepoFiles(org: string, name: string, ref: string): Promise<TarFile[]> {
  const token = process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "luminary-console",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${org}/${name}/tarball/${ref}`, { headers, redirect: "follow" });
  if (res.status === 404) throw new Error(`manual:repo ${org}/${name}@${ref} not found (or GH_TOKEN lacks access)`);
  if (res.status === 401 || res.status === 403) throw new Error("manual:GH_TOKEN missing or lacks read access to the repo");
  if (!res.ok) throw new Error(`GitHub tarball failed (${res.status})`);
  const gz = Buffer.from(await res.arrayBuffer());
  const files = untar(gunzipSync(gz));
  if (!files.length) throw new Error("Repo archive was empty.");
  return files;
}

/** Upload one file's bytes to Vercel's file store, keyed by its sha1. */
async function uploadFile(token: string, data: Buffer): Promise<{ sha: string; size: number }> {
  const sha = createHash("sha1").update(data).digest("hex");
  const res = await fetch(`${API}/v2/files${teamQs()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "x-vercel-digest": sha,
    },
    body: new Uint8Array(data),
  });
  if (!res.ok && res.status !== 409) {
    // 409 = already uploaded (same sha) — fine.
    throw new Error(`Vercel file upload failed (${res.status})`);
  }
  return { sha, size: data.length };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  // One shared iterator hands each worker the next index/element pair, so the
  // element is carried with its index instead of being re-looked-up by number.
  const queue = items.entries();
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (const [idx, item] of queue) {
        out[idx] = await fn(item);
      }
    }),
  );
  return out;
}

/** Deploy a GitHub repo to project `projectName` by uploading its files (the
 *  CLI's method — no Vercel<->GitHub integration). Returns id + initial state. */
export async function deployRepo(opts: { org: string; name: string; ref: string; projectName: string }): Promise<DeployResult> {
  const token = vercelToken();
  const repoFiles = await fetchRepoFiles(opts.org, opts.name, opts.ref);

  // Pair each upload result with its own path inside the worker, rather than
  // re-joining two arrays by index afterwards.
  const files = await mapLimit(repoFiles, 8, async (f) => {
    const { sha, size } = await uploadFile(token, f.data);
    return { file: f.path, sha, size };
  });

  const res = await fetch(`${API}/v13/deployments${teamQs()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: opts.projectName,
      target: "production",
      files,
      projectSettings: { framework: null }, // let Vercel auto-detect (Next.js etc.)
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Vercel deploy failed (${res.status}): ${JSON.stringify(data?.error ?? data)?.slice(0, 300)}`);
  return {
    id: data.id ?? data.uid,
    state: asState(data.readyState ?? data.status),
    ...(data.url ? { url: `https://${data.url}` } : {}),
    ...(data.inspectorUrl ? { inspectorUrl: String(data.inspectorUrl) } : {}),
  };
}

/** Current state + URL of a deployment. */
export async function deploymentStatus(id: string): Promise<DeployResult> {
  const token = vercelToken();
  const res = await fetch(`${API}/v13/deployments/${id}${teamQs()}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Vercel status failed (${res.status})`);
  return {
    id,
    state: asState(data.readyState ?? data.status),
    ...(data.url ? { url: `https://${data.url}` } : {}),
    ...(data.inspectorUrl ? { inspectorUrl: String(data.inspectorUrl) } : {}),
  };
}
