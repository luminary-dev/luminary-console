// The finalized project site: deploy a GitHub repo to its own Vercel project,
// attach a branded subdomain, and publish/unpublish it to the client portal —
// the same lifecycle as designs. Console-only (proxy-gated). Deploy + status
// go through lib/deploy (Vercel API); the subdomain through lib/domains. If the
// Vercel token/GitHub integration isn't available, the operator can record a
// manually-deployed URL with the "set" action instead.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { deployRepo, deploymentStatus, parseRepo } from "@/lib/deploy";
import { ensureSubdomain, removeSubdomain } from "@/lib/domains";
import { logOperatorActivity } from "@/lib/operator";
import { emailStudio } from "@/lib/email";
import { studioNotice } from "@/lib/notify";
import { problem, problemResponse } from "@/lib/errors";
import type { SiteEntry } from "@/lib/types";

export const runtime = "nodejs";
// Uploading a repo's files + creating the deployment can take a while.
export const maxDuration = 300;

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;

const projectName = (slug: string) => `${slug}-site`.replace(/[^a-z0-9-]/g, "-").slice(0, 100);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "deploy" || action === "redeploy") {
      const parsed = parseRepo(typeof body.repo === "string" ? body.repo : (client.site?.repo ?? ""));
      if (!parsed) return NextResponse.json({ error: "Enter a GitHub repo URL or org/name." }, { status: 400 });
      const ref = (typeof body.ref === "string" && body.ref.trim()) || client.site?.ref || "main";
      const project = client.site?.project || projectName(slug);
      const label = `${slug}-live`;
      const host = `${label}.${ROOT}`;

      const dep = await deployRepo({ org: parsed.org, name: parsed.name, ref, projectName: project });
      // Attach the branded subdomain to the client's own project (best-effort).
      const domain = await ensureSubdomain(label, project);

      // The branded host is only reachable once the domain is automated; until
      // then the deploy's own URL stands in, and it can be absent entirely.
      const url = domain.status === "automated" ? `https://${host}` : dep.url;

      const site: SiteEntry = {
        repo: `${parsed.org}/${parsed.name}`,
        ref,
        project,
        host,
        ...(url ? { url } : {}),
        deployId: dep.id,
        state: dep.state,
        status: client.site?.status ?? "draft",
        domainStatus: `${domain.status}: ${domain.detail}`,
        updatedAt: new Date().toISOString(),
      };
      client.site = site;
      await saveClient(client);
      await logOperatorActivity("deployed the site", slug, site.repo);
      return NextResponse.json({ ok: true, site });
    }

    if (action === "refresh") {
      if (!client.site?.deployId) return NextResponse.json({ error: "Nothing deployed yet." }, { status: 400 });
      const prev = client.site.state;
      const dep = await deploymentStatus(client.site.deployId);
      client.site.state = dep.state;
      if (!client.site.host && dep.url) client.site.url = dep.url;
      if (dep.state === "READY" && !client.site.deployedAt) client.site.deployedAt = new Date().toISOString();
      client.site.updatedAt = new Date().toISOString();
      await saveClient(client);
      // Notify the studio once, when a build first reaches READY.
      if (dep.state === "READY" && prev !== "READY") {
        const url = client.site.url ?? "";
        await emailStudio(
          `Site deployed · ${client.company}`,
          `<p>The finalized site for <b>${client.company}</b> is live: <a href="${url}">${url}</a></p>
<p>Publish it in the console to show it on the client portal.</p>`,
        );
        await studioNotice({ title: "Site deployed", company: client.company, lines: [client.site.repo, url], url: `https://${CONSOLE_HOST}/clients/${slug}` });
      }
      return NextResponse.json({ ok: true, site: client.site });
    }

    if (action === "publish" || action === "unpublish") {
      if (!client.site) return NextResponse.json({ error: "No site to publish." }, { status: 400 });
      client.site.status = action === "publish" ? "published" : "draft";
      client.site.updatedAt = new Date().toISOString();
      await saveClient(client);
      await logOperatorActivity(`${action}ed the site`, slug, client.site.repo);
      return NextResponse.json({ ok: true, site: client.site });
    }

    if (action === "set") {
      // Manual fallback: record a site the operator deployed themselves.
      const parsed = parseRepo(typeof body.repo === "string" ? body.repo : "");
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: "Enter the live https URL." }, { status: 400 });
      client.site = {
        repo: parsed ? `${parsed.org}/${parsed.name}` : (typeof body.repo === "string" ? body.repo.trim() : ""),
        ref: (typeof body.ref === "string" && body.ref.trim()) || "main",
        project: client.site?.project || projectName(slug),
        url,
        state: "READY",
        status: client.site?.status ?? "draft",
        updatedAt: new Date().toISOString(),
      };
      await saveClient(client);
      await logOperatorActivity("recorded the site", slug, url);
      return NextResponse.json({ ok: true, site: client.site });
    }

    if (action === "delete") {
      const site = client.site;
      if (site) {
        // Best-effort: release the branded subdomain (leaves the Vercel project).
        await removeSubdomain(`${slug}-live`, site.project).catch(() => {});
        delete client.site;
        await saveClient(client);
        await logOperatorActivity("removed the site", slug, site.repo);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    // lib/deploy signals "no Vercel credentials" with a `manual:` message.
    // That one is an authored, safe sentence with an action attached, so it
    // survives; everything else goes through the mapper and stays internal.
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("manual:")) {
      const body = problem(
        "conflict",
        "Vercel isn't configured, so this can't be deployed from here. Use 'Set URL' to record a site you deployed manually.",
      );
      console.error(`[${body.requestId}] site action ${action} on ${slug}: Vercel not configured`);
      return NextResponse.json(body, { status: body.status });
    }
    const { body, status } = problemResponse(e, `site action ${action} on ${slug}`);
    return NextResponse.json(body, { status });
  }
}
