// Per-document data contracts (what Claude fills) + HTML renderers.
// All money values are pre-formatted strings ("LKR 35,000" / "35,000") so the
// model owns rounding/formatting and the templates stay dumb.
import type { ClientRecord, DocType } from "../types";
import { esc, paras, clientBlock, metaRow, shell, type Mode } from "./shell";

export type EstimateData = {
  confidence: string;
  about: string;
  items: { title: string; desc: string; effort: string; range: string }[];
  lowTotal: string;
  highTotal: string;
  likelyTotal: string;
  totalNote: string;
  scaling: {
    title: string;
    rows: { scope: string; detail: string; range: string }[];
    note: string;
  } | null;
  changeFactors: string;
  nextStep: string;
};

export type QuotationData = {
  validUntil: string;
  scopeSummary: string;
  items: { title: string; desc: string; amount: string }[];
  total: string;
  paymentTerms: string[];
  notes: string;
};

export type InvoiceData = {
  dueDate: string;
  ref: string;
  items: { title: string; desc: string; amount: string }[];
  total: string;
  paymentNote: string;
};

export type ReceiptData = {
  datePaid: string;
  method: string;
  ref: string;
  items: { title: string; desc: string; amount: string }[];
  totalReceived: string;
  balanceNote: string;
};

export type ContractData = {
  agreementDate: string;
  sow: { engagement: string; term: string; deliverables: string; fees: string };
  clauses: { title: string; body: string }[];
};

export type ProposalData = {
  headline: string;
  validUntil: string;
  overview: string;
  objectives: { title: string; desc: string }[];
  phases: { phase: string; title: string; timeframe: string; desc: string }[];
  deliverables: string[];
  investment: string;
  whyUs: string;
  nextSteps: string;
};

type Ctx = {
  client: ClientRecord;
  docNo: string;
  issued: string;
  mode: Mode;
  pdfHref?: string;
};

const itemsTable = (
  cols: string,
  head: string[],
  rows: string[],
): string =>
  `<div class="tbl-head" style="grid-template-columns:${cols};">${head
    .map((h, i) => `<div${i === head.length - 1 ? ' style="text-align:right;"' : ""}>${esc(h)}</div>`)
    .join("")}</div>${rows.join("")}`;

export function renderEstimate(d: EstimateData, ctx: Ctx): string {
  const rows = d.items.map(
    (it, i) =>
      `<div class="tbl-row" style="grid-template-columns:30px 1fr 84px 140px;">
        <div class="mono" style="font-size:11.5px;color:var(--subtle);">${String(i + 1).padStart(2, "0")}</div>
        <div><div class="item-t">${esc(it.title)}</div><div class="item-d">${esc(it.desc)}</div></div>
        <div style="text-align:center;font-family:var(--mono);font-size:12px;">${esc(it.effort)}</div>
        <div class="amt">${esc(it.range)}</div>
      </div>`,
  );
  const scaling = d.scaling
    ? `<div class="box">
        <div class="sec-k">${esc(d.scaling.title)}</div>
        ${d.scaling.rows
          .map(
            (r) => `<div class="tbl-row" style="grid-template-columns:1fr 170px;padding:9px 2px;">
              <div style="font-size:12.5px;"><b>${esc(r.scope)}</b><span style="color:var(--muted);"> · ${esc(r.detail)}</span></div>
              <div class="amt">${esc(r.range)}</div>
            </div>`,
          )
          .join("")}
        <div class="small" style="margin-top:10px;">${esc(d.scaling.note)}</div>
      </div>`
    : "";
  const body = `
    <div class="section">
      <div class="sec-k">About this estimate</div>
      <div class="lead">${paras(d.about)}</div>
    </div>
    <div class="section">
      ${itemsTable("30px 1fr 84px 140px", ["#", "Workstream", "Effort", "Estimated range"], rows)}
    </div>
    <div class="totals"><div class="totals-box">
      <div class="t-row"><span>Low estimate</span><span>${esc(d.lowTotal)}</span></div>
      <div class="t-row"><span>High estimate</span><span>${esc(d.highTotal)}</span></div>
      <div class="t-main"><b>Likely total</b><span class="val">${esc(d.likelyTotal)}</span></div>
      <div class="t-note">${esc(d.totalNote)}</div>
    </div></div>
    ${scaling}
    <div class="cols2">
      <div><div class="sec-k">What could change it</div><div class="small">${esc(d.changeFactors)}</div></div>
      <div><div class="sec-k">Next step</div><div class="small">${esc(d.nextStep)}</div></div>
    </div>`;
  return shell({
    mode: ctx.mode,
    title: `Estimate ${ctx.docNo} — ${ctx.client.company}`,
    docTitle: "Estimate",
    pill: "For planning",
    metaLeft: clientBlock(ctx.client),
    metaRightRows: [
      metaRow("Estimate no.", ctx.docNo, true),
      metaRow("Issued", ctx.issued, true),
      metaRow("Confidence", d.confidence, true),
      metaRow("Prepared by", "Luminary Studio"),
    ],
    body,
    pdfHref: ctx.pdfHref,
  });
}

export function renderQuotation(d: QuotationData, ctx: Ctx): string {
  const rows = d.items.map(
    (it) => `<div class="tbl-row" style="grid-template-columns:1fr 150px;">
      <div><div class="item-t">${esc(it.title)}</div><div class="item-d">${esc(it.desc)}</div></div>
      <div class="amt">${esc(it.amount)}</div>
    </div>`,
  );
  const body = `
    <div class="section">
      <div class="sec-k">Project scope</div>
      <div class="lead">${paras(d.scopeSummary)}</div>
    </div>
    <div class="section">
      ${itemsTable("1fr 150px", ["Description", "Amount"], rows)}
    </div>
    <div class="totals"><div class="totals-box">
      <div class="t-main"><b>Total</b><span class="val">${esc(d.total)}</span></div>
      <div class="t-note">Fixed quotation · valid until ${esc(d.validUntil)}</div>
    </div></div>
    <div class="box">
      <div class="sec-k">Payment terms</div>
      <ul class="ticks">${d.paymentTerms.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>
    <div class="section"><div class="sec-k">Notes</div><div class="small">${esc(d.notes)}</div></div>`;
  return shell({
    mode: ctx.mode,
    title: `Quotation ${ctx.docNo} — ${ctx.client.company}`,
    docTitle: "Quotation",
    pill: "Fixed price",
    metaLeft: clientBlock(ctx.client),
    metaRightRows: [
      metaRow("Quote no.", ctx.docNo, true),
      metaRow("Issued", ctx.issued, true),
      metaRow("Valid until", d.validUntil, true),
      metaRow("Prepared by", "Luminary Studio"),
    ],
    body,
    pdfHref: ctx.pdfHref,
  });
}

export function renderInvoice(d: InvoiceData, ctx: Ctx): string {
  const rows = d.items.map(
    (it) => `<div class="tbl-row" style="grid-template-columns:1fr 150px;">
      <div><div class="item-t">${esc(it.title)}</div><div class="item-d">${esc(it.desc)}</div></div>
      <div class="amt">${esc(it.amount)}</div>
    </div>`,
  );
  const body = `
    <div class="section">
      ${itemsTable("1fr 150px", ["Description", "Amount"], rows)}
    </div>
    <div class="totals"><div class="totals-box">
      <div class="t-main"><b>Amount due</b><span class="val">${esc(d.total)}</span></div>
      <div class="t-note">Due ${esc(d.dueDate)}</div>
    </div></div>
    <div class="box"><div class="sec-k">Payment</div><div class="small">${paras(d.paymentNote)}</div></div>`;
  return shell({
    mode: ctx.mode,
    title: `Invoice ${ctx.docNo} — ${ctx.client.company}`,
    docTitle: "Invoice",
    pill: "Payment due",
    metaLeft: clientBlock(ctx.client, "Billed to"),
    metaRightRows: [
      metaRow("Invoice no.", ctx.docNo, true),
      metaRow("Issued", ctx.issued, true),
      metaRow("Due date", d.dueDate, true),
      metaRow("Ref / quote", d.ref, true),
    ],
    body,
    pdfHref: ctx.pdfHref,
  });
}

export function renderReceipt(d: ReceiptData, ctx: Ctx): string {
  const rows = d.items.map(
    (it) => `<div class="tbl-row" style="grid-template-columns:1fr 150px;">
      <div><div class="item-t">${esc(it.title)}</div><div class="item-d">${esc(it.desc)}</div></div>
      <div class="amt">${esc(it.amount)}</div>
    </div>`,
  );
  const body = `
    <div class="section">
      ${itemsTable("1fr 150px", ["Description", "Amount"], rows)}
    </div>
    <div class="totals"><div class="totals-box">
      <div class="t-main"><b>Total received</b><span class="val">${esc(d.totalReceived)}</span></div>
      <div class="t-note">${esc(d.balanceNote)}</div>
    </div></div>
    <div class="box"><div class="small">Thank you — this receipt confirms payment received by Luminary Studio. Keep it for your records.</div></div>`;
  return shell({
    mode: ctx.mode,
    title: `Receipt ${ctx.docNo} — ${ctx.client.company}`,
    docTitle: "Receipt",
    pill: "Paid",
    metaLeft: clientBlock(ctx.client, "Received from"),
    metaRightRows: [
      metaRow("Receipt no.", ctx.docNo, true),
      metaRow("Date paid", d.datePaid, true),
      metaRow("Method", d.method),
      metaRow("Ref / invoice", d.ref, true),
    ],
    body,
    pdfHref: ctx.pdfHref,
  });
}

export function renderContract(d: ContractData, ctx: Ctx): string {
  const body = `
    <div class="section">
      <div class="lead">This Agreement is made on <b>${esc(d.agreementDate)}</b> between <b>Luminary Studio</b> ("the Studio"), of Colombo, Sri Lanka, and <b>${esc(ctx.client.company)}</b> ("the Client")${ctx.client.address ? `, of ${esc(ctx.client.address)}` : ""}.</div>
    </div>
    <div class="section">
      <div class="sec-k">Statement of Work</div>
      <table class="sow">
        <tr><th>Engagement</th><td>${esc(d.sow.engagement)}</td></tr>
        <tr><th>Term</th><td>${esc(d.sow.term)}</td></tr>
        <tr><th>Deliverables</th><td>${esc(d.sow.deliverables)}</td></tr>
        <tr><th>Fees</th><td class="mono" style="font-weight:600;">${esc(d.sow.fees)}</td></tr>
      </table>
    </div>
    ${d.clauses
      .map(
        (c, i) => `<div class="clause">
          <div class="clause-t">${i + 1}. ${esc(c.title)}</div>
          ${paras(c.body)}
        </div>`,
      )
      .join("")}
    <div class="sig">
      <div class="sig-block"><div class="sig-k">For the Studio</div><div class="sig-line"></div><div class="sig-lab">Signature · Luminary Studio</div><div class="sig-line"></div><div class="sig-lab">Name & date</div></div>
      <div class="sig-block"><div class="sig-k">For the Client</div><div class="sig-line"></div><div class="sig-lab">Signature · ${esc(ctx.client.company)}</div><div class="sig-line"></div><div class="sig-lab">Name & date</div></div>
    </div>`;
  return shell({
    mode: ctx.mode,
    title: `Services Agreement ${ctx.docNo} — ${ctx.client.company}`,
    docTitle: "Services Agreement & SOW",
    pill: "For signature",
    metaLeft: clientBlock(ctx.client),
    metaRightRows: [
      metaRow("Ref", ctx.docNo, true),
      metaRow("Date", ctx.issued, true),
      metaRow("Prepared by", "Luminary Studio"),
    ],
    body,
    pdfHref: ctx.pdfHref,
  });
}

export function renderProposal(d: ProposalData, ctx: Ctx): string {
  const body = `
    <div class="section">
      <div class="sec-h" style="font-size:19px;">${esc(d.headline)}</div>
      <div class="lead">${paras(d.overview)}</div>
    </div>
    <div class="section">
      <div class="sec-k">Objectives</div>
      <div class="cols2" style="margin-top:8px;">
        ${d.objectives.map((o) => `<div><div class="item-t">${esc(o.title)}</div><div class="small">${esc(o.desc)}</div></div>`).join("")}
      </div>
    </div>
    <div class="section">
      <div class="sec-k">Scope of work</div>
      ${d.phases
        .map(
          (p) => `<div class="tbl-row" style="grid-template-columns:88px 1fr 110px;">
            <div class="mono" style="font-size:10px;letter-spacing:.1em;color:var(--a-text);text-transform:uppercase;">${esc(p.phase)}</div>
            <div><div class="item-t">${esc(p.title)}</div><div class="item-d">${esc(p.desc)}</div></div>
            <div style="text-align:right;font-family:var(--mono);font-size:11.5px;color:var(--muted);">${esc(p.timeframe)}</div>
          </div>`,
        )
        .join("")}
    </div>
    <div class="box">
      <div class="sec-k">Deliverables</div>
      <ul class="ticks">${d.deliverables.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>
    <div class="totals"><div class="totals-box">
      <div class="t-main"><b>Investment</b><span class="val" style="font-size:15px;">${esc(d.investment)}</span></div>
      <div class="t-note">Valid until ${esc(d.validUntil)}</div>
    </div></div>
    <div class="cols2">
      <div><div class="sec-k">Why Luminary</div><div class="small">${esc(d.whyUs)}</div></div>
      <div><div class="sec-k">Next steps</div><div class="small">${esc(d.nextSteps)}</div></div>
    </div>`;
  return shell({
    mode: ctx.mode,
    title: `Proposal ${ctx.docNo} — ${ctx.client.company}`,
    docTitle: "Project Proposal",
    pill: "Proposal",
    metaLeft: clientBlock(ctx.client),
    metaRightRows: [
      metaRow("Proposal no.", ctx.docNo, true),
      metaRow("Issued", ctx.issued, true),
      metaRow("Valid until", d.validUntil, true),
      metaRow("Prepared by", "Luminary Studio"),
    ],
    body,
    pdfHref: ctx.pdfHref,
  });
}

export function renderDoc(
  type: DocType,
  data: unknown,
  ctx: Ctx,
): string {
  switch (type) {
    case "estimate":
      return renderEstimate(data as EstimateData, ctx);
    case "quotation":
      return renderQuotation(data as QuotationData, ctx);
    case "invoice":
      return renderInvoice(data as InvoiceData, ctx);
    case "receipt":
      return renderReceipt(data as ReceiptData, ctx);
    case "contract":
      return renderContract(data as ContractData, ctx);
    case "proposal":
      return renderProposal(data as ProposalData, ctx);
  }
}
