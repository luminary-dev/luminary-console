import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { DOC_LABELS, type DocType } from "@/lib/types";
import DocActions from "@/components/DocActions";
import CopyLink from "@/components/CopyLink";
import RetryStage2 from "@/components/RetryStage2";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  return { title: client ? `${client.company} · Console` : "Client" };
}

const ORDER: DocType[] = ["estimate", "quotation", "proposal", "contract", "invoice", "receipt"];

export default async function ClientPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();
  const base = `https://${client.domain}`;

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>{client.company}</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <Link className="btn ghost small" href="/">
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="card">
        <h3>{client.company}</h3>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>
          {client.projectLabel} · doc no. {client.docNoBase} · created {client.createdAt.slice(0, 10)}
        </p>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <span className="k" style={{ marginRight: 10 }}>Questionnaire</span>
            <CopyLink url={`${base}/questionnaire`} />
          </div>
          {ORDER.filter((t) => client.docs[t]?.status === "published").map((t) => (
            <div key={t} style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <span className="k" style={{ marginRight: -4 }}>{DOC_LABELS[t]}</span>
              <CopyLink url={`${base}/${t}`} />
            </div>
          ))}
        </div>
        {client.dnsStatus !== "automated" && (
          <div className="form-error" style={{ marginTop: 14 }}>
            DNS is <b>{client.dnsStatus}</b> — the links above won&apos;t resolve until the CNAME
            &quot;{client.slug}&quot; → cname.vercel-dns.com exists in Cloudflare and the domain is
            attached to the Vercel project. Set CLOUDFLARE_API_TOKEN / VERCEL_TOKEN to automate this.
          </div>
        )}
        {client.answersAt && (
          <div className="notice">
            Questionnaire submitted {client.answersAt} by <b>{client.answersBy}</b>
            {client.answersPdfUrl && (
              <>
                {" · "}
                <a href={client.answersPdfUrl} target="_blank" rel="noopener noreferrer">
                  answers PDF →
                </a>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Documents</h3>
        <div className="table-scroll"><table className="list">
          <thead>
            <tr>
              <th>Document</th>
              <th>No.</th>
              <th>Status</th>
              <th>Preview</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>Questionnaire</td>
              <td className="mono">LUM-QST-{client.docNoBase}</td>
              <td>
                <span className={`pill${client.answersAt ? "" : " grey"}`}>
                  <i />
                  {client.answersAt ? "answers in" : "live"}
                </span>
              </td>
              <td>
                <a href={`${base}/questionnaire`} target="_blank" rel="noopener noreferrer">Form</a>
                {client.answersPdfUrl && (
                  <>
                    {" · "}
                    <a href={client.answersPdfUrl} target="_blank" rel="noopener noreferrer">Answers PDF</a>
                  </>
                )}
              </td>
              <td style={{ color: "var(--subtle)" }}>—</td>
            </tr>
            {ORDER.map((t) => {
              const meta = client.docs[t];
              const billing = t === "invoice" || t === "receipt";
              return (
                <tr key={t}>
                  <td style={{ fontWeight: 600 }}>{DOC_LABELS[t]}</td>
                  <td className="mono">{meta?.no ?? "—"}</td>
                  <td>
                    {meta ? (
                      <span className={`pill${meta.status === "draft" ? " grey" : ""}`}>
                        <i />
                        {meta.status}
                      </span>
                    ) : (
                      <span style={{ color: "var(--subtle)" }}>
                        {billing ? "not generated" : t === "estimate" ? "—" : "awaiting answers"}
                      </span>
                    )}
                  </td>
                  <td>
                    {meta ? (
                      <a href={`/preview/${slug}/${t}`} target="_blank" rel="noopener noreferrer">
                        Preview
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <DocActions slug={slug} type={t} exists={!!meta} status={meta?.status} billing={billing} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {client.status === "answers_in" && !client.docs.quotation && (
          <div className="notice" style={{ marginTop: 14 }}>
            Answers are in — drafting runs automatically in the background. If the drafts don&apos;t
            appear after a few minutes, run it manually: <RetryStage2 slug={slug} />
          </div>
        )}
      </div>

      <div className="card">
        <h3>Brief</h3>
        <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, whiteSpace: "pre-wrap" }}>
          {client.brief}
        </p>
      </div>
    </main>
  );
}
