import { notFound } from "next/navigation";
import { sentenceCase } from "@/lib/sentence-case";
import { after } from "next/server";
import { getClient } from "@/lib/store";
import { DOC_LABELS, type DocType } from "@/lib/types";
import DocActions from "@/components/DocActions";
import CopyLink from "@/components/CopyLink";
import RetryStage2 from "@/components/RetryStage2";
import ConsoleShell from "@/components/shell/ConsoleShell";
import HowItWorks from "@/components/HowItWorks";
import NextStepCard, { NextStepBar } from "@/components/NextStepCard";
import { nextStep } from "@/lib/next-step";
import DeleteClient from "@/components/DeleteClient";
import SendToClient from "@/components/SendToClient";
import BillingCard from "@/components/BillingCard";
import EmailDocButton from "@/components/EmailDocButton";
import ChangeOrders from "@/components/ChangeOrders";
import StageSelect from "@/components/StageSelect";
import DocHistory from "@/components/DocHistory";
import NotesCard from "@/components/NotesCard";
import TasksCard from "@/components/TasksCard";
import CommentsCard from "@/components/CommentsCard";
import EmailHistoryCard from "@/components/EmailHistoryCard";
import AssistantCard from "@/components/AssistantCard";
import HandoverCard from "@/components/HandoverCard";
import DesignsCard from "@/components/DesignsCard";
import SiteCard from "@/components/SiteCard";
import { currentStage } from "@/lib/stage";
import { deliveredAtIso, handoverEligible } from "@/lib/handover";
import { fmtSize } from "@/lib/attachments";
import { activityFor, getClientSeenAt, markClientSeen } from "@/lib/activity";
import { clientMoney, fmtLKR, overdueSummary } from "@/lib/money";
import { getDocViews } from "@/lib/receipts";
import { relTime } from "@/lib/time";
import ActivityList from "@/components/ActivityList";
import RelativeTime from "@/components/RelativeTime";
import ClientTabs, { clientTabFrom, tabLabel, type ClientTab } from "@/components/ClientTabs";

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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { slug } = await params;
  // The page used to be every card in one 5,000px column. It is now one tab at
  // a time, and the tab is in the URL so a link to "this client's billing" can
  // be pasted to a teammate. Anything that is not a known tab is the overview.
  const { tab: rawTab } = await searchParams;
  const tab = clientTabFrom(rawTab);
  const client = await getClient(slug);
  if (!client) notFound();
  const base = `https://${client.domain}`;
  // Read this project's last-viewed mark BEFORE clearing it, so the Activity
  // card can default to what's unread since the last visit to this page.
  const [activity, activitySeenAt, docViews] = await Promise.all([
    activityFor(slug),
    getClientSeenAt(slug),
    getDocViews(slug),
  ]);
  // After the response, not in the render body (AUDIT.md UI-06). The reads
  // above intentionally use the pre-mark seenAt so this load still shows the
  // "new" badges; next load they are seen.
  // Only the overview shows the activity, so only the overview counts as
  // having seen it: opening Billing must not clear the "new" marks unread.
  if (tab === "overview") after(() => markClientSeen(slug));
  const now = Date.now();
  // The cards below declare `email?: string`, which under
  // exactOptionalPropertyTypes means "absent", not "present and undefined".
  // Spread the prop in only when the record actually carries an address.
  const emailProp = client.email !== undefined ? { email: client.email } : {};
  // What is waiting behind each tab, shown on the tab itself so nothing has to
  // be opened to find out.
  const step = nextStep(client, now);
  const tabCounts: Partial<Record<ClientTab, number>> = {
    overview: (client.tasks ?? []).filter((t) => !t.done).length,
    messages: (client.comments ?? []).length,
  };

  return (
    <ConsoleShell
      current="/clients"
      title={client.company}
      purpose={`${client.projectLabel} · doc no. ${client.docNoBase} · created ${client.createdAt.slice(0, 10)}`}
      trail={[
        { label: "Clients", href: "/clients" },
        tab === "overview" ? { label: client.company } : { label: client.company, href: `/clients/${slug}` },
        { label: tabLabel(tab) },
      ]}
    >
      {client.dnsStatus !== "automated" && (
        <div className="form-error" role="alert">
          This client&apos;s web address is not working yet, so the links you send them will not
          open.
          <HowItWorks label="How to fix it">
            <p>
              DNS is <b>{client.dnsStatus}</b>. The CNAME &quot;{client.slug}&quot; → cname.vercel-dns.com
              has to exist in Cloudflare and the domain has to be attached to the Vercel project.
              Set CLOUDFLARE_API_TOKEN and VERCEL_TOKEN to have this done automatically.
            </p>
          </HowItWorks>
        </div>
      )}


      {/* The tabs sit straight under the client's name, so they are in the same
          place on every tab. Summary opens with where the project stands;
          every other tab gets that as one line. */}
      <ClientTabs slug={slug} current={tab} counts={tabCounts} />

      {tab !== "overview" && <NextStepBar slug={slug} step={step} currentTab={tab} />}

      {tab === "overview" && (
        <>
      <NextStepCard slug={slug} step={step} currentTab={tab}>
        {(() => {
          const openTasks = (client.tasks ?? []).filter((t) => !t.done).length;
          const money = clientMoney(client);
          const od = overdueSummary(client);
          return (
            <span>
              <span style={{ color: openTasks > 0 ? "var(--text)" : "var(--muted)", fontWeight: openTasks > 0 ? 600 : 400 }}>
                {openTasks > 0 ? `${openTasks} task${openTasks > 1 ? "s" : ""} open` : "No open tasks"}
              </span>
              <span style={{ color: "var(--muted)" }}> · </span>
              {money.outstanding > 0 ? (
                <>
                  <b className="mono">{fmtLKR(money.outstanding)}</b> still to pay
                  {od.count > 0 && (
                    <span style={{ color: "var(--danger, #d33)", fontWeight: 600 }}> · {fmtLKR(od.total)} overdue</span>
                  )}
                </>
              ) : (
                <span style={{ color: "var(--muted)" }}>nothing owed</span>
              )}
            </span>
          );
        })()}
        <StageSelect slug={slug} stage={currentStage(client)} />
        {client.acceptance && (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Quotation accepted by <b style={{ color: "var(--text)" }}>{client.acceptance.name}</b>{" "}
            on {client.acceptance.at.slice(0, 10)}
          </span>
        )}
      </NextStepCard>
      <TasksCard slug={slug} tasks={client.tasks ?? []} />

      <NotesCard slug={slug} {...(client.notes !== undefined ? { notes: client.notes } : {})} />

      {activity.length > 0 && (
        <div className="card">
          <h3>This client&apos;s history</h3>
          <p className="empty-note" style={{ marginTop: 4 }}>
            What the client did and what we did, newest first. Only what is new since you last
            looked shows at first: press <b>See more</b> for the rest.
          </p>
          <ActivityList entries={activity} now={now} seenAt={activitySeenAt} />
        </div>
      )}
        </>
      )}

      {tab === "documents" && (
        <>
      <div className="card">
        <h3>Client links</h3>
        <p className="empty-note" style={{ marginTop: 4 }}>
          What the client opens. Copy a link, or email the published documents in one go.
        </p>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <span className="k" style={{ marginRight: 12 }}>Questions form</span>
            <CopyLink url={`${base}/questionnaire`} />
          </div>
          {ORDER.filter((t) => client.docs[t]?.status === "published").map((t) => (
            <div key={t} style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <span className="k" style={{ marginRight: -4 }}>{DOC_LABELS[t]}</span>
              <CopyLink url={`${base}/${t}`} />
            </div>
          ))}
        </div>
        <SendToClient
          slug={slug}
          {...emailProp}
          publishedCount={ORDER.filter((t) => client.docs[t]?.status === "published").length}
        />
        {(client.submissions?.length ?? (client.answersAt ? 1 : 0)) > 0 && (
          <div className="notice">
            <b>Their answers to the questions form</b>
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
              <div key={i} style={{ marginTop: 8 }}>
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
              The documents were written from the first set of answers. Later answers never
              change a document by themselves: use Make changes on it to work them in.
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Documents</h3>
        <div className="table-scroll"><table className="list list--wide">
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
              <td style={{ fontWeight: 500 }}>Questions form</td>
              <td className="mono">LUM-QST-{client.docNoBase}</td>
              <td>
                <span className={`pill${client.answersAt ? "" : " grey"}`}>
                  <i />
                  {client.answersAt ? "Answered" : "Not answered yet"}
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
              <td>
                <span aria-hidden="true" style={{ color: "var(--label)" }}>-</span>
                <span className="sr-only">No actions</span>
              </td>
            </tr>
            {ORDER.filter((t) => CORE.includes(t) || client.docs[t]).map((t) => {
              const meta = client.docs[t];
              const billing = t === "invoice" || t === "receipt";
              return (
                <tr key={t}>
                  <td style={{ fontWeight: 500 }}>{DOC_LABELS[t]}</td>
                  <td className="mono">{meta?.no ?? "—"}</td>
                  <td>
                    {meta ? (
                      <span className={`pill${meta.status === "draft" ? " grey" : ""}`}>
                        <i />
                        {sentenceCase(meta.status)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--label)" }}>
                        {billing ? "not made yet" : t === "estimate" ? "—" : "written once they answer"}
                      </span>
                    )}
                    {meta?.status === "published" && docViews[t] && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--a-text)" }}>
                        opened <RelativeTime at={docViews[t]} initial={relTime(docViews[t], now)} />
                      </div>
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
                      <DocActions
                        slug={slug}
                        type={t}
                        label={DOC_LABELS[t]}
                        {...(meta ? { no: meta.no, status: meta.status } : {})}
                        exists={!!meta}
                        billing={false}
                        {...emailProp}
                        relatedDocs={
                          // The project-doc family that a revision can cascade to:
                          // the other existing docs among estimate/quotation/proposal/contract.
                          (["estimate", "quotation", "proposal", "contract"] as DocType[]).includes(t)
                            ? (["estimate", "quotation", "proposal", "contract"] as DocType[])
                                .filter((x) => x !== t && client.docs[x])
                                .map((x) => DOC_LABELS[x])
                            : []
                        }
                      >
                        {meta && <EmailDocButton slug={slug} docKey={t} label={DOC_LABELS[t]} {...emailProp} />}
                      </DocActions>
                    <DocHistory {...(meta?.history ? { history: meta.history } : {})} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {client.status === "answers_in" && !client.docs.quotation && (
          <div className="notice" style={{ marginTop: 16 }}>
            Their answers are in and the documents are being written. If the drafts have not
            appeared after a few minutes, start it by hand: <RetryStage2 slug={slug} />
          </div>
        )}
      </div>
        </>
      )}

      {tab === "design" && (
        <>
      <DesignsCard
        slug={slug}
        domain={client.domain}
        initial={client.designs ?? []}
        {...(client.selectedDesign ? { selectedId: client.selectedDesign.id } : {})}
      />

      <SiteCard slug={slug} {...(client.site ? { initial: client.site } : {})} />

      {(() => {
        const h = (client.billing ?? []).find((b) => b.kind === "handover");
        const deliveredOn = deliveredAtIso(client);
        return (
          <HandoverCard
            slug={slug}
            eligible={handoverEligible(client)}
            {...(h ? { existing: { no: h.no, slug: h.slug, status: h.status } } : {})}
            {...(deliveredOn !== undefined ? { deliveredOn } : {})}
          />
        );
      })()}
        </>
      )}

      {tab === "billing" && (
        <>
      <BillingCard
        slug={slug}
        billing={client.billing ?? []}
        payments={client.payments ?? []}
        hasQuotation={!!client.docs.quotation}
        {...emailProp}
        views={docViews}
      />

      <ChangeOrders slug={slug} changeOrders={client.changeOrders ?? []} />
        </>
      )}

      {tab === "messages" && (
        <>
      <CommentsCard client={client} />

      {(client.uploads?.length ?? 0) > 0 && (
        <div className="card">
          <h3>Files the client sent</h3>
          <p className="empty-note" style={{ marginTop: 4 }}>
            Sent from their page. They are private: the links open only while you are signed in here.
          </p>
          <div style={{ marginTop: 8 }}>
            {[...client.uploads!].reverse().map((u, i) => (
              <div
                key={`${u.url}-${i}`}
                style={{
                  display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap",
                  padding: "8px 0", borderTop: "1px solid var(--border)",
                }}
              >
                <a href={u.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500, fontSize: 14 }}>
                  {u.name}
                </a>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{fmtSize(u.size)}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {u.at.slice(0, 10)}
                  {u.by ? ` · ${u.by}` : ""}
                  {u.note ? ` · ${u.note}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <EmailHistoryCard client={client} />

      <AssistantCard slug={slug} {...emailProp} />
        </>
      )}

      {tab === "details" && (
        <>
      <div className="card">
        <h3>The original brief</h3>
        <p className="empty-note" style={{ marginTop: 4 }}>What we were asked to build, as typed when the client was added.</p>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, whiteSpace: "pre-wrap" }}>
          {client.brief}
        </p>
      </div>

      <DeleteClient slug={slug} company={client.company} />
        </>
      )}
    </ConsoleShell>
  );
}
