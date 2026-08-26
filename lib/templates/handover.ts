// The handover pack — the document that closes a project out: what was built,
// every document issued against it, an empty credentials table for the
// operator to fill in, the warranty window, the care-plan pitch and the money
// summary. It renders through the same shell as every other Luminary
// document, so it inherits the tokens, print rules and PDF pipeline for free.
//
// Unlike the invoices and receipts it sits beside in `billing[]`, this one is
// NOT drafted by the AI layer: every field is derived from the record (see
// lib/handover.ts). A handover pack is a statement of fact — doc numbers,
// dates, totals — and facts are exactly what a language model has no business
// inventing. It also means regenerating one is free and instant.
import { esc, paras, clientBlock, metaRow, shell } from "./shell";
import type { Ctx } from "./docs";

export type HandoverData = {
  projectLabel: string;
  /** 2-3 sentences: what was built and for whom. */
  summary: string;
  /** What the client now owns, one line each. */
  deliverables: string[];
  /** "07 Aug 2026" — or "—" when delivery hasn't been stamped yet. */
  deliveredOn: string;
  /** 30 days after delivery. "—" when delivery is unknown. */
  warrantyUntil: string;
  warranty: string;
  /** Every document issued on this project, oldest first. */
  docIndex: { label: string; no: string; date: string }[];
  /** Rows the operator completes by hand before sending. */
  credentials: { system: string; detail: string }[];
  payment: {
    invoiced: string;
    paid: string;
    outstanding: string;
    settled: boolean;
    /** Published invoices, so the client can reconcile line by line. */
    lines: { no: string; label: string; amount: string; paid: string }[];
    /** Doc numbers whose total couldn't be read (never silently summed). */
    unparsable: string[];
  };
  care: string;
  nextSteps: string;
};

const BLANK = `<div style="border-bottom:1px solid var(--border-hi);height:15px;"></div>`;

export function renderHandover(d: HandoverData, ctx: Ctx): string {
  const docRows = d.docIndex
    .map(
      (r) => `<div class="tbl-row" style="grid-template-columns:1fr 150px 110px;">
        <div><div class="item-t">${esc(r.label)}</div></div>
        <div class="mono" style="font-size:12px;">${esc(r.no)}</div>
        <div style="text-align:right;font-family:var(--mono);font-size:11.5px;color:var(--muted);">${esc(r.date)}</div>
      </div>`,
    )
    .join("");

  // Deliberately blank: the operator fills these in by hand (or in the
  // printed copy) at the handover meeting. Pre-filling credentials from the
  // console would mean storing them there, which we do not do.
  const credRows = d.credentials
    .map(
      (c) => `<div class="tbl-row" style="grid-template-columns:190px 1fr 150px;">
        <div><div class="item-t">${esc(c.system)}</div><div class="item-d">${esc(c.detail)}</div></div>
        <div>${BLANK}</div>
        <div>${BLANK}</div>
      </div>`,
    )
    .join("");

  const payRows = d.payment.lines
    .map(
      (l) => `<div class="tbl-row" style="grid-template-columns:1fr 130px 130px;">
        <div><div class="item-t">${esc(l.label)}</div><div class="item-d mono">${esc(l.no)}</div></div>
        <div class="amt">${esc(l.amount)}</div>
        <div class="amt" style="color:var(--muted);">${esc(l.paid)}</div>
      </div>`,
    )
    .join("");

  const body = `
    <div class="section">
      <div class="sec-k">Project summary</div>
      <div class="lead">${paras(d.summary)}</div>
    </div>
    ${
      d.deliverables.length
        ? `<div class="box">
      <div class="sec-k">What you now have</div>
      <ul class="ticks">${d.deliverables.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>`
        : ""
    }
    <div class="section">
      <div class="sec-k">Documents issued</div>
      ${
        // Same guard as the payment table below: an unconditional header over
        // an empty list rendered as a dangling rule with nothing under it.
        d.docIndex.length
          ? `<div class="tbl-head" style="grid-template-columns:1fr 150px 110px;">
              <div>Document</div><div>Number</div><div style="text-align:right;">Date</div>
            </div>${docRows}`
          : `<div class="small">No documents have been published to your portal for this project.</div>`
      }
    </div>
    <div class="section">
      <div class="sec-k">Access &amp; credentials</div>
      <div class="small">Completed by Luminary at handover. Once these are transferred, change every password
      and enable two-factor authentication where the service offers it. We keep no copy.</div>
      <div class="tbl-head tbl-head--keep" style="grid-template-columns:190px 1fr 150px;margin-top:10px;">
        <div>System</div><div>Location / username</div><div>Handed over</div>
      </div>
      ${credRows}
    </div>
    <div class="box">
      <div class="sec-k">Warranty</div>
      <div class="small" style="color:var(--text);">${esc(d.warranty)}</div>
      <div class="meta-rows" style="margin-top:12px;">
        ${metaRow("Delivered", d.deliveredOn, true)}
        ${metaRow("Warranty runs until", d.warrantyUntil, true)}
      </div>
    </div>
    <div class="section">
      <div class="sec-k">Payment summary</div>
      ${
        d.payment.lines.length
          ? `<div class="tbl-head" style="grid-template-columns:1fr 130px 130px;">
              <div>Invoice</div><div style="text-align:right;">Invoiced</div><div style="text-align:right;">Received</div>
            </div>${payRows}`
          : `<div class="small">No invoices have been issued against this project.</div>`
      }
      ${
        // Totals only mean something once something was invoiced. With no
        // published invoice the box read "Total invoiced LKR 0 / Total
        // received LKR 47,000 / Balance LKR 0" — three numbers that
        // contradict each other on a document the client signs.
        d.payment.lines.length
          ? `<div class="totals"><div class="totals-box">
        <div class="t-row"><span>Total invoiced</span><span>${esc(d.payment.invoiced)}</span></div>
        <div class="t-row"><span>Total received</span><span>${esc(d.payment.paid)}</span></div>
        <div class="t-main"><b>${d.payment.settled ? "Balance" : "Outstanding"}</b><span class="val">${esc(d.payment.outstanding)}</span></div>
        <div class="t-note">${d.payment.settled ? "Account settled in full · IP transferred" : "Payable before final handover"}</div>
      </div></div>`
          : ""
      }
      ${
        d.payment.unparsable.length
          ? `<div class="small" style="margin-top:8px;">Not included in the totals above (amount stated in words on the document): ${esc(d.payment.unparsable.join(", "))}.</div>`
          : ""
      }
    </div>
    <div class="cols2">
      <div><div class="sec-k">Ongoing care</div><div class="small">${esc(d.care)}</div></div>
      <div><div class="sec-k">Next steps</div><div class="small">${esc(d.nextSteps)}</div></div>
    </div>
    <div class="sig">
      <div class="sig-block"><div class="sig-k">Handed over by</div><div class="sig-line"></div><div class="sig-lab">Signature · Luminary Studio</div><div class="sig-line"></div><div class="sig-lab">Name &amp; date</div></div>
      <div class="sig-block"><div class="sig-k">Received by</div><div class="sig-line"></div><div class="sig-lab">Signature · ${esc(ctx.client.company)}</div><div class="sig-line"></div><div class="sig-lab">Name &amp; date</div></div>
    </div>`;

  return shell({
    mode: ctx.mode,
    title: `Handover pack ${ctx.docNo} · ${ctx.client.company}`,
    docTitle: "Handover Pack",
    pill: "Project complete",
    metaLeft: clientBlock(ctx.client, "Handed over to"),
    metaRightRows: [
      metaRow("Handover no.", ctx.docNo, true),
      metaRow("Issued", ctx.issued, true),
      metaRow("Project", d.projectLabel),
      metaRow("Prepared by", "Luminary Studio"),
    ],
    body,
    ...(ctx.pdfHref !== undefined ? { pdfHref: ctx.pdfHref } : {}),
  });
}
