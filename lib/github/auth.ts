// GitHub App authentication: a short-lived RS256 JWT signed with the App's
// private key, exchanged for an installation access token scoped to the org.
//
// Installation tokens last an hour. We cache one per installation in module
// scope and refresh it early (see SKEW_MS) rather than waiting for a 401,
// because discovering expiry through a failed mutation is how a "publish"
// silently becomes a no-op. Node's crypto does RS256 natively, so this needs
// no JWT dependency.
import { createSign } from "node:crypto";
import { GITHUB_API, GITHUB_API_VERSION, appCredentials, githubOrg, personalToken } from "./config";

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/** App JWT: `iat` is backdated by a minute because GitHub rejects a token
 *  whose issued-at is in the future, and small clock skew between us and them
 *  is normal. Maximum accepted lifetime is 10 minutes; 9 leaves headroom. */
function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

type CachedToken = { token: string; expiresAt: number };

let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

/** Refresh this long before actual expiry. A request that starts just inside
 *  the window must still finish with a valid token. */
const SKEW_MS = 5 * 60 * 1000;

async function ghJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "luminary-console",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) {
    throw new Error(
      `GitHub App auth failed (${res.status}): ${body?.message ?? "no detail"}`,
    );
  }
  return body as T;
}

/** Resolve the installation id for our org, or use the pinned one. */
async function resolveInstallationId(jwt: string, pinned?: string): Promise<string> {
  if (pinned) return pinned;
  const installation = await ghJson<{ id: number }>(
    `/orgs/${githubOrg()}/installation`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  return String(installation.id);
}

/** A valid installation access token, minted or served from cache.
 *  Concurrent callers share one refresh: without the in-flight promise, a
 *  cold start under load mints a token per concurrent request and burns the
 *  App's own rate limit for no reason. */
export async function installationToken(): Promise<string> {
  const creds = appCredentials();
  if (!creds) throw new Error("The GitHub App is not configured.");

  if (cached && cached.expiresAt - SKEW_MS > Date.now()) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const jwt = appJwt(creds.appId, creds.privateKey);
      const installationId = await resolveInstallationId(jwt, creds.installationId);
      const token = await ghJson<{ token: string; expires_at: string }>(
        `/app/installations/${installationId}/access_tokens`,
        { method: "POST", headers: { Authorization: `Bearer ${jwt}` } },
      );
      const expiresAt = Date.parse(token.expires_at);
      cached = {
        token: token.token,
        // A token whose expiry we cannot read is treated as valid for a
        // conservative 30 minutes rather than trusted for an hour.
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 30 * 60 * 1000,
      };
      return cached.token;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export type Auth = { header: string; kind: "app" | "pat" };

/** The Authorization header value for an API call, preferring the App. */
export async function authHeader(): Promise<Auth> {
  if (appCredentials()) {
    return { header: `Bearer ${await installationToken()}`, kind: "app" };
  }
  const pat = personalToken();
  if (pat) return { header: `Bearer ${pat}`, kind: "pat" };
  throw new Error(
    "No GitHub credentials configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (preferred), or GH_TOKEN.",
  );
}

/** Drop the cached token. Used by the client when a 401 says the token died
 *  early (revoked App, rotated key, suspended installation) so the next call
 *  re-mints instead of replaying a dead credential. */
export function invalidateToken(): void {
  cached = null;
}
