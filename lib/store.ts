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

/** How many times a compare-and-swap re-reads and retries before giving up. */
const CAS_ATTEMPTS = 5;

// ——— typed errors ———

/** The object is there but its bytes could not be read or parsed as JSON.
 *  This exists so a failed read can never be mistaken for "empty": feeding an
 *  unreadable index back into a write as [] is what truncated the whole
 *  client list (LC-001). Callers that genuinely want a null fallback (the
 *  small state files) keep using readState, which stays lenient. */
export class StoreReadError extends Error {
  readonly key: string;
  constructor(key: string, cause?: unknown) {
    super(
      `Store read failed for ${key}: the object exists but is not readable as JSON of the expected shape.`,
      { cause },
    );
    this.name = "StoreReadError";
    this.key = key;
  }
}

/** A conditional write kept losing the race and ran out of attempts. The write
 *  did NOT land. Surfacing this is the point: silently overwriting the other
 *  writer, or silently dropping our own change, is the bug (LC-002). */
export class StoreConflictError extends Error {
  readonly key: string;
  readonly attempts: number;
  constructor(key: string, attempts: number, cause?: unknown) {
    super(`Store write for ${key} lost a concurrent-write race after ${attempts} attempt(s).`, { cause });
    this.name = "StoreConflictError";
    this.key = key;
    this.attempts = attempts;
  }
}

// ——— short-TTL read cache ———
// PER-INSTANCE, like lib/ratelimit.ts: it collapses the burst of identical
// reads one page render makes (the dashboard reads every record; a portal
// render reads the same record from several places) without pretending to be
// a shared cache. Writes through this module refresh the entry, so a
// read-modify-write inside one instance never sees its own stale copy; a
// write from ANOTHER instance can be up to TTL_MS late, which is why the TTL
// is 5s and only records/index are cached (never the doc-number counter).
const TTL_MS = 5_000;

/** What one read saw: the parsed value, whether the object existed at all, and
 *  the ETag of the exact bytes it came from. The ETag is the whole point of
 *  carrying a snapshot around instead of a bare value: it goes back out as
 *  `If-Match`, so a write can only land on the version it read. */
type JsonSnapshot<T> = { value: T | null; etag?: string; present: boolean };

const cache = new Map<string, { at: number; snap: JsonSnapshot<unknown> }>();

function cacheGet<T>(key: string): JsonSnapshot<T> | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.snap as JsonSnapshot<T>;
}

const cacheSet = (key: string, snap: JsonSnapshot<unknown>) => cache.set(key, { at: Date.now(), snap });

// ——— raw object helpers ———

function isMissing(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

/** A failed `If-Match` / `If-None-Match`. R2 answers 412; S3 can answer 409
 *  (ConditionalRequestConflict) when two conditional writes overlap. Both mean
 *  the same thing to us: someone else moved the object, re-read and retry. */
function isConflict(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = err?.$metadata?.httpStatusCode;
  return (
    status === 412 ||
    status === 409 ||
    err?.name === "PreconditionFailed" ||
    err?.name === "ConditionalRequestConflict"
  );
}

/** The GetObject response carries the ETag, so every read can hand its caller
 *  the version it saw. */
async function getObject(key: string) {
  try {
    return await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (e) {
    if (isMissing(e)) return null;
    throw e; // a real outage must surface, not masquerade as "no such client"
  }
}

/** `IfMatch` pins the write to one ETag; `IfNoneMatch: "*"` makes it a create
 *  that fails if anything is already there. R2 supports both on PutObject. */
type PutConditions = { IfMatch?: string; IfNoneMatch?: string };

/** Returns the new ETag so a read-modify-write can keep its snapshot current
 *  without a follow-up GET. */
async function putObject(
  key: string,
  body: string | Buffer | Uint8Array,
  contentType: string,
  conditions?: PutConditions,
): Promise<string | undefined> {
  const res = await r2().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ...conditions,
    }),
  );
  return res.ETag;
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

/** LENIENT read: unparsable bytes come back as null, exactly as before. This
 *  is what the small state files want, and only they still use it: a missing
 *  activity log and a corrupt one are both "start from nothing" there, and
 *  every caller already writes the whole file back. */
async function readJson<T>(key: string): Promise<T | null> {
  const res = await getObject(key);
  if (!res?.Body) return null;
  try {
    return JSON.parse(await res.Body.transformToString()) as T;
  } catch {
    return null;
  }
}

const writeJson = async (key: string, data: unknown) => {
  await putObject(key, JSON.stringify(data), "application/json");
};

/** STRICT read: "never written" and "there but unreadable" are different
 *  answers. Only the second one throws. */
async function readSnapshotFresh<T>(key: string): Promise<JsonSnapshot<T>> {
  const res = await getObject(key);
  if (!res?.Body) return { value: null, present: false };
  try {
    const value = JSON.parse(await res.Body.transformToString()) as T;
    // Omit rather than store undefined: a snapshot without an etag is the
    // signal that a CAS write must fall back to If-None-Match.
    return { value, ...(res.ETag !== undefined ? { etag: res.ETag } : {}), present: true };
  } catch (e) {
    throw new StoreReadError(key, e);
  }
}

type ReadOptions = {
  /** Skip the cache for this read. A CAS retry must, or it would compare
   *  against the very ETag the store just rejected and spin. */
  fresh?: boolean;
  /** Opt out of the cache entirely, in both directions (the doc-number
   *  counter: a stale read there reuses a number). */
  cache?: boolean;
};

async function readSnapshot<T>(key: string, opts: ReadOptions = {}): Promise<JsonSnapshot<T>> {
  const cacheable = opts.cache !== false;
  if (cacheable && !opts.fresh) {
    const hit = cacheGet<T>(key);
    if (hit) return hit;
  }
  const snap = await readSnapshotFresh<T>(key);
  if (cacheable) cacheSet(key, snap);
  return snap;
}

// ——— compare-and-swap ———

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Small exponential backoff with jitter, so two racers do not re-collide in
 *  lockstep on every attempt. */
const backoffMs = (attempt: number) => 5 * 2 ** attempt + Math.random() * 5;

export type UpdateJsonOptions = {
  /** Bounded retries before StoreConflictError. Default 5. */
  attempts?: number;
  /** Read through the 5s cache on the first attempt. Default true. */
  cache?: boolean;
};

/** Read-modify-write one JSON object atomically.
 *
 *  `mutate` gets what is actually stored right now (null when the object does
 *  not exist) and returns the whole replacement. The write carries `If-Match`
 *  on the ETag that was read, so it lands only if nothing changed underneath;
 *  a losing attempt re-reads FRESH and calls `mutate` again against the newer
 *  value, which is why the other writer's change survives instead of being
 *  overwritten. An object that does not exist yet is created with
 *  `If-None-Match: "*"`, so two racing creators cannot both think they were
 *  first.
 *
 *  `mutate` must therefore be a pure function of `current`: it can run several
 *  times, and only the last run is kept. */
export async function updateJson<T>(
  key: string,
  mutate: (current: T | null) => T,
  opts: UpdateJsonOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? CAS_ATTEMPTS);
  const cacheable = opts.cache !== false;
  let lastConflict: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const snap = await readSnapshot<T>(key, { cache: cacheable, fresh: attempt > 0 });
    const next = mutate(snap.value);

    let conditions: PutConditions;
    if (!snap.present) {
      conditions = { IfNoneMatch: "*" };
    } else if (snap.etag) {
      conditions = { IfMatch: snap.etag };
    } else {
      // S3 and R2 always return an ETag, so this is unreachable in practice.
      // Degrading to the old unconditional write beats bricking every mutation
      // if some proxy ever strips the header, but it must be visible.
      console.warn(`updateJson: no ETag for ${key}, writing without a precondition.`);
      conditions = {};
    }

    try {
      const etag = await putObject(key, JSON.stringify(next), "application/json", conditions);
      if (cacheable) cacheSet(key, { value: next, ...(etag !== undefined ? { etag } : {}), present: true });
      return next;
    } catch (e) {
      if (!isConflict(e)) throw e;
      lastConflict = e;
      cache.delete(key); // the cached ETag is provably stale now
      if (attempt < attempts - 1) await sleep(backoffMs(attempt));
    }
  }

  throw new StoreConflictError(key, attempts, lastConflict);
}

// ——— bounded fan-out ———

/** Default parallelism for reading many objects in one go.
 *
 *  Every list surface reads one object per client: the dashboard, the CSV
 *  export, the weekly backup, the daily digest, global search. Doing that with
 *  an unbounded `Promise.all` over the index opens one R2 connection per
 *  client simultaneously (fine at five clients, a connection storm and a
 *  memory spike at a thousand), and doing it in a plain `for` loop pays one
 *  full round trip per client in series. Eight keeps the round trips
 *  overlapping while the fan-out stays flat as the org grows (LC-030/LC-033). */
export const READ_CONCURRENCY = 8;

/** Run `fn` over `items` with at most `limit` in flight, results in input
 *  order. Same worker-pool shape as the file uploader in lib/deploy.ts. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T, i);
      }
    }),
  );
  return out;
}

/** Read many client records at a bounded fan-out. Order matches `slugs`, and a
 *  missing or unreadable record is null, exactly as `getClient` answers. */
export const getClients = (
  slugs: readonly string[],
  limit = READ_CONCURRENCY,
): Promise<(ClientRecord | null)[]> => mapLimit(slugs, limit, (slug) => getClient(slug));

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
    ...(res.ContentLength !== undefined ? { contentLength: res.ContentLength } : {}),
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
  // Stream instead of buffering the whole object first (LC-033). Several
  // callers hand this response straight back out (the console preview and the
  // portal document routes), so the bytes never need to exist in this
  // process's heap at all; the callers that do want bytes still get them from
  // `.arrayBuffer()`, which is the only thing that changes for them: they pay
  // for the copy, and nobody else does.
  return new Response(res.Body.transformToWebStream() as unknown as BodyInit, {
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

/** Compare-and-swap for a state file. Prefer this over readState + mutate +
 *  writeState anywhere two requests can touch the same file at once (OTP
 *  attempt counters, push subscriptions, the activity log). Unlike readState
 *  it is strict about a parse failure: a read-modify-write that treats an
 *  unreadable file as empty is LC-001 wearing a different hat. */
export const updateState = <T>(
  path: string,
  mutate: (current: T | null) => T,
  opts?: UpdateJsonOptions,
) => updateJson<T>(stateKey(path), mutate, opts);

/** Every state key under a path prefix, e.g. listState("github/deliveries/"),
 *  as full bucket keys. One object per item beats one shared array whenever
 *  writers arrive in bursts, and this is how such a collection is enumerated.
 *  Never cached: the point is to see a key the moment it is written. A real
 *  outage throws (an empty listing must mean empty, never "the list failed"). */
export const listState = (prefix: string) => listKeys(stateKey(prefix));

export async function clearState(path: string): Promise<void> {
  try {
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: stateKey(path) }));
  } catch {
    /* best effort */
  }
}

// ——— clients ———

/** The index is a denormalised copy of every record header, so an empty one is
 *  a claim that the studio has no clients. That claim is only ever allowed to
 *  come from an index object that has never been written. If the object is
 *  there and will not parse, or parses to something that is not an array, this
 *  throws: the alternative is every list surface reporting nothing, and the
 *  next saveClient persisting that nothing (LC-001). */
export async function getIndex(): Promise<IndexEntry[]> {
  return readIndex();
}

async function readIndex(opts: ReadOptions = {}): Promise<IndexEntry[]> {
  const snap = await readSnapshot<IndexEntry[]>(INDEX_KEY, opts);
  if (!snap.present) return [];
  return assertIndex(snap.value);
}

function assertIndex(value: IndexEntry[] | null): IndexEntry[] {
  if (!Array.isArray(value)) throw new StoreReadError(INDEX_KEY);
  return value;
}

export async function getClient(slug: string): Promise<ClientRecord | null> {
  try {
    return (await readSnapshot<ClientRecord>(recordKey(slug))).value;
  } catch (e) {
    // A record that will not parse has always surfaced as "no such client",
    // and every route already answers 404 to that. It stays lenient because,
    // unlike the index, a null here ends the request rather than being fed
    // back into a write.
    if (e instanceof StoreReadError) return null;
    throw e;
  }
}

/** The record plus the ETag it was read at, for callers that want to hand it
 *  back to saveClient and have their write rejected rather than silently
 *  overwrite whatever landed in between. Deliberately uncached: an ETag is
 *  only useful if it describes the current bytes. */
export async function getClientWithEtag(
  slug: string,
): Promise<{ record: ClientRecord | null; etag?: string }> {
  const snap = await readSnapshot<ClientRecord>(recordKey(slug), { fresh: true });
  return { record: snap.value, ...(snap.etag !== undefined ? { etag: snap.etag } : {}) };
}

/** Every index mutation goes through here, so it is always a compare-and-swap
 *  against the stored index rather than an overwrite with a copy read earlier. */
async function updateIndex(mutate: (index: IndexEntry[]) => IndexEntry[]): Promise<void> {
  await updateJson<IndexEntry[]>(INDEX_KEY, (current) => mutate(assertIndex(current ?? [])));
}

export type SaveClientOptions = {
  /** ETag the caller read this record at (from getClientWithEtag). When set,
   *  the record write becomes a compare-and-swap and a concurrent edit fails
   *  loudly instead of one of the two changes vanishing. Omitted by the
   *  existing call sites, which keep last-write-wins on the record itself. */
  expectedEtag?: string;
};

export async function saveClient(record: ClientRecord, opts: SaveClientOptions = {}): Promise<void> {
  // Read the index BEFORE writing anything, and read it fresh: if it is
  // unreadable the save has to fail here, while the store is still
  // consistent, and a cached copy from up to 5s ago cannot prove that. The
  // read fills the cache, so the compare-and-swap below still costs no
  // second GET. Writing the record first would leave a client that no list
  // surface can see.
  await readIndex({ fresh: true });

  const key = recordKey(record.slug);
  let etag: string | undefined;
  try {
    etag = await putObject(
      key,
      JSON.stringify(record),
      "application/json",
      opts.expectedEtag ? { IfMatch: opts.expectedEtag } : undefined,
    );
  } catch (e) {
    cache.delete(key);
    // No retry: the caller's mutation cannot be re-applied from here, only
    // reported. One attempt, and the record is left as the other writer left it.
    if (isConflict(e)) throw new StoreConflictError(key, 1, e);
    throw e;
  }
  cacheSet(key, { value: record, ...(etag !== undefined ? { etag } : {}), present: true });

  const entry: IndexEntry = {
    slug: record.slug,
    company: record.company,
    status: record.status,
    createdAt: record.createdAt,
    docNoBase: record.docNoBase,
  };
  await updateIndex((index) => {
    const i = index.findIndex((e) => e.slug === record.slug);
    if (i >= 0) return index.map((e, n) => (n === i ? entry : e));
    return [...index, entry];
  });
}

/** Delete everything under the client's prefix (record, docs, billing,
 *  answers, attachments) plus its index entry. Returns the object count. */
export async function deleteClient(slug: string): Promise<number> {
  // Same order of operations as saveClient: prove the index is readable before
  // destroying anything, so a corrupt index cannot strand orphaned entries.
  await readIndex({ fresh: true });
  const keys = await listKeys(`${PREFIX}clients/${slug}/`);
  if (keys.length) await deleteKeys(keys);
  cache.delete(recordKey(slug));
  await updateIndex((index) => index.filter((e) => e.slug !== slug));
  return keys.length;
}

/** Next shared doc number, zero-padded. Monotonic: a separate counter records
 *  the highest number ever issued, so deleting a client can never cause its
 *  document numbers to be reused (an accounting hazard). Gaps are fine.
 *  Deliberately NOT cached — a stale counter would reuse a number.
 *
 *  The increment is a compare-and-swap, which is what actually makes it
 *  monotonic: two creations racing on a cold instance used to read the same
 *  `last` and be issued the same number. Now the loser re-reads the number the
 *  winner wrote and takes the one after it. */
export async function nextDocNoBase(): Promise<string> {
  const index = await getIndex();
  const indexMax = index.reduce((m, e) => Math.max(m, parseInt(e.docNoBase, 10) || 0), 43);
  const counter = await updateJson<{ last: number }>(
    COUNTER_KEY,
    (current) => ({ last: Math.max(indexMax, current?.last ?? 0) + 1 }),
    { cache: false },
  );
  return String(counter.last).padStart(4, "0");
}

/** Raise the monotonic doc counter to at least `last` (never lowers it).
 *  Used by the eco-mech recreation script to guarantee future numbers stay
 *  above every number ever issued from the lost store. */
export async function seedDocCounter(last: number): Promise<number> {
  const counter = await updateJson<{ last: number }>(
    COUNTER_KEY,
    (current) => ({ last: Math.max(current?.last ?? 0, Math.floor(last)) }),
    { cache: false },
  );
  return counter.last;
}

export { assetKey, assetUrl } from "./assets";
