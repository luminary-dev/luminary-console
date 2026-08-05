// Shared data model. Client records + generated documents live in Vercel Blob
// (see lib/store.ts); these types are the contract between the console, the
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

export type DocStatus = "draft" | "published";

export type DocMeta = {
  type: DocType;
  no: string;
  status: DocStatus;
  updatedAt: string;
  /** Blob URLs — server-side pointers, never shown to clients directly. */
  htmlUrl: string;
  pdfUrl: string;
  /** The structured data Claude produced — kept so docs can be revised. */
  data: unknown;
};

export type ExtraQuestion = {
  /** Which questionnaire section to append to. */
  sectionId: "business" | "goals" | "customers" | "design" | "practical";
  label: string;
  hint?: string;
  kind: "text" | "textarea";
};

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
  answersUrl?: string;
  answersPdfUrl?: string;
  answersAt?: string;
  answersBy?: string;
};

export type IndexEntry = {
  slug: string;
  company: string;
  status: ClientRecord["status"];
  createdAt: string;
  docNoBase: string;
};

export type Answers = Record<string, string | string[]>;
