// Client-site landing: a small branded hub linking whatever is published,
// with a stage-driven progress stepper, "New" badges for anything published
// since the client's last visit, and a question box wired to /c/<slug>/comment.
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { currentStage } from "@/lib/stage";
import { STAGE_LABELS } from "@/lib/stage";
import { billingLabel } from "@/lib/doclabels";
import { DOC_LABELS, type DocType } from "@/lib/types";
import PortalProgress from "@/components/PortalProgress";
import PortalComments, { type PortalDoc } from "@/components/PortalComments";
import PortalUploads from "@/components/PortalUploads";
import PortalDesigns from "@/components/PortalDesigns";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  return { title: client ? `Client portal · ${client.company}` : "Client portal" };
}

export default async function ClientHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();

  // The proxy stamps a fresh visit cookie on this response and hands the
  // PREVIOUS one over in a header (it can't come from cookies() — Next
  // propagates middleware-set cookies onto the request, so the new stamp
  // would already be in there and nothing would ever look new). Empty = first
  // visit, and nothing is flagged: a portal shouting "New" at every row on
  // first sight means nothing.
  const h = await headers();
  // Root-absolute hrefs are correct on the client subdomain, where the proxy
  // rewrites "/" into "/c/<slug>/". They are NOT correct at /c/<slug> on the
  // console host — the documented operator preview — where every link landed
  // on the console root and 404'd or bounced to /login. Derive the prefix the
  // same way the proxy decides the host is a client host.
  const host = (h.get("host") || "").split(":")[0].toLowerCase();
  const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
  const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
  const onClientHost = host.endsWith(`.${ROOT}`) && host !== CONSOLE_HOST && host !== ROOT;
  const base = onClientHost ? "" : `/c/${slug}`;

  const lastVisit = Number(h.get("x-lum-last-visit") ?? "");
  const isNew = (updatedAt: string) =>
    Number.isFinite(lastVisit) &&
    lastVisit > 0 &&
    Date.parse(updatedAt) > lastVisit;

  const published = (Object.keys(client.docs) as DocType[]).filter(
    (t) => client.docs[t]?.status === "published",
  );
  const publishedBilling = (client.billing ?? []).filter((b) => b.status === "published");
  const publishedDesigns = (client.designs ?? []).filter((d) => d.status === "published");

  // Everything the client can point a question at, newest doc preselected.
  const askable: PortalDoc[] = [
    ...published.map((t) => ({ key: t, label: DOC_LABELS[t], no: client.docs[t]!.no })),
    ...publishedBilling.map((b) => ({ key: b.slug, label: billingLabel(b), no: b.no })),
    { key: "questionnaire", label: "Project questionnaire", no: `LUM-QST-${client.docNoBase}` },
  ];
  const newest = [
    ...published.map((t) => ({ key: t as string, at: client.docs[t]!.updatedAt })),
    ...publishedBilling.map((b) => ({ key: b.slug, at: b.updatedAt })),
  ].sort((a, b) => b.at.localeCompare(a.at))[0]?.key;

  const stage = currentStage(client);
  const docCount = published.length + publishedBilling.length + 1; // + questionnaire

  return (
    <main className="portal">
      <header className="portal-hero">
        <div className="portal-hero__inner">
          <div className="portal-hero__top">
            <div className="brand" style={{ fontSize: 24 }}>
              Luminary<span>.</span>
            </div>
            <ThemeToggle />
          </div>
          <div className="k portal-hero__eyebrow">Client portal</div>
          <h1>{client.company}</h1>
          <p className="portal-hero__sub">
            Your project with Luminary, all in one place — documents, design previews and
            everything we need from you, kept here for the whole build.
          </p>
          <div className="portal-stats">
            <span className="portal-stat">
              <span className="dot" aria-hidden="true" />
              <span className="k">Stage</span> <b>{STAGE_LABELS[stage]}</b>
            </span>
            <span className="portal-stat">
              <span className="k">Documents</span> <b>{docCount}</b>
            </span>
            {publishedDesigns.length > 0 && (
              <span className="portal-stat">
                <span className="k">Design concepts</span> <b>{publishedDesigns.length}</b>
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="portal-body">
        <PortalProgress stage={stage} deliveredAt={client.deliveredAt} />

        <div className="card">
        <h3>Your documents</h3>
        <div className="portal-links">
          <Link className="portal-link" href={`${base}/questionnaire`}>
            <span>Project questionnaire</span>
            <span className="no">LUM-QST-{client.docNoBase} →</span>
          </Link>
          {published.map((t) => (
            <Link className="portal-link" key={t} href={`${base}/${t}`}>
              <span>
                {DOC_LABELS[t]}
                {isNew(client.docs[t]!.updatedAt) && <span className="new-pill">New</span>}
              </span>
              <span className="no">{client.docs[t]!.no} →</span>
            </Link>
          ))}
          {publishedBilling.map((b) => (
            <Link className="portal-link" key={b.slug} href={`${base}/${b.slug}`}>
              <span>
                {billingLabel(b)}
                {isNew(b.updatedAt) && <span className="new-pill">New</span>}
              </span>
              <span className="no">{b.no} →</span>
            </Link>
          ))}
        </div>
      </div>

      {publishedDesigns.length > 0 && (
        <PortalDesigns
          base={base}
          designs={publishedDesigns.map((d) => ({ id: d.id, title: d.title, isNew: isNew(d.updatedAt) }))}
          initialSelectedId={client.selectedDesign?.id}
        />
      )}

      <PortalComments docs={askable} initialDoc={newest} base={base} />

      <PortalUploads
        base={base}
        initial={[...(client.uploads ?? [])]
          .reverse()
          .map((u) => ({ name: u.name, size: u.size, at: u.at }))}
      />

        <div className="foot">
          <div className="foot-links">
            <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>
            <i />
            <a href="https://luminary-dev.xyz">luminary-dev.xyz</a>
          </div>
        </div>
      </div>
    </main>
  );
}
