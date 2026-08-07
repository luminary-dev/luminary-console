// Shared data model. Client records + generated documents live in Cloudflare
// R2 (see lib/store.ts); these types are the contract between the console, the
// AI generation layer, the template renderers, and the client-facing sites.

export type DocType =
  | "estimate"
  | "quotation"
  | "invoice"
  | "receipt"
  | "contract"
  | "proposal";

export const DOC_LABELS: Record<DocType, string> = {
  estimate: "Estimate",
  quotation: "Quotation",
  invoice: "Invoice",
  receipt: "Receipt",
  contract: "Contract & SOW",
  proposal: "Project Proposal",
};

export const DOC_NO_PREFIX: Record<DocType, string> = {
  estimate: "LUM-EST-",
  quotation: "LUM-Q-",
  invoice: "LUM-INV-",
  receipt: "LUM-RCP-",
  contract: "LUM-MSA-",
  proposal: "LUM-P-",
};

/** What a `BillingDoc` can be. Invoices and receipts are AI-drafted from the
 *  quotation; "handover" is the end-of-project pack, rendered deterministically
 *  from the record (see lib/handover.ts). It rides in `billing[]` rather than
 *  `docs` because everything a handover pack needs — a portal URL of its own,
 *  publish/unpublish, per-doc email, delete — is already implemented for the
 *  billing array and keyed off `slug`, whereas `docs` is a fixed one-slot-per-
 *  type map whose slots are wired into the AI drafting pipeline. */
export type BillingKind = "invoice" | "receipt" | "handover";

export const BILLING_LABELS: Record<BillingKind, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  handover: "Handover pack",
};

export const BILLING_NO_PREFIX: Record<BillingKind, string> = {
  invoice: "LUM-INV-",
  receipt: "LUM-RCP-",
  handover: "LUM-HOP-",
};

export type DocStatus = "draft" | "published";

/** One archived render of a document, pushed onto `history` just before a
 *  revise/regenerate overwrites it. Assets are written to fresh
 *  random-suffixed keys on every save, so the old URLs stay valid forever —
 *  archiving is only a matter of remembering them. */
export type DocVersion = {
  no: string;
  htmlUrl: string;
  pdfUrl: string;
  /** When that version was rendered (the meta.updatedAt it carried). */
  at: string;
};

export type DocMeta = {
  type: DocType;
  no: string;
  status: DocStatus;
  updatedAt: string;
  /** Asset URLs ("/api/asset/<key>") — pointers into the private store,
   *  resolved server-side with fetchAsset; never shown to clients directly. */
  htmlUrl: string;
  pdfUrl: string;
  /** The structured data Claude produced — kept so docs can be revised. */
  data: unknown;
  /** Superseded renders, oldest first (capped — see HISTORY_CAP). */
  history?: DocVersion[];
};

export type ExtraQuestion = {
  /** Which questionnaire section to append to. */
  sectionId: "business" | "goals" | "customers" | "design" | "practical";
  label: string;
  hint?: string;
  kind: "text" | "textarea";
};

/** Lifecycle stage. Optional — older records derive a default from status/docs
 *  (drafts_ready + published quotation → "quoted", else "lead"). */
export type ClientStage =
  | "lead"
  | "quoted"
  | "accepted"
  | "development"
  | "delivered"
  | "warranty"
  | "closed";

/** A payment recorded against the project (usually against an invoice). */
export type Payment = {
  at: string;
  /** LKR amount as a number — arithmetic (outstanding balance) needs it. */
  amount: number;
  /** e.g. "bank transfer", "cash", "card". */
  method: string;
  note?: string;
  /** Billing slug the payment settles, e.g. "invoice-1". */
  invoiceSlug?: string;
};

/** Client's typed acceptance of the published quotation (portal action). */
export type Acceptance = { name: string; at: string; ip?: string };

export type Task = { text: string; done: boolean; at: string };

/** One client-facing email sent from the console (send route). */
export type EmailLogEntry = { at: string; to: string; subject: string; docs?: string[] };

/** A question the client typed against one document in their portal.
 *  `doc` is a portal document key — a DocType, a billing slug
 *  ("invoice-1"), or "questionnaire". */
export type Comment = { doc: string; by: string; text: string; at: string };

export type ClientRecord = {
  slug: string;
  company: string;
  reg?: string;
  address?: string;
  email?: string;
  phone?: string;
  contactName?: string;
  brief: string;
  projectLabel: string;
  /** Zero-padded shared doc counter, e.g. "0044". */
  docNoBase: string;
  status: "created" | "answers_in" | "drafts_ready";
  createdAt: string;
  domain: string;
  dnsStatus: "automated" | "manual_required" | "error";
  extraQuestions: ExtraQuestion[];
  docs: Partial<Record<DocType, DocMeta>>;
  /** Latest submission (kept for compatibility / quick access). */
  answersUrl?: string;
  answersPdfUrl?: string;
  answersAt?: string;
  answersBy?: string;
  /** Full history — the questionnaire may be submitted more than once. */
  submissions?: Submission[];
  /** Invoices & receipts across the payment arc (advance → final). */
  billing?: BillingDoc[];
  /** Highest sequence ever issued per billing kind. Without it, deleting the
   *  newest invoice frees its number for the next one — and a deleted
   *  document may already have been published, so its number is spent.
   *  See lib/pipeline.saveBillingDoc. */
  billingSeq?: Partial<Record<BillingKind, number>>;
  /** Changes requested after the cost was finalised — billed on the final invoice. */
  changeOrders?: ChangeOrder[];
  /** Lifecycle stage (see ClientStage) — absent on records that predate it. */
  stage?: ClientStage;
  /** When delivery happened (final receipt published, or manual override) —
   *  starts the 30-day warranty clock (delivered → warranty → closed). */
  deliveredAt?: string;
  /** Payments received (advance/final/other) — drives outstanding-balance math. */
  payments?: Payment[];
  /** Set once when the client accepts the quotation from the portal. */
  acceptance?: Acceptance;
  /** Free-form operator notes (console only, never client-facing). */
  notes?: string;
  /** Operator task checklist (console only). */
  tasks?: Task[];
  /** Every client-facing email sent via the send route, newest last. */
  emailLog?: EmailLogEntry[];
  /** Questions left on documents from the client portal, newest last. */
  comments?: Comment[];
};

export type BillingDoc = {
  kind: BillingKind;
  /** Where in the payment arc this sits. Handover packs are always "other" —
   *  they bill nothing, so the money math (lib/money.ts) skips them. */
  stage: "advance" | "final" | "other";
  /** URL segment on the client site, e.g. "invoice-1". */
  slug: string;
  no: string;
  status: DocStatus;
  updatedAt: string;
  htmlUrl: string;
  pdfUrl: string;
  data: unknown;
  /** Superseded renders, oldest first (capped — see HISTORY_CAP). */
  history?: DocVersion[];
};

export type ChangeOrder = {
  at: string;
  desc: string;
  /** Formatted LKR amount, e.g. "4,500". */
  amount: string;
};

export type Submission = {
  at: string;
  by: string;
  answersUrl: string;
  pdfUrl: string;
  attachments?: Attachment[];
};

export type Attachment = { name: string; url: string; size: number };

export type IndexEntry = {
  slug: string;
  company: string;
  status: ClientRecord["status"];
  createdAt: string;
  docNoBase: string;
};

export type Answers = Record<string, string | string[]>;
