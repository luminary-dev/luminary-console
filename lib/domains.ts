// Per-client subdomain automation: a Cloudflare CNAME (<slug>.luminary-dev.xyz
// → cname.vercel-dns.com) plus attaching the hostname to this Vercel project.
// Both are optional-but-automated: with tokens absent the client still works
// via the console preview, and the record says what to do manually.

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";

type DnsResult = { status: "automated" | "manual_required" | "error"; detail: string };

async function cloudflareCname(slug: string): Promise<string> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("manual:CLOUDFLARE_API_TOKEN not set");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${ROOT}`,
      { headers },
    );
    const data = await res.json();
    zoneId = data?.result?.[0]?.id;
    if (!zoneId) throw new Error(`Cloudflare zone for ${ROOT} not found`);
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "CNAME",
        name: slug,
        content: "cname.vercel-dns.com",
        proxied: false,
        ttl: 1,
        comment: "luminary-console client site",
      }),
    },
  );
  const data = await res.json();
  if (!data.success) {
    // 81053/81057/81058 = a record with that host already exists — that's fine.
    const codes = (data.errors ?? []).map((e: { code: number }) => e.code);
    if (codes.some((c: number) => [81053, 81057, 81058].includes(c))) return "cname exists";
    throw new Error(`Cloudflare: ${JSON.stringify(data.errors)}`);
  }
  return "cname created";
}

async function vercelAddDomain(host: string): Promise<string> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) throw new Error("manual:VERCEL_TOKEN / VERCEL_PROJECT_ID not set");

  const teamId = process.env.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/domains${qs}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: host }),
    },
  );
  if (res.ok) return "domain attached";
  const data = await res.json().catch(() => null);
  const code = data?.error?.code;
  if (code === "domain_already_in_use" || code === "domain_already_exists") {
    return "domain already attached";
  }
  throw new Error(`Vercel domains: ${res.status} ${JSON.stringify(data?.error)}`);
}

export async function ensureClientDomain(slug: string): Promise<DnsResult> {
  const host = `${slug}.${ROOT}`;
  try {
    const cf = await cloudflareCname(slug);
    const vc = await vercelAddDomain(host);
    return { status: "automated", detail: `${cf}; ${vc}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("manual:")) {
      return {
        status: "manual_required",
        detail: `Add CNAME "${slug}" → cname.vercel-dns.com in Cloudflare (DNS only) and attach ${host} to the Vercel project. Missing: ${msg.slice(7)}`,
      };
    }
    return { status: "error", detail: msg };
  }
}
