// Vercel deployment automation for delivered client SITES. Given a GitHub repo
// in the org, POST /v13/deployments creates (or reuses) a Vercel project and
// builds it; poll /v13/deployments/<id> until READY for the live URL. Requires
// VERCEL_TOKEN and the GitHub integration connected to the Vercel team with
// access to the org. Raw HTTP (same pattern as lib/domains) — no SDK.

const API = "https://api.vercel.com";
const teamQs = () => (process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "");

export type ParsedRepo = { org: string; name: string };

/** Accepts a full GitHub URL, "org/name", or an SSH URL → {org, name}. */
export function parseRepo(input: string): ParsedRepo | null {
  const s = (input || "").trim().replace(/\.git$/, "");
  let m = s.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i); // URL or SSH
  if (!m) m = s.match(/^([\w.-]+)\/([\w.-]+)$/); // bare org/name
  if (!m) return null;
  return { org: m[1], name: m[2] };
}

/** Deployment state, normalized. */
export type DeployState = "QUEUED" | "INITIALIZING" | "BUILDING" | "READY" | "ERROR" | "CANCELED";

export type DeployResult = { id: string; state: DeployState; url?: string; inspectorUrl?: string };

function requireToken(): string {
  const t = process.env.VERCEL_TOKEN;
  if (!t) throw new Error("manual:VERCEL_TOKEN not set");
  return t;
}

const asState = (s: unknown): DeployState => {
  const v = String(s || "").toUpperCase();
  return (["QUEUED", "INITIALIZING", "BUILDING", "READY", "ERROR", "CANCELED"] as const).includes(v as DeployState)
    ? (v as DeployState)
    : "QUEUED";
};

/** Trigger a production deployment of a GitHub repo into project `projectName`
 *  (created on first deploy). Returns the deployment id + initial state. */
export async function deployRepo(opts: { org: string; name: string; ref: string; projectName: string }): Promise<DeployResult> {
  const token = requireToken();
  const res = await fetch(`${API}/v13/deployments${teamQs()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: opts.projectName,
      target: "production",
      gitSource: { type: "github", repo: opts.name, ref: opts.ref, org: opts.org },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Vercel deploy failed (${res.status}): ${JSON.stringify(data?.error ?? data)?.slice(0, 300)}`);
  }
  return {
    id: data.id ?? data.uid,
    state: asState(data.readyState ?? data.status),
    url: data.url ? `https://${data.url}` : undefined,
    inspectorUrl: data.inspectorUrl,
  };
}

/** Current state + URL of a deployment. */
export async function deploymentStatus(id: string): Promise<DeployResult> {
  const token = requireToken();
  const res = await fetch(`${API}/v13/deployments/${id}${teamQs()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Vercel status failed (${res.status})`);
  return {
    id,
    state: asState(data.readyState ?? data.status),
    url: data.url ? `https://${data.url}` : undefined,
    inspectorUrl: data.inspectorUrl,
  };
}
