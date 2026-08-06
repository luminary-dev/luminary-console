// Vercel Blob-backed storage. Every write creates a new random-suffixed blob
// (immutable URLs — no CDN staleness); reads resolve "latest version" via
// list(prefix) ordered by upload time. Old versions are pruned best-effort.
import { put, list, del } from "@vercel/blob";
import type { ClientRecord, IndexEntry } from "./types";

const PREFIX = "console/";

async function latestUrl(pathname: string): Promise<string | null> {
  // addRandomSuffix inserts before the extension ("record.json" is stored as
  // "record-<rand>.json"), so list by the extensionless prefix.
  const prefix = pathname.replace(/\.json$/, "");
  const { blobs } = await list({ prefix, limit: 100 });
  const latest = blobs
    .filter((b) => b.pathname.startsWith(prefix))
    .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
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
  const blob = await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: true,
    contentType: "application/json",
  });
  pruneOld(pathname, blob.url); // fire and forget
  return blob.url;
}

async function pruneOld(pathname: string, keepUrl: string) {
  try {
    const prefix = pathname.replace(/\.json$/, "");
    const { blobs } = await list({ prefix, limit: 100 });
    const stale = blobs.filter((b) => b.url !== keepUrl).map((b) => b.url);
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
