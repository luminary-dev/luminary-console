// End-to-end orchestration used by the API routes.
// Stage 1 (create client): Claude drafts estimate + extra questions → render
// + PDF → publish → domain automation → studio email.
// Stage 2 (answers in): answers PDF + emails, then Claude drafts quotation /
// proposal / contract for review.
import type { Answers, BillingDoc, ClientRecord, DocMeta, DocType, DocVersion } from "./types";
import { BILLING_NO_PREFIX, DOC_NO_PREFIX } from "./types";
import { fetchAsset, getClient, nextDocNoBase, putAsset, saveClient } from "./store";
import { renderDoc, type Ctx, type EstimateData, type QuotationData } from "./templates/docs";
import { renderHandover, type HandoverData } from "./templates/handover";
import { renderAnswers } from "./templates/answers";
import { renderPdf } from "./pdf";
import { emailStudio } from "./email";
import { ensureClientDomain } from "./domains";
import { stage1, stage2 } from "./generate";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;

export const todayLabel = () =>
  new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Colombo",
  });

export const nowLabel = () =>
  new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function docNo(client: ClientRecord, type: DocType): string {
  return `${DOC_NO_PREFIX[type]}${client.docNoBase}`;
}

/** How many superseded renders of one document we keep. */
export const HISTORY_CAP = 10;

/** Remember the render a document is about to lose. Call this immediately
 *  before a revise/regenerate re-renders `doc` — every save writes brand-new
 *  random-suffixed keys, so the URLs already on the record keep resolving
 *  and archiving them costs nothing but the pointer. Oldest entries fall off
 *  at HISTORY_CAP; a doc that has never been rendered is skipped. */
export function archiveVersion(doc: {
  no: string;
  htmlUrl: string;
  pdfUrl: string;
  updatedAt: string;
  history?: DocVersion[];
}): void {
  if (!doc.htmlUrl || !doc.pdfUrl) return;
  const entry: DocVersion = {
    no: doc.no,
    htmlUrl: doc.htmlUrl,
    pdfUrl: doc.pdfUrl,
    at: doc.updatedAt || new Date().toISOString(),
  };
  doc.history = [...(doc.history ?? []), entry].slice(-HISTORY_CAP);
}

/** Render + persist a document (HTML page, PDF) and update the record.
 *  `issued` overrides the printed issue date (used when re-rendering an
 *  already-issued document, e.g. stamping an acceptance onto a quotation). */
export async function saveDoc(
  client: ClientRecord,
  type: DocType,
  data: unknown,
  status: DocMeta["status"],
  issued?: string,
): Promise<DocMeta> {
  const no = docNo(client, type);
  const ctx = { client, docNo: no, issued: issued ?? todayLabel() };
  const webHtml = renderDoc(type, data, { ...ctx, mode: "web", pdfHref: `${type}/pdf` });
  const pdfHtml = renderDoc(type, data, { ...ctx, mode: "pdf" });
  const pdf = await renderPdf(pdfHtml);
  const htmlUrl = await putAsset(`clients/${client.slug}/docs/${type}.html`, webHtml, "text/html; charset=utf-8");
  const pdfUrl = await putAsset(`clients/${client.slug}/docs/${type}.pdf`, pdf, "application/pdf");
  // This replaces the meta wholesale, so carry the archive across explicitly
  // — losing it here would silently empty the history on every re-render.
  const history = client.docs[type]?.history;
  const meta: DocMeta = {
    type,
    no,
    status,
    updatedAt: new Date().toISOString(),
    htmlUrl,
    pdfUrl,
    data,
    ...(history?.length ? { history } : {}),
  };
  client.docs[type] = meta;
  return meta;
}

/** Renderer for one `billing[]` entry. Invoices and receipts go through the
 *  shared DocType renderer; the handover pack has its own (and its own data
 *  contract), but the same shell, so everything downstream is identical. */
function renderBilling(kind: BillingDoc["kind"], data: unknown, ctx: Ctx): string {
  return kind === "handover"
    ? renderHandover(data as HandoverData, ctx)
    : renderDoc(kind, data, ctx);
}

/** Render + persist an invoice/receipt/handover pack. New docs get the next
 *  sequence number (LUM-INV-0044-01, -02…); pass `existingSlug` to re-render
 *  one. The first handover pack is plain LUM-HOP-0044 (there is normally only
 *  ever one) and later ones fall back to the suffixed form so a number is
 *  never reused. */
export async function saveBillingDoc(
  client: ClientRecord,
  kind: BillingDoc["kind"],
  stage: BillingDoc["stage"],
  data: unknown,
  status: DocMeta["status"],
  existingSlug?: string,
): Promise<BillingDoc> {
  client.billing = client.billing ?? [];
  let doc = existingSlug ? client.billing.find((b) => b.slug === existingSlug) : undefined;
  if (!doc) {
    // Max existing sequence + 1, not count + 1: deleting a middle document
    // must never make the next one collide with a surviving slug/number.
    const seq =
      client.billing
        .filter((b) => b.kind === kind)
        .reduce((m, b) => Math.max(m, parseInt(b.slug.split("-").pop() ?? "", 10) || 0), 0) + 1;
    const suffix = kind === "handover" && seq === 1 ? "" : `-${String(seq).padStart(2, "0")}`;
    doc = {
      kind,
      stage,
      slug: `${kind}-${seq}`,
      no: `${BILLING_NO_PREFIX[kind]}${client.docNoBase}${suffix}`,
      status,
      updatedAt: "",
      htmlUrl: "",
      pdfUrl: "",
      data,
    };
    client.billing.push(doc);
  }
  const ctx = { client, docNo: doc.no, issued: todayLabel() };
  const webHtml = renderBilling(kind, data, { ...ctx, mode: "web", pdfHref: `${doc.slug}/pdf` });
  const pdfHtml = renderBilling(kind, data, { ...ctx, mode: "pdf" });
  const pdf = await renderPdf(pdfHtml);
  doc.htmlUrl = await putAsset(`clients/${client.slug}/billing/${doc.slug}.html`, webHtml, "text/html; charset=utf-8");
  doc.pdfUrl = await putAsset(`clients/${client.slug}/billing/${doc.slug}.pdf`, pdf, "application/pdf");
  doc.data = data;
  doc.status = status;
  doc.updatedAt = new Date().toISOString();
  return doc;
}

export async function runStage1(input: {
  slug: string;
  company: string;
  reg?: string;
  address?: string;
  email?: string;
  phone?: string;
  contactName?: string;
  brief: string;
}): Promise<ClientRecord> {
  const docNoBase = await nextDocNoBase();
  const client: ClientRecord = {
    ...input,
    projectLabel: "",
    docNoBase,
    status: "created",
    createdAt: new Date().toISOString(),
    domain: `${input.slug}.${ROOT}`,
    dnsStatus: "manual_required",
    extraQuestions: [],
    docs: {},
  };

  // 1. Claude drafts the estimate + tailored questions.
  const result = await stage1(client, todayLabel());
  client.projectLabel = result.projectLabel;
  client.extraQuestions = result.extraQuestions.map((q) => ({
    ...q,
    hint: q.hint ?? undefined,
  }));

  // 2. Render + publish the estimate (client-visible immediately).
  const estimateMeta = await saveDoc(client, "estimate", result.estimate, "published");

  // 3. Domain automation (never fails the pipeline).
  const dns = await ensureClientDomain(client.slug);
  client.dnsStatus = dns.status;

  await saveClient(client);

  // 4. Studio email with the estimate PDF + all links.
  const pdfRes = await fetchAsset(estimateMeta.pdfUrl);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  await emailStudio(
    `New client set up — ${client.company} (${estimateMeta.no})`,
    `<p><strong>${client.company}</strong> is set up on the console.</p>
<p>Project: ${client.projectLabel}<br>
Estimate: <a href="https://${client.domain}/estimate">https://${client.domain}/estimate</a><br>
Questionnaire: <a href="https://${client.domain}/questionnaire">https://${client.domain}/questionnaire</a><br>
Console: <a href="https://${CONSOLE_HOST}/clients/${client.slug}">https://${CONSOLE_HOST}/clients/${client.slug}</a></p>
<p>DNS: ${dns.status === "automated" ? "automated ✓" : `${dns.status} — ${dns.detail}`}</p>
<p>The estimate PDF is attached. Review it, then send the links to the client.</p>`,
    [{ filename: `Estimate - ${client.company} - ${estimateMeta.no}.pdf`, content: pdfBuf }],
  );

  return client;
}

export async function runStage2(slug: string, answers: Answers, submittedAt: string): Promise<void> {
  const client = await getClient(slug);
  if (!client) return;
  try {
    const estimate = (client.docs.estimate?.data as EstimateData) ?? null;
    const drafts = await stage2(client, answers, estimate, todayLabel());

    await saveDoc(client, "quotation", drafts.quotation, "draft");
    await saveDoc(client, "proposal", drafts.proposal, "draft");
    await saveDoc(client, "contract", drafts.contract, "draft");
    client.status = "drafts_ready";
    await saveClient(client);

    const attachments = await Promise.all(
      (["quotation", "proposal", "contract"] as DocType[]).map(async (t) => {
        const meta = client.docs[t]!;
        const res = await fetchAsset(meta.pdfUrl);
        return {
          filename: `${t[0].toUpperCase()}${t.slice(1)} DRAFT - ${client.company} - ${meta.no}.pdf`,
          content: Buffer.from(await res.arrayBuffer()),
        };
      }),
    );

    await emailStudio(
      `Drafts ready — ${client.company} (quotation · proposal · contract)`,
      `<p><strong>${client.company}</strong> submitted the questionnaire at ${submittedAt}, and the follow-up documents have been drafted from their answers.</p>
<p>All three are attached as PDFs and sitting in the console as <b>drafts</b> — nothing is client-visible until you publish:</p>
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Review & publish in the console →</a></p>`,
      attachments,
    );
  } catch (e) {
    console.error("Stage 2 drafting failed:", e);
    await emailStudio(
      `Draft generation failed — ${client.company}`,
      `<p>The questionnaire answers arrived (see previous email) but automatic drafting failed: ${String(e)}.</p><p>You can retry from the console.</p>`,
    );
  }
}

export type { EstimateData, QuotationData };
