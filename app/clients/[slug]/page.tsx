import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { DOC_LABELS, type DocType } from "@/lib/types";
import DocActions from "@/components/DocActions";
import CopyLink from "@/components/CopyLink";
import RetryStage2 from "@/components/RetryStage2";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import DeleteClient from "@/components/DeleteClient";
import SendToClient from "@/components/SendToClient";
import BillingCard from "@/components/BillingCard";
import EmailDocButton from "@/components/EmailDocButton";
import ChangeOrders from "@/components/ChangeOrders";
import StageSelect from "@/components/StageSelect";
import { currentStage } from "@/lib/stage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  return { title: client ? `${client.company} · Console` : "Client" };
}

const CORE: DocType[] = ["estimate", "quotation", "proposal", "contract"];
const ORDER: DocType[] = [...CORE, "invoice", "receipt"]; // legacy single-slot billing docs still display

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
          <SignOut />
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
        <div style={{ marginTop: 12, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <StageSelect slug={slug} stage={currentStage(client)} />
          {client.acceptance && (
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Quotation accepted by <b style={{ color: "var(--text)" }}>{client.acceptance.name}</b>{" "}
              on {client.acceptance.at.slice(0, 10)}
            </span>
          )}
        </div>
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
        <SendToClient
          slug={slug}
          email={client.email}
          publishedCount={ORDER.filter((t) => client.docs[t]?.status === "published").length}
        />
        {client.dnsStatus !== "automated" && (
          <div className="form-error" style={{ marginTop: 14 }}>
            DNS is <b>{client.dnsStatus}</b> — the links above won&apos;t resolve until the CNAME
            &quot;{client.slug}&quot; → cname.vercel-dns.com exists in Cloudflare and the domain is
            attached to the Vercel project. Set CLOUDFLARE_API_TOKEN / VERCEL_TOKEN to automate this.
          </div>
        )}
        {(client.submissions?.length ?? (client.answersAt ? 1 : 0)) > 0 && (
          <div className="notice">
            <b>Questionnaire submissions</b>
            {(
              client.submissions ?? [
                {
                  at: client.answersAt!,
                  by: client.answersBy ?? "—",
                  answersUrl: client.answersUrl!,
                  pdfUrl: client.answersPdfUrl!,
                },
              ]
            ).map((sub, i) => (
              <div key={i} style={{ marginTop: 6 }}>
                #{i + 1} · {sub.at} by <b>{sub.by}</b>
                {" · "}
                <a href={sub.pdfUrl} target="_blank" rel="noopener noreferrer">
                  answers PDF →
                </a>
                {"attachments" in sub && sub.attachments && sub.attachments.length > 0 && (
                  <div style={{ marginTop: 4, marginLeft: 16, fontSize: 13 }}>
                    {sub.attachments.length} file{sub.attachments.length > 1 ? "s" : ""} attached:{" "}
                    {sub.attachments.map((a, j) => (
                      <span key={j}>
                        {j > 0 && " · "}
                        <a href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.name}
                        </a>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              Documents are drafted from the first submission automatically; later submissions
              never overwrite your documents — use Revise to fold them in.
            </div>
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
            {ORDER.filter((t) => CORE.includes(t) || client.docs[t]).map((t) => {
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
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <DocActions slug={slug} type={t} exists={!!meta} status={meta?.status} billing={false} />
                      {meta && <EmailDocButton slug={slug} docKey={t} label={DOC_LABELS[t]} email={client.email} />}
                    </div>
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

      <BillingCard
        slug={slug}
        billing={client.billing ?? []}
        payments={client.payments ?? []}
        hasQuotation={!!client.docs.quotation}
        email={client.email}
      />

      <ChangeOrders slug={slug} changeOrders={client.changeOrders ?? []} />

      <div className="card">
        <h3>Brief</h3>
        <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, whiteSpace: "pre-wrap" }}>
          {client.brief}
        </p>
      </div>

      <DeleteClient slug={slug} company={client.company} />
    </main>
  );
}
