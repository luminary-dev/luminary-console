// Weekly ops cron (vercel.json schedules it Mondays 03:00 UTC):
//   1. Backup — zips the client index + every client record (JSON only, no
//      PDFs: those re-render from the records) and emails it to the studio.
//   2. DNS health — verifies each client's Cloudflare CNAME still exists and
//      the subdomain is still attached to the Vercel project; any mismatch
//      is emailed as a warning.
//
// Auth: the proxy deliberately lets /api/cron/* through its session gate;
// THIS route's bearer check is the only guard. Vercel Cron automatically
// sends "Authorization: Bearer <CRON_SECRET>" when that env var exists, and
// manual runs can send the same header.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getIndex, getClients, mapLimit } from "@/lib/store";
import { buildZip, type ZipFile } from "@/lib/zip";
import { emailStudio } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { esc } from "@/lib/templates/shell";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";

/** Parallel DNS lookups per provider. Deliberately lower than the store's
 *  read concurrency: these are third-party APIs with their own rate limits,
 *  and the point is only to stop the check being one round trip per client in
 *  series across two providers (LC-030). */
const DNS_CONCURRENCY = 4;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Constant-time compare: this bearer is the route's ONLY guard (the proxy
  // waves /api/cron/* past the session gate) and the route is public.
  const got = Buffer.from(req.headers.get("authorization") || "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

// ——— DNS health ———

type DnsIssue = { slug: string; host: string; problem: string };

async function checkCloudflare(slugs: string[]): Promise<DnsIssue[]> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    return [{ slug: "—", host: "—", problem: "Cloudflare check skipped (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set)" }];
  }
  const found = await mapLimit(slugs, DNS_CONCURRENCY, async (slug): Promise<DnsIssue | null> => {
    const host = `${slug}.${ROOT}`;
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${host}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json();
      if (!data?.success) return { slug, host, problem: `Cloudflare API error (${res.status})` };
      const records: { type: string; content: string }[] = data.result ?? [];
      const cname = records.find((r) => r.type === "CNAME");
      if (!cname) return { slug, host, problem: "no CNAME record in Cloudflare" };
      if (!/vercel-dns/.test(cname.content)) {
        return { slug, host, problem: `CNAME points at "${cname.content}" instead of cname.vercel-dns.com` };
      }
      return null;
    } catch (e) {
      return { slug, host, problem: `Cloudflare check failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
  return found.filter((i): i is DnsIssue => i !== null);
}

async function checkVercelDomains(slugs: string[]): Promise<DnsIssue[]> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return [{ slug: "—", host: "—", problem: "Vercel domain check skipped (VERCEL_TOKEN / VERCEL_PROJECT_ID not set)" }];
  }
  const teamId = process.env.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  const found = await mapLimit(slugs, DNS_CONCURRENCY, async (slug): Promise<DnsIssue | null> => {
    const host = `${slug}.${ROOT}`;
    try {
      const res = await fetch(
        `https://api.vercel.com/v9/projects/${projectId}/domains/${host}${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 404) return { slug, host, problem: "domain no longer attached to the Vercel project" };
      if (!res.ok) return { slug, host, problem: `Vercel API error (${res.status})` };
      return null;
    } catch (e) {
      return { slug, host, problem: `Vercel check failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
  return found.filter((i): i is DnsIssue => i !== null);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ——— 1. backup zip ———
    const index = await getIndex();
    const files: ZipFile[] = [{ name: "index.json", data: JSON.stringify(index, null, 2) }];
    // A backup is by definition every record, so the read stays complete; it
    // is the fan-out that is bounded now rather than one round trip per
    // client in series (LC-030).
    const records = await getClients(index.map((e) => e.slug));
    index.forEach((entry, i) => {
      const record = records[i];
      if (record) {
        files.push({ name: `clients/${entry.slug}/record.json`, data: JSON.stringify(record, null, 2) });
      }
    });
    const zip = buildZip(files);
    const stamp = new Date().toISOString().slice(0, 10);
    const delivered = await emailStudio(
      `Console backup · ${stamp} (${index.length} client${index.length === 1 ? "" : "s"})`,
      `<p>Weekly automatic backup of the Luminary Console attached.</p>
<p>It contains the client index and every client record as JSON (${files.length} files, ${(zip.length / 1024).toFixed(1)} KB zipped). Generated documents (PDFs/HTML) aren't included: they can be regenerated from these records.</p>
<p style="color:#888;font-size:12px">Sent by the weekly cron. Replies aren't monitored.</p>`,
      [{ filename: `luminary-console-backup-${stamp}.zip`, content: zip }],
    );

    // ——— 2. DNS health ———
    const slugs = index.map((e) => e.slug);
    // Two different providers, so they need not wait for each other.
    const [cfIssues, vercelIssues] = await Promise.all([
      checkCloudflare(slugs),
      checkVercelDomains(slugs),
    ]);
    const issues = [...cfIssues, ...vercelIssues];
    if (issues.length) {
      await emailStudio(
        `DNS health warning · ${issues.length} issue${issues.length === 1 ? "" : "s"} found`,
        `<p>The weekly DNS health check found problems with client subdomains:</p>
<ul>${issues.map((i) => `<li><b>${esc(i.host)}</b>: ${esc(i.problem)}</li>`).join("")}</ul>
<p>Client portals on affected subdomains may be unreachable until fixed.</p>
<p style="color:#888;font-size:12px">Sent by the weekly cron. Replies aren't monitored.</p>`,
      );
    }

    await logActivity(
      "system",
      "ran weekly backup",
      "console",
      `${index.length} clients ${delivered ? "backed up" : "ZIPPED BUT NOT EMAILED"}; DNS ${issues.length ? `${issues.length} issue(s) emailed` : "healthy"}`,
    );

    // A backup that was never delivered is not a backup. Fail the invocation
    // so it shows up as a failed cron run instead of a green one — Resend
    // errors are only console.error'd inside emailStudio.
    if (!delivered) {
      return NextResponse.json(
        { error: "Backup built but the email did not go out.", clients: index.length, zipBytes: zip.length },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, clients: index.length, zipBytes: zip.length, dnsIssues: issues.length });
  } catch (e) {
    console.error("Cron backup failed:", e);
    return NextResponse.json({ error: "Backup failed." }, { status: 500 });
  }
}
