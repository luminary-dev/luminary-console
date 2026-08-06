// Vercel Blob-backed storage. Every write creates a new random-suffixed blob
// (immutable URLs — no CDN staleness); reads resolve "latest version" via
// list(prefix) ordered by upload time. Old versions are pruned best-effort.
import { put, list, del } from "@vercel/blob";
import type { ClientRecord, IndexEntry } from "./types";

const PREFIX = "console/";

// New versions are written under "<base>/<ms-timestamp>.json" so "latest" is
// deterministic. Blob's uploadedAt has ONE-SECOND granularity: sorting on it
// made rapid successive writes (publish → unpublish → delete) tie, so reads
// could return a stale version and read-modify-write then resurrected it —
// billing documents were silently lost this way. Legacy "<base>-<rand>.json"
// blobs (no timestamp in the path) still order by uploadedAt.
type Versioned = { pathname: string; uploadedAt: string | Date; url: string };

function versionScore(b: Versioned): number {
  const m = b.pathname.match(/\/(\d{13})[^/]*\.json$/);
  return m ? Number(m[1]) : +new Date(b.uploadedAt);
}

async function latestUrl(pathname: string): Promise<string | null> {
  const prefix = pathname.replace(/\.json$/, "");
  const { blobs } = await list({ prefix, limit: 100 });
  const latest = blobs
    .filter((b) => b.pathname.startsWith(prefix))
    .sort((a, b) => versionScore(b) - versionScore(a));
  return latest[0]?.url ?? null;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const url = await latestUrl(pathname);
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function writeJson(pathname: string, data: unknown): Promise<string> {
  const base = pathname.replace(/\.json$/, "");
  const blob = await put(`${base}/${Date.now()}.json`, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: true, // keeps URLs unguessable
    contentType: "application/json",
  });
  await pruneOld(base);
  return blob.url;
}

// Keeps whatever is newest BY SCORE (not "the version I just wrote"), so a
// prune racing a concurrent writer can never delete the newer version.
async function pruneOld(base: string) {
  try {
    const { blobs } = await list({ prefix: base, limit: 100 });
    const sorted = blobs
      .filter((b) => b.pathname.startsWith(base))
      .sort((a, b) => versionScore(b) - versionScore(a));
    const stale = sorted.slice(1).map((b) => b.url);
    if (stale.length) await del(stale);
  } catch {
    /* best effort */
  }
}

/** Store an asset (doc HTML / PDF); returns its immutable URL. */
export async function putAsset(
  pathname: string,
  body: string | Buffer,
  contentType: string,
): Promise<string> {
  const blob = await put(`${PREFIX}${pathname}`, body, {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });
  return blob.url;
}

export async function fetchAsset(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store" });
}

/** Best-effort blob deletion (e.g. removing a mistakenly generated doc). */
export async function deleteAssets(urls: string[]): Promise<void> {
  try {
    const real = urls.filter(Boolean);
    if (real.length) await del(real);
  } catch {
    /* best effort */
  }
}

// ——— clients ———

export async function getIndex(): Promise<IndexEntry[]> {
  return (await readJson<IndexEntry[]>(`${PREFIX}index.json`)) ?? [];
}

export async function getClient(slug: string): Promise<ClientRecord | null> {
  return readJson<ClientRecord>(`${PREFIX}clients/${slug}/record.json`);
}

export async function saveClient(record: ClientRecord): Promise<void> {
  await writeJson(`${PREFIX}clients/${record.slug}/record.json`, record);
  const index = await getIndex();
  const entry: IndexEntry = {
    slug: record.slug,
    company: record.company,
    status: record.status,
    createdAt: record.createdAt,
    docNoBase: record.docNoBase,
  };
  const i = index.findIndex((e) => e.slug === record.slug);
  if (i >= 0) index[i] = entry;
  else index.push(entry);
  await writeJson(`${PREFIX}index.json`, index);
}

/** Delete a client's blobs and index entry. */
export async function deleteClient(slug: string): Promise<number> {
  const { blobs } = await list({ prefix: `${PREFIX}clients/${slug}/`, limit: 1000 });
  if (blobs.length) await del(blobs.map((b) => b.url));
  const index = (await getIndex()).filter((e) => e.slug !== slug);
  await writeJson(`${PREFIX}index.json`, index);
  return blobs.length;
}

/** Next shared doc number, zero-padded. Monotonic: a separate counter records
 *  the highest number ever issued, so deleting a client can never cause its
 *  document numbers to be reused (an accounting hazard). Gaps are fine. */
export async function nextDocNoBase(): Promise<string> {
  const index = await getIndex();
  const indexMax = index.reduce((m, e) => Math.max(m, parseInt(e.docNoBase, 10) || 0), 43);
  const counter = (await readJson<{ last: number }>(`${PREFIX}counter.json`))?.last ?? 0;
  const next = Math.max(indexMax, counter) + 1;
  await writeJson(`${PREFIX}counter.json`, { last: next });
  return String(next).padStart(4, "0");
}
