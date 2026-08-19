// Per-document data contracts (what Claude fills) + HTML renderers.
// All money values are pre-formatted strings ("LKR 35,000" / "35,000") so the
// model owns rounding/formatting and the templates stay dumb.
import type { ClientRecord, DocType } from "../types";
import { esc, paras, clientBlock, metaRow, policyBox, shell, type Mode } from "./shell";
import { STUDIO_SIGNATURE, STUDIO_SIGNATURE_NAME } from "./signature";

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
  /** Line items. `pageType`/`qty`/`unitRate` are the optional structured
   *  pricing hooks: when present, lib/pipeline reconciles the amount and the
   *  quote total against lib/pricing.ts so money can never drift from the
   *  fixed per-page model. `amount` stays a pre-formatted string ("65,000")
   *  the renderer prints verbatim. */
  items: {
    title: string;
    desc: string;
    amount: string;
    pageType?: "primary" | "standard" | "functional" | null;
    qty?: number | null;
    unitRate?: number | null;
  }[];
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

/** Everything a renderer needs besides its own data. Exported so documents
 *  rendered outside this file (the handover pack) share the exact contract. */
export type Ctx = {
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
        <div class="mono rownum" style="font-size:11.5px;color:var(--subtle);">${String(i + 1).padStart(2, "0")}</div>
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
    ${policyBox()}
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

/** "2026-08-07T…Z" → "07 Aug 2026" (Colombo). Falls back to the raw string. */
const acceptedDate = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Colombo" })
    : iso;
};

/** The closing block of the quotation: the acceptance stamp once the client
 *  has accepted, otherwise the how-to-accept note — plus, on the web page
 *  only, the typed-name accept form (posts to the public /accept route on the
 *  client's subdomain; hidden when printing). */
function quotationAcceptBlock(ctx: Ctx): string {
  const acc = ctx.client.acceptance;
  if (acc) {
    return `<div class="box" style="background:var(--a-dim);border-color:var(--a-border);break-inside:avoid;">
      <div class="sec-k">Acceptance</div>
      <div style="font-size:13.5px;"><b>Accepted by ${esc(acc.name)} on ${esc(acceptedDate(acc.at))}</b></div>
      <div class="small" style="margin-top:4px;">Recorded via the client portal — the scope, price and payment terms above are confirmed. Next step: the 30% design-approval invoice once the design is approved.</div>
    </div>`;
  }
  const note = `<div class="section"><div class="sec-k">Accepting this quotation</div><div class="small">Reply by email confirming acceptance${ctx.mode === "web" ? ", or accept right here with your full name below" : ""}, or sign the accompanying Services Agreement — we'll then move into the design stage, and the 30% design-approval invoice follows once you approve the design. The payment terms above form part of this quotation.</div></div>`;
  if (ctx.mode !== "web") return note;
  const inputStyle =
    "flex:1 1 220px;min-width:0;border:1px solid var(--border-hi);background:var(--bg);color:var(--text);border-radius:10px;padding:10px 14px;font-family:var(--sans);font-size:14px;";
  const btnStyle =
    "border:none;cursor:pointer;background:var(--text);color:var(--bg);border-radius:100px;padding:11px 22px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;";
  return `${note}
  <div class="box" id="acceptBox" style="break-inside:avoid;">
    <div class="sec-k">Accept online</div>
    <div class="small">Type your full name and press accept — this records your acceptance of this quotation, including the payment terms above.</div>
    <form id="acceptForm" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;">
      <input type="text" name="company" value="" style="position:absolute;left:-9999px;top:-9999px;" tabindex="-1" autocomplete="off" aria-hidden="true">
      <input id="acceptName" type="text" placeholder="Your full name" maxlength="120" autocomplete="name" style="${inputStyle}">
      <button type="submit" id="acceptBtn" style="${btnStyle}">ACCEPT QUOTATION</button>
    </form>
    <div id="acceptMsg" class="small" style="display:none;margin-top:10px;"></div>
  </div>
  <style>@media print{#acceptBox{display:none!important;}}</style>
  <script>(function(){
var f=document.getElementById('acceptForm');if(!f)return;
var btn=document.getElementById('acceptBtn'),msg=document.getElementById('acceptMsg'),inp=document.getElementById('acceptName');
function say(t){msg.style.display='block';msg.textContent=t;}
function idle(){btn.disabled=false;btn.style.opacity='';btn.textContent='ACCEPT QUOTATION';}
f.addEventListener('submit',function(e){
e.preventDefault();
var n=inp.value.trim();
if(!n){say('Please type your full name first.');return;}
btn.disabled=true;btn.style.opacity='.6';btn.textContent='SENDING\\u2026';
fetch('/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,company:f.elements.company.value})})
.then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}}).catch(function(){return{ok:r.ok,d:{}}})})
.then(function(x){
if(x.ok){f.style.display='none';msg.style.display='block';msg.innerHTML='<b>Thank you \\u2014 quotation accepted.</b> '+((x.d&&x.d.already)?'(It was already accepted earlier, so nothing changed.) ':'')+'We\\u2019ll be in touch to start the design stage.';}
else{say((x.d&&x.d.error)||'Something went wrong \\u2014 please try again, or reply by email.');idle();}
})
.catch(function(){say('Network problem \\u2014 please try again.');idle();});
});})();</script>`;
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
    <div class="section"><div class="sec-k">Notes</div><div class="small">${esc(d.notes)}</div></div>
    ${quotationAcceptBlock(ctx)}`;
  return shell({
    mode: ctx.mode,
    title: `Quotation ${ctx.docNo} — ${ctx.client.company}`,
    docTitle: "Quotation",
    pill: ctx.client.acceptance ? "Accepted" : "Fixed price",
    metaLeft: clientBlock(ctx.client),
    metaRightRows: [
      metaRow("Quote no.", ctx.docNo, true),
      metaRow("Issued", ctx.issued, true),
      metaRow("Valid until", d.validUntil, true),
      ...(ctx.client.acceptance
        ? [metaRow("Accepted", acceptedDate(ctx.client.acceptance.at), true)]
        : [metaRow("Prepared by", "Luminary Studio")]),
    ],
    body,
    pdfHref: ctx.pdfHref,
  });
}

// Studio bank account shown on every invoice. Kept in one place so it stays
// identical across documents and is trivial to update. SWIFT/BIC is included
// because the payer group banks abroad; Currency + a payment reference round
// out what a local or international transfer needs.
export const BANK_DETAILS: { label: string; value: string }[] = [
  { label: "Account name", value: "RHDA Kumarasiri" },
  { label: "Account number", value: "8003636417" },
  { label: "Bank", value: "Commercial Bank of Ceylon PLC" },
  { label: "Branch", value: "Kaduwela" },
  { label: "Bank code", value: "7056" },
  { label: "Branch code", value: "042" },
  { label: "SWIFT / BIC", value: "CCEYLKLX" },
  { label: "Country", value: "Sri Lanka" },
  { label: "Currency", value: "LKR (Sri Lankan Rupees)" },
];

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
    <div class="box"><div class="sec-k">Payment</div><div class="small">${paras(d.paymentNote)}</div></div>
    <div class="box"><div class="sec-k">Bank transfer details</div>
      <div class="small" style="margin-top:6px;line-height:1.95;">${BANK_DETAILS.map(
        (r) => `${esc(r.label)}: <b>${esc(r.value)}</b>`,
      ).join("<br>")}</div>
      <div class="small" style="margin-top:10px;">Please use <b>${esc(ctx.docNo)}</b> as the payment reference so we can match your transfer.</div>
    </div>
    <div class="section"><div class="small">Any remaining balance falls due on delivery, payable before final handover. Work beyond the agreed scope is quoted separately as a written change order.</div></div>`;
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
    <div class="box"><div class="small">Thank you — this receipt confirms payment received by Luminary Studio. Keep it for your records. Any remaining balance falls due on delivery, payable before final handover; the 30-day post-launch defect warranty runs from the launch date.</div></div>`;
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

/** The client's electronic-signature block on the Services Agreement: the stamp
 *  once signed, otherwise (web only) a typed-name sign form posting to the
 *  public /sign-contract route. Hidden when printing. */
function contractSignBlock(ctx: Ctx): string {
  const sig = ctx.client.contractSignature;
  if (sig) {
    return `<div class="box" style="background:var(--a-dim);border-color:var(--a-border);break-inside:avoid;">
      <div class="sec-k">Client signature</div>
      <div style="font-size:13.5px;"><b>Signed by ${esc(sig.name)} on ${esc(acceptedDate(sig.at))}</b></div>
      <div class="small" style="margin-top:4px;">Signed electronically via the client portal. Under Sri Lanka's Electronic Transactions Act No. 19 of 2006, this electronic signature has the same legal effect as a handwritten one.</div>
    </div>`;
  }
  if (ctx.mode !== "web") return "";
  const inputStyle =
    "flex:1 1 220px;min-width:0;border:1px solid var(--border-hi);background:var(--bg);color:var(--text);border-radius:10px;padding:10px 14px;font-family:var(--sans);font-size:14px;";
  const btnStyle =
    "border:none;cursor:pointer;background:var(--text);color:var(--bg);border-radius:100px;padding:11px 22px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;";
  return `<div class="box" id="signBox" style="break-inside:avoid;">
    <div class="sec-k">Sign online</div>
    <div class="small">Type your full name and press sign — this records your acceptance of this Services Agreement and Statement of Work. Legally valid under the Electronic Transactions Act No. 19 of 2006.</div>
    <form id="signForm" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;">
      <input type="text" name="company" value="" style="position:absolute;left:-9999px;top:-9999px;" tabindex="-1" autocomplete="off" aria-hidden="true">
      <input id="signName" type="text" placeholder="Your full name" maxlength="120" autocomplete="name" style="${inputStyle}">
      <button type="submit" id="signBtn" style="${btnStyle}">SIGN AGREEMENT</button>
    </form>
    <div id="signMsg" class="small" style="display:none;margin-top:10px;"></div>
  </div>
  <style>@media print{#signBox{display:none!important;}}</style>
  <script>(function(){
var f=document.getElementById('signForm');if(!f)return;
var btn=document.getElementById('signBtn'),msg=document.getElementById('signMsg'),inp=document.getElementById('signName');
function say(t){msg.style.display='block';msg.textContent=t;}
function idle(){btn.disabled=false;btn.style.opacity='';btn.textContent='SIGN AGREEMENT';}
f.addEventListener('submit',function(e){
e.preventDefault();
var n=inp.value.trim();
if(!n){say('Please type your full name first.');return;}
btn.disabled=true;btn.style.opacity='.6';btn.textContent='SIGNING\\u2026';
fetch('/sign-contract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,company:f.elements.company.value})})
.then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}}).catch(function(){return{ok:r.ok,d:{}}})})
.then(function(x){
if(x.ok){f.style.display='none';msg.style.display='block';msg.innerHTML='<b>Thank you \\u2014 agreement signed.</b> '+((x.d&&x.d.already)?'(It was already signed earlier.) ':'')+'We\\u2019ll be in touch with the next steps.';}
else{say((x.d&&x.d.error)||'Something went wrong \\u2014 please try again, or reply by email.');idle();}
})
.catch(function(){say('Network problem \\u2014 please try again.');idle();});
});})();</script>`;
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
        // The template owns clause numbering — strip any the model added.
        (c, i) => `<div class="clause">
          <div class="clause-t">${i + 1}. ${esc(c.title.replace(/^\d+[.)]\s*/, ""))}</div>
          ${paras(c.body)}
        </div>`,
      )
      .join("")}
    ${contractSignBlock(ctx)}
    <div class="sig">
      <div class="sig-block">
        <div class="sig-k">For the Studio</div>
        <div style="background:#fff;border-radius:6px;padding:4px 8px;display:inline-block;margin:8px 0 4px;">
          <img src="${STUDIO_SIGNATURE}" alt="Signature of ${esc(STUDIO_SIGNATURE_NAME)}" style="height:58px;width:auto;max-width:240px;object-fit:contain;display:block;" />
        </div>
        <div class="sig-lab" style="font-weight:600;color:var(--text);">${esc(STUDIO_SIGNATURE_NAME)}</div>
        <div class="sig-lab">${esc(d.agreementDate)}</div>
      </div>
      <div class="sig-block">
        <div class="sig-k">For the Client</div>
        <div class="sig-line"></div>
        <div class="sig-lab">Signature · ${esc(ctx.client.company)}</div>
        <div class="sig-line"></div>
        <div class="sig-lab">Name</div>
        <div class="sig-line"></div>
        <div class="sig-lab">Date</div>
      </div>
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
    ${policyBox()}
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
