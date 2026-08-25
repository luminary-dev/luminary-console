// GitHub integration configuration, resolved at call time (never at module
// load) so scripts can load .env.local before importing anything here, and so
// a missing credential degrades to a readable error rather than an import
// crash.
//
// Two credential modes, in priority order:
//   1. GitHub App (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + installation) —
//      the supported path. Installation tokens are short-lived and scoped to
//      the org, and the App's permissions are auditable in one place.
//   2. GH_TOKEN, a personal access token — the legacy path this console
//      already used for repo tarballs. It stays supported so the console keeps
//      working before the App is installed, but it is NOT the target: a PAT is
//      tied to a person, carries their whole access, and cannot be scoped per
//      repository the way an installation can.
// Both are read here so the rest of the code never reads process.env directly.

export const GITHUB_API = "https://api.github.com";

/** The org whose repositories this console operates on. */
export const githubOrg = (): string => process.env.GITHUB_ORG || "luminary-dev";

/** API version pin. GitHub dates its REST breaking changes; sending this
 *  header means a future default cannot silently reshape our payloads. */
export const GITHUB_API_VERSION = "2022-11-28";

export type AppCredentials = {
  appId: string;
  privateKey: string;
  /** Optional: pinning the installation avoids a lookup per cold start. */
  installationId?: string;
};

/** App credentials, or null when the App is not configured. */
export function appCredentials(): AppCredentials | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) return null;
  return {
    appId,
    // Private keys are commonly pasted into env vars with literal "\n"
    // sequences instead of real newlines; PEM parsing fails on those with an
    // error that says nothing useful, so normalise here once.
    privateKey: privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey,
    ...(process.env.GITHUB_APP_INSTALLATION_ID
      ? { installationId: process.env.GITHUB_APP_INSTALLATION_ID }
      : {}),
  };
}

/** The legacy personal access token, or null. */
export const personalToken = (): string | null => process.env.GH_TOKEN || null;

/** Whether any GitHub credential at all is available. */
export const githubConfigured = (): boolean =>
  appCredentials() !== null || personalToken() !== null;

/** The webhook shared secret. Absent means we cannot verify a delivery, and
 *  an unverifiable delivery must be rejected rather than trusted. */
export const webhookSecret = (): string | null => process.env.GITHUB_WEBHOOK_SECRET || null;

/**
 * Which GitHub account belongs to which console operator.
 *
 * "Needs my review" and "my pull requests" are worthless without this, and so
 * are per-person notification rules. A full GitHub OAuth login would resolve
 * identity properly and is the eventual target (see the access model in the
 * audit's LC-061), but it is a large change that logs everyone out, whereas
 * this mapping is one env var and covers the same need for a team of three.
 *
 * Format: "console-email:github-login,console-email:github-login".
 * Matching is case-insensitive on both sides because neither GitHub logins
 * nor the operator emails are reliably cased in practice.
 */
export function operatorGithubLogins(): Map<string, string> {
  const raw = process.env.GITHUB_OPERATORS ?? "";
  const map = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const [email, login] = entry.split(":").map((s) => s.trim());
    if (email && login) map.set(email.toLowerCase(), login.toLowerCase());
  }
  return map;
}

/** The GitHub login for a console operator, or null when unmapped. */
export function githubLoginFor(operatorEmail: string): string | null {
  return operatorGithubLogins().get(operatorEmail.trim().toLowerCase()) ?? null;
}

/** Every mapped GitHub login, for fanning a notification out to the team. */
export const knownGithubLogins = (): string[] => [...operatorGithubLogins().values()];

/** How long a webhook delivery may have been in flight before we treat it as
 *  a replay. GitHub retries legitimately for a while, so this is generous;
 *  the point is to bound an attacker replaying a captured body forever. */
export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
