"use client";

// The payment arc, in one card: generate the design-approval invoice (30%) →
// receipt → final delivery invoice (70%) → final receipt. Post-delivery change
// orders are billed as their own additional invoices once completed. Each doc
// can be previewed, revised, published.
import { sentenceCase } from "@/lib/sentence-case";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BillingDoc, Payment } from "@/lib/types";
import { fmtLKR, invoiceStatus, invoiceTotal, paidAgainst, parseAmount, summarizeMoney } from "@/lib/money";
// One naming rule for billing documents, shared with the portal, the email
// route and the comment box — "Final invoice", "Handover pack".
import { billingLabel } from "@/lib/doclabels";

import EmailDocButton from "./EmailDocButton";
import HowItWorks from "./HowItWorks";
import MoreActions from "./MoreActions";
import DocHistory from "./DocHistory";
import RelativeTime from "./RelativeTime";
import { useConfirm } from "./ConfirmDialog";
import { opsFetch } from "@/lib/ops-fetch";
import { DAY_RATE, fmtLKR as fmtPrice } from "@/lib/pricing";

export default function BillingCard({
  slug,
  billing,
  payments,
  hasQuotation,
  email,
  views = {},
}: {
  slug: string;
  billing: BillingDoc[];
  payments: Payment[];
  hasQuotation: boolean;
  email?: string;
  /** docKey → last-opened ISO (client read-receipts). */
  views?: Record<string, string>;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [otherFor, setOtherFor] = useState<"invoice" | "receipt" | null>(null);
  const [otherText, setOtherText] = useState("");

  const call = async (payload: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    const res = await opsFetch(`/api/clients/${slug}/billing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setError(data?.error || `Failed (${res.status})`);
      return false;
    }
    setReviseFor(null);
    setInstructions("");
    setOtherFor(null);
    setOtherText("");
    router.refresh();
    return true;
  };

  // Deleting is for mistakes only, so it's deliberately slow: a published
  // document must be unpublished first (confirmed), then deletion itself is
  // confirmed again; a draft just confirms once.
  const remove = async (b: BillingDoc) => {
    const label = `the ${billingLabel(b).toLowerCase()} ${b.no}`;
    if (b.status === "published") {
      const step1 = await confirm({
        title: "Unpublish first",
        danger: true,
        confirmLabel: "Unpublish",
        message: (
          <>
            <b>{b.no}</b> is <b>published</b>. It must be unpublished before it can be deleted.
            Unpublish it now?
          </>
        ),
      });
      if (!step1) return;
      if (!(await call({ action: "unpublish", doc: b.slug }, `unpub-${b.slug}`))) return;
      const step2 = await confirm({
        title: "Delete document",
        danger: true,
        confirmLabel: "Delete permanently",
        message: (
          <>
            <b>{b.no}</b> is now unpublished. Permanently delete {label}? This cannot be undone.
          </>
        ),
      });
      if (!step2) return;
    } else {
      const sure = await confirm({
        title: "Delete document",
        danger: true,
        confirmLabel: "Delete permanently",
        message: <>Permanently delete {label}? This cannot be undone.</>,
      });
      if (!sure) return;
    }
    await call({ action: "delete", doc: b.slug }, `del-${b.slug}`);
  };

  // Payments API (add/remove) — same refresh flow as the billing actions.
  const callPayments = async (payload: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    const res = await opsFetch(`/api/clients/${slug}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setError(data?.error || `Failed (${res.status})`);
      return false;
    }
    router.refresh();
    return true;
  };

  // "Mark paid": confirm with the amount prefilled (the invoice's remaining
  // balance where the total parses; blank otherwise) — the operator can
  // adjust it for partial payments.
  const markPaid = async (b: BillingDoc) => {
    const total = invoiceTotal(b);
    const paid = paidAgainst(payments, b.slug);
    const remaining = total !== null ? Math.max(0, total - paid) : null;
    const typed = await confirm({
      title: "Record payment",
      confirmLabel: "Record payment",
      message: (
        <>
          Record a payment received against <b>{b.no}</b>
          {total !== null ? (
            <>
              {" "}
              (invoice total <b>{fmtLKR(total)}</b>
              {paid > 0 ? <>, {fmtLKR(paid)} already recorded</> : null})
            </>
          ) : (
            <>: the invoice total couldn&apos;t be read automatically, so enter the amount received</>
          )}
          . Amount in LKR:
        </>
      ),
      prompt: {
        placeholder: "e.g. 22,500",
        initial: remaining && remaining > 0 ? remaining.toLocaleString("en-US") : "",
      },
    });
    if (typed === null) return;
    const amount = parseAmount(typed);
    if (amount === null || amount <= 0) {
      setError("That amount didn't parse: digits only, e.g. 22,500.");
      return;
    }
    await callPayments(
      { action: "add", amount, method: "bank transfer", invoiceSlug: b.slug },
      `pay-${b.slug}`,
    );
  };

  const removePayment = async (p: Payment, index: number) => {
    const sure = await confirm({
      title: "Remove payment",
      danger: true,
      confirmLabel: "Remove",
      message: (
        <>
          Remove the <b>{fmtLKR(p.amount)}</b> payment recorded on {p.at.slice(0, 10)}
          {p.invoiceSlug ? (
            <>
              {" "}
              against <b className="mono">{p.invoiceSlug}</b>
            </>
          ) : null}
          ? The outstanding balance goes back up.
        </>
      ),
    });
    if (!sure) return;
    await callPayments({ action: "remove", index }, `unpay-${index}`);
  };

  const money = summarizeMoney(billing, payments);
  const hasPublishedInvoice = billing.some((b) => b.kind === "invoice" && b.status === "published");

  // A fixed milestone document (design-approval / delivery invoice or receipt)
  // exists once. Once it has been generated, hide its button — there is no
  // reason to make another, and extra work billed after settlement uses the
  // Additional invoice/receipt below.
  const gen = (kind: string, stage: string, label: string) => {
    if (billing.some((b) => b.kind === kind && b.stage === stage)) return null;
    return (
      <button
        key={label}
        className="btn ghost small"
        disabled={!!busy || !hasQuotation}
        onClick={() => call({ action: "generate", kind, stage }, label)}
      >
        {busy === label ? "Working… (up to a minute)" : label}
      </button>
    );
  };

  return (
    <div className="card">
      <h3>Invoices and receipts</h3>
      <p className="empty-note" style={{ marginTop: 4 }}>
        A project is paid in two parts: 30% when the client approves the design, and 70% on
        delivery. Each part gets an invoice, then a receipt once the money arrives.
        {!hasQuotation && " You can make the first invoice once there is a quotation."}
      </p>
      <HowItWorks>
        <p>
          There is no payment on signing. Work on the site starts when the 30% invoice is paid.
          Changes the client asks for after everything is settled get their own extra invoice and
          receipt once that work is done: use &quot;Something extra&quot; below.
        </p>
      </HowItWorks>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <span className="k">Make</span>
        {gen("invoice", "progress", "30% invoice (design approved)")}
        {gen("receipt", "progress", "Receipt for the 30%")}
        {gen("invoice", "final", "70% invoice (on delivery)")}
        {gen("receipt", "final", "Receipt for the 70%")}
        <MoreActions label="Something extra">
          <button
            className="btn ghost small"
            disabled={!!busy || !hasQuotation}
            onClick={() => setOtherFor(otherFor === "invoice" ? null : "invoice")}
          >
            Extra invoice
          </button>
          <button
            className="btn ghost small"
            disabled={!!busy || !hasQuotation}
            onClick={() => setOtherFor(otherFor === "receipt" ? null : "receipt")}
          >
            Extra receipt
          </button>
        </MoreActions>
      </div>
      {otherFor && (
        <div style={{ marginTop: 12 }}>
          <textarea
            aria-label="Billing instructions"
            className="q-box"
            rows={2}
            placeholder={
              otherFor === "invoice"
                ? `What extra work is being billed, and for how much? e.g. “Booking integration requested after launch, 2 working days, ${fmtPrice(2 * DAY_RATE)}”`
                : "Which payment was received? e.g. “Payment received in full for additional invoice LUM-INV-0044-03”"
            }
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
          />
          <button
            className="btn small"
            style={{ marginTop: 8 }}
            disabled={!!busy || !otherText.trim()}
            onClick={() => call({ action: "generate", kind: otherFor, stage: "other", instructions: otherText }, `other-${otherFor}`)}
          >
            {busy === `other-${otherFor}` ? "Working… (up to a minute)" : `Generate additional ${otherFor}`}
          </button>
        </div>
      )}

      {billing.length > 0 && (
        <div className="table-scroll">
          <table className="list list--wide">
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
              {billing.map((b) => {
                const isInvoice = b.kind === "invoice";
                const total = isInvoice ? invoiceTotal(b) : null;
                const paid = isInvoice ? paidAgainst(payments, b.slug) : 0;
                const fullyPaid = isInvoice && total !== null && total > 0 && paid >= total;
                const dueDate = isInvoice ? (b.data as { dueDate?: string })?.dueDate : undefined;
                const st = isInvoice && b.status === "published" ? invoiceStatus(b, payments) : null;
                const viewedAt = views[b.slug];
                return (
                <tr key={b.slug}>
                  <td style={{ fontWeight: 500 }}>{billingLabel(b)}</td>
                  <td className="mono">{b.no}</td>
                  <td>
                    <span className={`pill${b.status === "draft" ? " grey" : ""}`}>
                      <i />
                      {sentenceCase(b.status)}
                    </span>
                    {b.status === "published" && viewedAt && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--a-text)" }}>
                        opened <RelativeTime at={viewedAt} />
                      </div>
                    )}
                    {isInvoice && (dueDate || paid > 0) && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {fullyPaid ? (
                          <span className="pill">
                            <i />
                            Paid
                          </span>
                        ) : (
                          <>
                            {dueDate && <div>Due {dueDate}</div>}
                            {st?.overdue && (
                              <div style={{ marginTop: 4 }}>
                                <span className="pill" style={{ background: "var(--danger, #d33)", color: "#fff", borderColor: "transparent" }}>
                                  Overdue by {st.overdueDays} day{st.overdueDays === 1 ? "" : "s"}
                                </span>
                              </div>
                            )}
                            {st?.dueSoon && (
                              <div style={{ marginTop: 4 }}>
                                <span className="pill" style={{ background: "#b45309", color: "#fff", borderColor: "transparent" }}>Due soon</span>
                              </div>
                            )}
                            {paid > 0 && (
                              <div className="mono">
                                {fmtLKR(paid)}{total !== null ? ` of ${fmtLKR(total)}` : ""} paid
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a href={`/preview/${slug}/${b.slug}`} target="_blank" rel="noopener noreferrer">
                      Preview
                    </a>
                    {" · "}
                    <a href={b.htmlUrl} title="Download the HTML file">
                      HTML ↓
                    </a>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    {/* One main action per row, the rest behind More. A draft is
                        sent; an unpaid invoice is marked paid; anything
                        published can be emailed again. */}
                    <div className="row-actions">
                      {b.status === "draft" && email && (
                        <button
                          className="btn small"
                          disabled={!!busy}
                          onClick={async () => {
                            setBusy(`pubemail-${b.slug}`);
                            setError(null);
                            const p = await opsFetch(`/api/clients/${slug}/billing`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "publish", doc: b.slug }),
                            });
                            if (!p.ok) { setBusy(null); setError("Publish failed."); return; }
                            const s = await opsFetch(`/api/clients/${slug}/send`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ docs: [b.slug] }),
                            });
                            setBusy(null);
                            if (!s.ok) setError("Published, but the email failed. Use Email to retry.");
                            router.refresh();
                          }}
                        >
                          {busy === `pubemail-${b.slug}` ? "Working…" : "Publish and email"}
                        </button>
                      )}
                      {b.status === "draft" && !email && (
                        <button className="btn small" disabled={!!busy} onClick={() => call({ action: "publish", doc: b.slug }, `pub-${b.slug}`)}>
                          {busy === `pub-${b.slug}` ? "…" : "Publish"}
                        </button>
                      )}
                      {isInvoice && b.status === "published" && !fullyPaid && (
                        <button className="btn small" disabled={!!busy} onClick={() => markPaid(b)}>
                          {busy === `pay-${b.slug}` ? "…" : "Mark paid"}
                        </button>
                      )}
                      {b.status === "published" && (
                        <EmailDocButton
                          slug={slug}
                          docKey={b.slug}
                          label={billingLabel(b).toLowerCase()}
                          {...(email !== undefined ? { email } : {})}
                        />
                      )}
                      <MoreActions>
                        {b.status === "draft" && email && (
                          <button className="btn ghost small" disabled={!!busy} onClick={() => call({ action: "publish", doc: b.slug }, `pub-${b.slug}`)}>
                            {busy === `pub-${b.slug}` ? "…" : "Publish without emailing"}
                          </button>
                        )}
                        {b.status === "draft" && (
                          <EmailDocButton
                            slug={slug}
                            docKey={b.slug}
                            label={billingLabel(b).toLowerCase()}
                            {...(email !== undefined ? { email } : {})}
                          />
                        )}
                        {b.status === "published" && (
                          <button className="btn ghost small" disabled={!!busy} onClick={() => call({ action: "unpublish", doc: b.slug }, `unpub-${b.slug}`)}>
                            {busy === `unpub-${b.slug}` ? "…" : "Unpublish"}
                          </button>
                        )}
                        {/* The handover pack has no drafted data to change — it
                            is rebuilt from the record by its own card. */}
                        {b.kind !== "handover" && (
                          <button className="btn ghost small" disabled={!!busy} onClick={() => setReviseFor(reviseFor === b.slug ? null : b.slug)}>
                            Make changes
                          </button>
                        )}
                        <button className="btn ghost small is-danger" disabled={!!busy} onClick={() => remove(b)}>
                          {busy === `del-${b.slug}` ? "…" : "Delete"}
                        </button>
                      </MoreActions>
                    </div>
                    <DocHistory {...(b.history ? { history: b.history } : {})} />
                    {reviseFor === b.slug && (
                      <div style={{ marginTop: 12 }}>
                        <textarea
                          className="q-box"
                          aria-label="Revision instructions"
                          rows={2}
                          placeholder="Revision instructions"
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                        />
                        <button
                          className="btn small"
                          style={{ marginTop: 8 }}
                          disabled={!!busy || !instructions.trim()}
                          onClick={() => call({ action: "regenerate", doc: b.slug, instructions }, `rev-${b.slug}`)}
                        >
                          {busy === `rev-${b.slug}` ? "Working… (up to a minute)" : "Regenerate"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(payments.length > 0 || hasPublishedInvoice) && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="k">Payments</div>
          {payments.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
              No payments recorded yet: use <b>Mark paid</b> on a published invoice when the money
              arrives.
            </p>
          ) : (
            <div style={{ marginTop: 4 }}>
              {payments.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap",
                    padding: "8px 0", borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span className="mono" style={{ fontWeight: 500, fontSize: 13 }}>{fmtLKR(p.amount)}</span>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    {p.at.slice(0, 10)} · {p.method}
                    {p.invoiceSlug ? ` · ${p.invoiceSlug}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                  <button
                    className="btn ghost small"
                    style={{ padding: "2px 12px", fontSize: 11, marginLeft: "auto" }}
                    disabled={!!busy}
                    onClick={() => removePayment(p, i)}
                  >
                    {busy === `unpay-${i}` ? "…" : "Remove"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* The balance is the sum of what each published invoice still owes
              from ITS OWN payments. Money that settles no published invoice is
              listed separately rather than netted off, because netting it off
              is what used to show "settled" while an invoice was unpaid
              (LC-003). Overpayment is shown for the same reason. */}
          <div style={{ marginTop: 12, fontSize: 13 }}>
            Outstanding: <b className="mono">{fmtLKR(money.outstanding)}</b>
            <span style={{ color: "var(--muted)" }}>
              {" "}
              across {money.invoices.length} published invoice{money.invoices.length === 1 ? "" : "s"}
            </span>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {fmtLKR(money.invoiced)} invoiced and published. {fmtLKR(money.paid)} received, of
              which {fmtLKR(money.attributed)} is assigned to a published invoice.
            </div>
            {money.unattributed > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {fmtLKR(money.unattributed)} received is not assigned to a published invoice, so it
                does not reduce the balance above. Remove the payment and record it again with{" "}
                <b>Mark paid</b> on the invoice it settles, or publish that invoice.
              </div>
            )}
            {money.overpaid > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {fmtLKR(money.overpaid)} received beyond what those invoices asked for. Check the
                amounts before issuing the next receipt.
              </div>
            )}
            {money.unparsable.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Not counted (total unreadable): {money.unparsable.join(", ")}. Their payments still
                show against them, but they add nothing to the balance.
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}
      {dialog}
    </div>
  );
}
