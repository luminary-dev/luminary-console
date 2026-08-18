// Subdomain automation: a Cloudflare CNAME (<label>.luminary-dev.xyz →
// cname.vercel-dns.com) plus attaching the hostname to a Vercel project. Used
// two ways: per-client PORTAL subdomains attach to the console's own project
// (VERCEL_PROJECT_ID); a delivered client SITE attaches its own subdomain to
// the client's separate Vercel project (by project name). Both are
// optional-but-automated: with tokens absent the caller degrades to manual.

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";

type DnsResult = { status: "automated" | "manual_required" | "error"; detail: string };

async function cloudflareCname(label: string): Promise<string> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("manual:CLOUDFLARE_API_TOKEN not set");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${ROOT}`, { headers });
    const data = await res.json();
    zoneId = data?.result?.[0]?.id;
    if (!zoneId) throw new Error(`Cloudflare zone for ${ROOT} not found`);
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "CNAME",
      name: label,
      content: "cname.vercel-dns.com",
      proxied: false,
      ttl: 1,
      comment: "luminary-console",
    }),
  });
  const data = await res.json();
  if (!data.success) {
    const codes = (data.errors ?? []).map((e: { code: number }) => e.code);
    if (codes.some((c: number) => [81053, 81057, 81058].includes(c))) return "cname exists";
    throw new Error(`Cloudflare: ${JSON.stringify(data.errors)}`);
  }
  return "cname created";
}

async function vercelAddDomain(host: string, projectIdOrName: string): Promise<string> {
  const token = process.env.VERCEL_TOKEN;
  if (!token || !projectIdOrName) throw new Error("manual:VERCEL_TOKEN / project not set");

  const teamId = process.env.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectIdOrName}/domains${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: host }),
  });
  if (res.ok) return "domain attached";
  const data = await res.json().catch(() => null);
  const code = data?.error?.code;
  if (code === "domain_already_in_use" || code === "domain_already_exists") return "domain already attached";
  throw new Error(`Vercel domains: ${res.status} ${JSON.stringify(data?.error)}`);
}

/** Ensure a subdomain (label.ROOT) resolves and is attached to a Vercel
 *  project. `projectIdOrName` defaults to the console's own project. */
export async function ensureSubdomain(
  label: string,
  projectIdOrName = process.env.VERCEL_PROJECT_ID ?? "",
): Promise<DnsResult> {
  const host = `${label}.${ROOT}`;
  try {
    const cf = await cloudflareCname(label);
    const vc = await vercelAddDomain(host, projectIdOrName);
    return { status: "automated", detail: `${cf}; ${vc}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("manual:")) {
      return {
        status: "manual_required",
        detail: `Add CNAME "${label}" → cname.vercel-dns.com in Cloudflare (DNS only) and attach ${host} to the Vercel project. Missing: ${msg.slice(7)}`,
      };
    }
    return { status: "error", detail: msg };
  }
}

/** Tear down a subdomain: Cloudflare CNAME + the Vercel project's domain. */
export async function removeSubdomain(
  label: string,
  projectIdOrName = process.env.VERCEL_PROJECT_ID ?? "",
): Promise<string[]> {
  const host = `${label}.${ROOT}`;
  const notes: string[] = [];

  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (cfToken && zoneId) {
    try {
      const headers = { Authorization: `Bearer ${cfToken}` };
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${host}`, { headers });
      const data = await res.json();
      for (const rec of data?.result ?? []) {
        await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${rec.id}`, { method: "DELETE", headers });
        notes.push("cloudflare record deleted");
      }
      if (!(data?.result ?? []).length) notes.push("no cloudflare record");
    } catch (e) {
      notes.push(`cloudflare: ${String(e)}`);
    }
  } else {
    notes.push("cloudflare token missing — remove CNAME manually");
  }

  const vToken = process.env.VERCEL_TOKEN;
  if (vToken && projectIdOrName) {
    try {
      const teamId = process.env.VERCEL_TEAM_ID;
      const qs = teamId ? `?teamId=${teamId}` : "";
      const res = await fetch(`https://api.vercel.com/v9/projects/${projectIdOrName}/domains/${host}${qs}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${vToken}` },
      });
      notes.push(res.ok ? "vercel domain detached" : `vercel: ${res.status}`);
    } catch (e) {
      notes.push(`vercel: ${String(e)}`);
    }
  } else {
    notes.push("vercel token missing — detach domain manually");
  }

  return notes;
}

/** Per-client PORTAL subdomain: attaches to the console's own Vercel project. */
export const ensureClientDomain = (slug: string): Promise<DnsResult> => ensureSubdomain(slug);
export const removeClientDomain = (slug: string): Promise<string[]> => removeSubdomain(slug);
