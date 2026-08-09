// Client-site landing: a small branded hub linking whatever is published,
// with a stage-driven progress stepper, "New" badges for anything published
// since the client's last visit, and a question box wired to /c/<slug>/comment.
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { currentStage } from "@/lib/stage";
import { billingLabel } from "@/lib/doclabels";
import { DOC_LABELS, type DocType } from "@/lib/types";
import PortalProgress from "@/components/PortalProgress";
import PortalComments, { type PortalDoc } from "@/components/PortalComments";
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

  return (
    <main className="sheet sheet--narrow">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <ThemeToggle />
      </div>
      <div className="brand" style={{ fontSize: 26 }}>
        Luminary<span>.</span>
      </div>
      <div className="k" style={{ marginTop: 8, letterSpacing: ".16em" }}>
        Client portal — {client.company}
      </div>

      <PortalProgress stage={currentStage(client)} />

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
        <div className="card">
          <h3>Design previews</h3>
          <div className="portal-links">
            {publishedDesigns.map((d) => (
              <Link className="portal-link" key={d.id} href={`${base}/design/${d.id}`}>
                <span>
                  {d.title}
                  {isNew(d.updatedAt) && <span className="new-pill">New</span>}
                </span>
                <span className="no">View →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <PortalComments docs={askable} initialDoc={newest} base={base} />

      <div className="foot">
        <div className="foot-links">
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>
          <i />
          <a href="https://luminary-dev.xyz">luminary-dev.xyz</a>
        </div>
      </div>
    </main>
  );
}
