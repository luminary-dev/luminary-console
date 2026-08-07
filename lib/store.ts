// Cloudflare R2 (S3-compatible) storage. The exported surface is unchanged
// from the Vercel Blob version it replaces; the mechanics underneath are not.
//
// Blob had no overwrite, so every state write created a random-suffixed copy
// and every read LISTed the prefix to find the newest — 1 read = 1 list + 1
// fetch, 1 write = 1 put + 1 list + N deletes. That amplification is what
// exhausted the plan's operation quota and took the product down. S3/R2 give
// strong read-after-write consistency on a fixed key, so:
//
//   - records/index/counter/state → FIXED keys, one GET to read, one PUT to
//     write. No listing, no pruning, no versions.
//   - assets (doc HTML/PDF, answers, attachments) → unique keys, because the
//     record points at them by URL and old renders must stay reachable. The
//     suffix is generated locally (crypto.randomUUID), never by listing.
//
// The bucket is PRIVATE. `putAsset` returns "/api/asset/<key>" — an
// app-relative URL served by the authed streaming route — and `fetchAsset`
// resolves either that or a bare key straight out of R2 without an HTTP hop.
// Email bodies can't use an authed app URL, so those links go through
// `signedAssetUrl` (presigned GET) instead.
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bucket, r2 } from "./r2";
import { assetKey, assetUrl, STORE_PREFIX } from "./assets";
import type { ClientRecord, IndexEntry } from "./types";

const PREFIX = STORE_PREFIX;

const INDEX_KEY = `${PREFIX}index.json`;
const COUNTER_KEY = `${PREFIX}counter.json`;
const recordKey = (slug: string) => `${PREFIX}clients/${slug}/record.json`;
const stateKey = (path: string) => `${PREFIX}state/${path.replace(/^\/+/, "")}`;

/** Presigned links live at most 7 days — SigV4's hard ceiling. */
export const MAX_SIGNED_TTL = 7 * 24 * 60 * 60;

// ——— short-TTL read cache ———
// PER-INSTANCE, like lib/ratelimit.ts: it collapses the burst of identical
// reads one page render makes (the dashboard reads every record; a portal
// render reads the same record from several places) without pretending to be
// a shared cache. Writes through this module refresh the entry, so a
// read-modify-write inside one instance never sees its own stale copy; a
// write from ANOTHER instance can be up to TTL_MS late, which is why the TTL
// is 5s and only records/index are cached (never the doc-number counter).
const TTL_MS = 5_000;
const cache = new Map<string, { at: number; value: unknown }>();

function cacheGet<T>(key: string): T | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T | null;
}

const cacheSet = (key: string, value: unknown) => cache.set(key, { at: Date.now(), value });

// ——— raw object helpers ———

function isMissing(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

async function getObject(key: string) {
  try {
    return await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (e) {
    if (isMissing(e)) return null;
    throw e; // a real outage must surface, not masquerade as "no such client"
  }
}

async function putObject(key: string, body: string | Buffer | Uint8Array, contentType: string) {
  await r2().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** DeleteObjects caps at 1000 keys per call. */
async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

async function readJson<T>(key: string): Promise<T | null> {
  const res = await getObject(key);
  if (!res?.Body) return null;
  try {
    return JSON.parse(await res.Body.transformToString()) as T;
  } catch {
    return null;
  }
}

const writeJson = (key: string, data: unknown) => putObject(key, JSON.stringify(data), "application/json");

async function readCached<T>(key: string): Promise<T | null> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await readJson<T>(key);
  cacheSet(key, value);
  return value;
}

// ——— assets ———

/** Random suffix before the extension, so two renders of the same document
 *  never collide and older renders (doc history) stay byte-identical. */
function uniqueKey(path: string): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? `${path.slice(0, dot)}-${id}${path.slice(dot)}` : `${path}-${id}`;
}

/** Store an asset (doc HTML / PDF / answers); returns its app-relative URL. */
export async function putAsset(
  pathname: string,
  body: string | Buffer,
  contentType: string,
): Promise<string> {
  const key = uniqueKey(`${PREFIX}${pathname}`);
  await putObject(key, body, contentType);
  return assetUrl(key);
}

export type AssetObject = {
  key: string;
  contentType: string;
  contentLength?: number;
  body: ReadableStream<Uint8Array>;
};

/** Open an asset for streaming. Null when it isn't ours or doesn't exist. */
export async function assetStream(ref: string): Promise<AssetObject | null> {
  const key = assetKey(ref);
  if (!key) return null;
  const res = await getObject(key);
  if (!res?.Body) return null;
  return {
    key,
    contentType: res.ContentType || "application/octet-stream",
    contentLength: res.ContentLength,
    body: res.Body.transformToWebStream(),
  };
}

/** Re-read a stored asset server-side (PDFs for email attachments, answers
 *  JSON, published document HTML). Takes either stored form; an absolute URL
 *  that isn't ours — a legacy Vercel Blob link — falls back to a plain fetch
 *  so old records degrade instead of throwing. */
export async function fetchAsset(url: string): Promise<Response> {
  const key = assetKey(url);
  if (!key) return fetch(url, { cache: "no-store" });
  const res = await getObject(key);
  if (!res?.Body) return new Response(null, { status: 404 });
  const bytes = await res.Body.transformToByteArray();
  return new Response(bytes as unknown as BodyInit, {
    headers: { "Content-Type": res.ContentType || "application/octet-stream" },
  });
}

/** A time-limited DIRECT R2 link. Only for contexts that can't carry a
 *  console session — i.e. email bodies. Never put one on a record. */
export async function signedAssetUrl(ref: string, expiresIn = MAX_SIGNED_TTL): Promise<string | null> {
  const key = assetKey(ref);
  if (!key) return null;
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: Math.min(expiresIn, MAX_SIGNED_TTL),
  });
}

/** Presigned PUT for a browser-direct upload. `contentType` and
 *  `contentLength` are SIGNED, so the browser must send back exactly what the
 *  route validated — that is what keeps the 15 MB cap and the content-type
 *  whitelist real once the URL has left the server. The presigner forces
 *  content-type into `unsignableHeaders` for S3, so it has to be listed as
 *  signable explicitly or the whitelist would be advisory only. */
export async function signedUploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn = 600,
): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
  );
}

/** Best-effort asset deletion (e.g. removing a mistakenly generated doc). */
export async function deleteAssets(urls: string[]): Promise<void> {
  try {
    const keys = [...new Set(urls.map((u) => assetKey(u)).filter((k): k is string => !!k))];
    if (keys.length) await deleteKeys(keys);
  } catch {
    /* best effort */
  }
}

// ——— small JSON state records outside the client tree (OTP, sessions, …) ———

export const readState = <T>(path: string) => readJson<T>(stateKey(path));

export const writeState = (path: string, data: unknown) => writeJson(stateKey(path), data);

export async function clearState(path: string): Promise<void> {
  try {
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: stateKey(path) }));
  } catch {
    /* best effort */
  }
}

// ——— clients ———

export async function getIndex(): Promise<IndexEntry[]> {
  return (await readCached<IndexEntry[]>(INDEX_KEY)) ?? [];
}

export async function getClient(slug: string): Promise<ClientRecord | null> {
  return readCached<ClientRecord>(recordKey(slug));
}

async function writeIndex(index: IndexEntry[]): Promise<void> {
  await writeJson(INDEX_KEY, index);
  cacheSet(INDEX_KEY, index);
}

export async function saveClient(record: ClientRecord): Promise<void> {
  const key = recordKey(record.slug);
  await writeJson(key, record);
  cacheSet(key, record);
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
  await writeIndex(index);
}

/** Delete everything under the client's prefix (record, docs, billing,
 *  answers, attachments) plus its index entry. Returns the object count. */
export async function deleteClient(slug: string): Promise<number> {
  const keys = await listKeys(`${PREFIX}clients/${slug}/`);
  if (keys.length) await deleteKeys(keys);
  cache.delete(recordKey(slug));
  await writeIndex((await getIndex()).filter((e) => e.slug !== slug));
  return keys.length;
}

/** Next shared doc number, zero-padded. Monotonic: a separate counter records
 *  the highest number ever issued, so deleting a client can never cause its
 *  document numbers to be reused (an accounting hazard). Gaps are fine.
 *  Deliberately NOT cached — a stale counter would reuse a number. */
export async function nextDocNoBase(): Promise<string> {
  const index = await getIndex();
  const indexMax = index.reduce((m, e) => Math.max(m, parseInt(e.docNoBase, 10) || 0), 43);
  const counter = (await readJson<{ last: number }>(COUNTER_KEY))?.last ?? 0;
  const next = Math.max(indexMax, counter) + 1;
  await writeJson(COUNTER_KEY, { last: next });
  return String(next).padStart(4, "0");
}

/** Raise the monotonic doc counter to at least `last` (never lowers it).
 *  Used by the eco-mech recreation script to guarantee future numbers stay
 *  above every number ever issued from the lost store. */
export async function seedDocCounter(last: number): Promise<number> {
  const current = (await readJson<{ last: number }>(COUNTER_KEY))?.last ?? 0;
  const next = Math.max(current, Math.floor(last));
  await writeJson(COUNTER_KEY, { last: next });
  return next;
}

export { assetKey, assetUrl } from "./assets";
