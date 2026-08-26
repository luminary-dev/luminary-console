// The one GitHub API client. Everything that talks to GitHub goes through
// here so the hard parts are solved once:
//
//   - conditional requests (ETag) so unchanged resources cost no rate budget
//   - correct cursor pagination, including GitHub's early Link termination
//   - primary vs secondary rate limits with differentiated backoff
//   - retry with jitter on transient failures, including the 502 GitHub
//     returns on large queries
//   - a circuit breaker so a GitHub outage degrades instead of hanging every
//     request behind a 60 second backoff
//   - request coalescing so N concurrent identical GETs cost one call
//   - a request log carrying the rate limit headers, for the budget UI
//
// GraphQL vs REST: list views that would be N+1 over REST (a PR list that
// needs review state and check status per PR) use one GraphQL query instead.
// Single-resource reads and every mutation use REST, because REST's errors
// are specific and its permissions map to the App's declared scopes. Each
// call site says which it uses and why.
import { GITHUB_API, GITHUB_API_VERSION } from "./config";
import { authHeader, invalidateToken } from "./auth";
import { backoffMs, classifyLimit, recordRateLimit } from "./ratelimit";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly documentationUrl?: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Raised when the breaker is open, so callers can render a degraded state
 *  instead of a spinner that never resolves. */
export class GitHubUnavailableError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("The GitHub API is temporarily unavailable.");
    this.name = "GitHubUnavailableError";
  }
}

// ——— circuit breaker ———
// Consecutive hard failures open the breaker; while open every call fails
// fast. One trial request is allowed through after the cooldown (half-open),
// and a success closes it.
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let breakerOpenedAt = 0;

function breakerOpen(): boolean {
  if (consecutiveFailures < BREAKER_THRESHOLD) return false;
  if (Date.now() - breakerOpenedAt >= BREAKER_COOLDOWN_MS) return false; // half-open trial
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  breakerOpenedAt = 0;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures === BREAKER_THRESHOLD) breakerOpenedAt = Date.now();
}

/** Test seam. */
export function __resetBreaker(): void {
  consecutiveFailures = 0;
  breakerOpenedAt = 0;
  etags.clear();
  inFlight.clear();
}

// ——— ETag cache ———
// Per instance, like the store's read cache: it collapses repeat reads within
// an instance's life without pretending to be shared. A 304 costs no rate
// budget, which is the entire point.
type CacheEntry = { etag: string; body: unknown; storedAt: number };
const etags = new Map<string, CacheEntry>();
const ETAG_CACHE_MAX = 500;

// ——— request coalescing ———
const inFlight = new Map<string, Promise<GitHubResponse<unknown>>>();

export type GitHubResponse<T> = {
  data: T;
  status: number;
  headers: Headers;
  /** True when the response was served from our ETag cache (HTTP 304). */
  fromCache: boolean;
};

export type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Conditional requests are only safe for GETs; ignored otherwise. */
  conditional?: boolean;
  /** Total attempts including the first. */
  attempts?: number;
  /** Accept header override, e.g. for raw diffs. */
  accept?: string;
  signal?: AbortSignal;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Requests that a retry cannot make worse. A POST that created a review is
 *  not safe to blindly repeat, so only idempotent verbs auto-retry. */
const RETRY_SAFE = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

async function execute<T>(path: string, opts: RequestOptions): Promise<GitHubResponse<T>> {
  const method = (opts.method ?? "GET").toUpperCase();
  const attempts = opts.attempts ?? 3;
  const conditional = opts.conditional !== false && method === "GET";
  const cacheKey = `${method} ${path}`;

  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (breakerOpen()) {
      throw new GitHubUnavailableError(
        Math.max(0, BREAKER_COOLDOWN_MS - (Date.now() - breakerOpenedAt)),
      );
    }

    const auth = await authHeader();
    const cached = conditional ? etags.get(cacheKey) : undefined;
    const headers: Record<string, string> = {
      Authorization: auth.header,
      Accept: opts.accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "luminary-console",
    };
    if (cached) headers["If-None-Match"] = cached.etag;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${GITHUB_API}${path}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (e) {
      // Network-level failure. Abort is the caller's intent, not a fault.
      if ((e as Error)?.name === "AbortError") throw e;
      lastError = e;
      recordFailure();
      if (attempt < attempts - 1 && RETRY_SAFE.has(method)) {
        await sleep(backoffMs(null, attempt, new Headers()));
        continue;
      }
      throw e;
    }

    recordRateLimit(res.headers);

    // 304: our cached body is still current, and this cost no rate budget.
    if (res.status === 304 && cached) {
      recordSuccess();
      return { data: cached.body as T, status: 304, headers: res.headers, fromCache: true };
    }

    if (res.ok) {
      recordSuccess();
      const isEmpty = res.status === 204 || res.headers.get("content-length") === "0";
      let data: unknown = null;
      if (!isEmpty) {
        const text = await res.text();
        if (text) {
          // A body that is not JSON (GitHub occasionally answers HTML from an
          // edge error page) must surface as a typed failure, not as a parse
          // exception three layers up.
          if (opts.accept && !opts.accept.includes("json")) {
            data = text;
          } else {
            try {
              data = JSON.parse(text);
            } catch {
              throw new GitHubError(
                "GitHub returned a non-JSON body where JSON was expected.",
                res.status,
                path,
              );
            }
          }
        }
      }
      const etag = res.headers.get("etag");
      if (conditional && etag) {
        if (etags.size >= ETAG_CACHE_MAX) {
          // Cheap eviction: drop the oldest inserted key. Map preserves
          // insertion order, so the first key is the oldest.
          const oldest = etags.keys().next().value;
          if (oldest !== undefined) etags.delete(oldest);
        }
        etags.set(cacheKey, { etag, body: data, storedAt: Date.now() });
      }
      return { data: data as T, status: res.status, headers: res.headers, fromCache: false };
    }

    // ——— failure paths ———
    const text = await res.text().catch(() => "");
    let message = res.statusText;
    let documentationUrl: string | undefined;
    try {
      const parsed = JSON.parse(text) as { message?: string; documentation_url?: string };
      if (parsed?.message) message = parsed.message;
      documentationUrl = parsed?.documentation_url;
    } catch {
      if (text) message = text.slice(0, 300);
    }

    // A 401 on an installation token means it died early: drop it so the next
    // attempt re-mints rather than replaying a dead credential.
    if (res.status === 401) invalidateToken();

    const limit = classifyLimit(res.status, res.headers, message);
    const retryable =
      limit !== null ||
      res.status === 502 || // GitHub answers 502 on large queries
      res.status === 503 ||
      res.status === 504 ||
      (res.status === 401 && attempt === 0); // one re-mint attempt

    if (retryable && attempt < attempts - 1 && (RETRY_SAFE.has(method) || limit !== null)) {
      // A rate limit is not a service fault: it must not open the breaker,
      // or a busy hour would look like an outage.
      if (limit === null) recordFailure();
      await sleep(backoffMs(limit, attempt, res.headers));
      continue;
    }

    if (limit === null) recordFailure();
    throw new GitHubError(message, res.status, path, documentationUrl);
  }

  throw lastError instanceof Error
    ? lastError
    : new GitHubError("GitHub request failed.", 500, path);
}

/** One REST call. Concurrent identical GETs share a single request. */
export function gh<T>(path: string, opts: RequestOptions = {}): Promise<GitHubResponse<T>> {
  const method = (opts.method ?? "GET").toUpperCase();
  if (method !== "GET") return execute<T>(path, opts);

  const key = `GET ${path}${opts.accept ? ` ${opts.accept}` : ""}`;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<GitHubResponse<T>>;

  const promise = execute<T>(path, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, promise as Promise<GitHubResponse<unknown>>);
  return promise;
}

/** Convenience: the body only. */
export async function ghData<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await gh<T>(path, opts)).data;
}

/**
 * Follow cursor pagination to the end.
 *
 * GitHub paginates with a Link header. Two behaviours make a naive loop
 * wrong, and both are in the mandate's edge case list:
 *
 *   1. The Link header can stop early: the last page simply has no rel="next",
 *      so a loop keyed on "did I get a full page?" over-runs and refetches
 *      page 1 forever. Always follow rel="next", never synthesise page+1.
 *   2. Very large result sets are capped by GitHub. `max` bounds our own
 *      appetite so one enormous repo cannot spend the whole rate budget.
 */
export async function ghPaginate<T>(
  path: string,
  opts: RequestOptions & { max?: number } = {},
): Promise<T[]> {
  const max = opts.max ?? 1000;
  const out: T[] = [];
  let next: string | null = path;

  while (next && out.length < max) {
    const res: GitHubResponse<T[]> = await gh<T[]>(next, opts);
    const page = res.data;
    if (!Array.isArray(page)) {
      throw new GitHubError("Expected a list from a paginated endpoint.", res.status, next);
    }
    out.push(...page);
    next = parseNextLink(res.headers.get("link"));
  }

  return out.slice(0, max);
}

/** Extract the rel="next" target, relative to the API root, or null. */
export function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const target = part.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
    if (!target) continue;
    try {
      const url = new URL(target);
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  return null;
}

/** One GraphQL query. Used for list views that would be N+1 over REST.
 *  GraphQL reports errors with HTTP 200, so a body-level error check is not
 *  optional here. */
export async function ghGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await gh<{ data?: T; errors?: { message: string; type?: string }[] }>(
    "/graphql",
    { method: "POST", body: { query, variables }, conditional: false },
  );
  const first = res.data?.errors?.[0];
  if (first) {
    throw new GitHubError(
      `GraphQL: ${first.message}`,
      // RATE_LIMITED arrives as a 200 with an error body; map it back to
      // something the caller's error handling recognises.
      first.type === "RATE_LIMITED" ? 429 : 422,
      "/graphql",
    );
  }
  if (!res.data?.data) {
    throw new GitHubError("GraphQL returned no data.", 502, "/graphql");
  }
  return res.data.data;
}
