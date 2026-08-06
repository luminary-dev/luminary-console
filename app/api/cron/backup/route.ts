// Weekly ops cron (vercel.json schedules it Mondays 03:00 UTC):
//   1. Backup — zips the client index + every client record (JSON only, no
//      PDFs: those are regenerable blobs) and emails it to the studio.
//   2. DNS health — verifies each client's Cloudflare CNAME still exists and
//      the subdomain is still attached to the Vercel project; any mismatch
//      is emailed as a warning.
//
// Auth: the proxy deliberately lets /api/cron/* through its session gate;
// THIS route's bearer check is the only guard. Vercel Cron automatically
// sends "Authorization: Bearer <CRON_SECRET>" when that env var exists, and
// manual runs can send the same header.
import { NextResponse } from "next/server";
import { getIndex, getClient } from "@/lib/store";
import { buildZip, type ZipFile } from "@/lib/zip";
import { emailStudio } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { esc } from "@/lib/templates/shell";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

// ——— DNS health ———

type DnsIssue = { slug: string; host: string; problem: string };

async function checkCloudflare(slugs: string[]): Promise<DnsIssue[]> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    return [{ slug: "—", host: "—", problem: "Cloudflare check skipped (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set)" }];
  }
  const issues: DnsIssue[] = [];
  for (const slug of slugs) {
    const host = `${slug}.${ROOT}`;
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${host}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json();
      if (!data?.success) {
        issues.push({ slug, host, problem: `Cloudflare API error (${res.status})` });
        continue;
      }
      const records: { type: string; content: string }[] = data.result ?? [];
      const cname = records.find((r) => r.type === "CNAME");
      if (!cname) {
        issues.push({ slug, host, problem: "no CNAME record in Cloudflare" });
      } else if (!/vercel-dns/.test(cname.content)) {
        issues.push({ slug, host, problem: `CNAME points at "${cname.content}" instead of cname.vercel-dns.com` });
      }
    } catch (e) {
      issues.push({ slug, host, problem: `Cloudflare check failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return issues;
}

async function checkVercelDomains(slugs: string[]): Promise<DnsIssue[]> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return [{ slug: "—", host: "—", problem: "Vercel domain check skipped (VERCEL_TOKEN / VERCEL_PROJECT_ID not set)" }];
  }
  const teamId = process.env.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : "";
  const issues: DnsIssue[] = [];
  for (const slug of slugs) {
    const host = `${slug}.${ROOT}`;
    try {
      const res = await fetch(
        `https://api.vercel.com/v9/projects/${projectId}/domains/${host}${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 404) {
        issues.push({ slug, host, problem: "domain no longer attached to the Vercel project" });
      } else if (!res.ok) {
        issues.push({ slug, host, problem: `Vercel API error (${res.status})` });
      }
    } catch (e) {
      issues.push({ slug, host, problem: `Vercel check failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return issues;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ——— 1. backup zip ———
    const index = await getIndex();
    const files: ZipFile[] = [{ name: "index.json", data: JSON.stringify(index, null, 2) }];
    for (const entry of index) {
      const record = await getClient(entry.slug);
      if (record) {
        files.push({ name: `clients/${entry.slug}/record.json`, data: JSON.stringify(record, null, 2) });
      }
    }
    const zip = buildZip(files);
    const stamp = new Date().toISOString().slice(0, 10);
    await emailStudio(
      `Console backup — ${stamp} (${index.length} client${index.length === 1 ? "" : "s"})`,
      `<p>Weekly automatic backup of the Luminary Console attached.</p>
<p>It contains the client index and every client record as JSON (${files.length} files, ${(zip.length / 1024).toFixed(1)} KB zipped). Generated documents (PDFs/HTML) aren't included — they can be regenerated from these records.</p>
<p style="color:#888;font-size:12px">Sent by the weekly cron — replies aren't monitored.</p>`,
      [{ filename: `luminary-console-backup-${stamp}.zip`, content: zip }],
    );

    // ——— 2. DNS health ———
    const slugs = index.map((e) => e.slug);
    const issues = [...(await checkCloudflare(slugs)), ...(await checkVercelDomains(slugs))];
    if (issues.length) {
      await emailStudio(
        `DNS health warning — ${issues.length} issue${issues.length === 1 ? "" : "s"} found`,
        `<p>The weekly DNS health check found problems with client subdomains:</p>
<ul>${issues.map((i) => `<li><b>${esc(i.host)}</b> — ${esc(i.problem)}</li>`).join("")}</ul>
<p>Client portals on affected subdomains may be unreachable until fixed.</p>
<p style="color:#888;font-size:12px">Sent by the weekly cron — replies aren't monitored.</p>`,
      );
    }

    await logActivity(
      "system",
      "ran weekly backup",
      "console",
      `${index.length} clients backed up; DNS ${issues.length ? `${issues.length} issue(s) emailed` : "healthy"}`,
    );

    return NextResponse.json({ ok: true, clients: index.length, zipBytes: zip.length, dnsIssues: issues.length });
  } catch (e) {
    console.error("Cron backup failed:", e);
    return NextResponse.json({ error: "Backup failed." }, { status: 500 });
  }
}
