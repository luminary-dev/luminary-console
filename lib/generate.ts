// The AI layer. Claude Opus 5 with structured outputs (output_config.format)
// fills the document data contracts in lib/templates/docs.ts. Server-side
// refusal fallbacks are enabled by default (harmless for business docs, and
// the recommended hardening for claude-opus-5 code).
import Anthropic from "@anthropic-ai/sdk";
import type { Answers, ClientRecord, DocType, ExtraQuestion } from "./types";
import type {
  ContractData,
  EstimateData,
  InvoiceData,
  ProposalData,
  QuotationData,
  ReceiptData,
} from "./templates/docs";

const MODEL = "claude-opus-5";

const SYSTEM = `You are the document-drafting engine for Luminary Studio, a full-service digital studio in Colombo, Sri Lanka (luminary-dev.xyz · support@luminary-dev.xyz · +94 77 16 18 093).

Services: web design & development (Next.js/React), brand & graphic design, video & motion graphics, cloud & DevOps engineering, SEO & performance. Process: discovery → design → build → launch → ongoing care. Small senior team, weekly delivery with live staging links, transparent itemised pricing, no hidden fees.

Currency & market: quote in Sri Lankan Rupees (LKR) unless the brief says otherwise. Calibration anchors for the local market: landing-page UX/design ≈ LKR 5,000–10,000; landing-page development ≈ LKR 30,000–40,000; multi-page sites 2–4 weeks; logos/flyers/short videos turn around in days. When the operator's brief states figures, treat those as authoritative and build ranges around them. Format money as "LKR 35,000" for totals and "35,000" or "5,000–10,000" for line amounts. Never invent certifications, client names, or capabilities Luminary doesn't have.

Commercial policy (apply consistently in every document): 50% advance to begin work, balance due on delivery/launch and payable before final handover (DNS cutover / file transfer). Included in every fixed price: two revision rounds at design stage and one at build stage. Any change beyond the agreed scope — including changes requested during development or after the advance is paid — is quoted first as a written change order and only implemented once approved; change orders may adjust the timeline. After launch: a 30-day warranty window covering defects at no charge (new features excluded); ongoing hosting/care available as a separate monthly plan. Intellectual property transfers to the client on receipt of full payment.

Tone: confident, warm, plain-spoken, precise — a senior studio writing to a client, never salesy or padded. Keep line-item descriptions to one line. British-adjacent Sri Lankan business English ("colour", "itemised").`;

function extractJson<T>(msg: Anthropic.Message): T {
  if (msg.stop_reason === "refusal") {
    throw new Error("Model declined the request (refusal).");
  }
  const text = msg.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text block in response.");
  return JSON.parse(text.text) as T;
}

async function generate<T>(prompt: string, schema: Record<string, unknown>): Promise<T> {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    // Server-side refusal fallback — routes a declined request to the
    // recommended substitute model instead of failing the pipeline.
    fallbacks: "default",
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  } as Parameters<typeof client.beta.messages.stream>[0]);
  const msg = await stream.finalMessage();
  return extractJson<T>(msg as unknown as Anthropic.Message);
}

// ——— JSON schemas (structured outputs: additionalProperties:false everywhere) ———

const S = {
  str: { type: "string" } as const,
  obj(required: string[], properties: Record<string, unknown>) {
    return { type: "object", additionalProperties: false, required, properties };
  },
  arr(items: unknown) {
    return { type: "array", items };
  },
  nullable(inner: unknown) {
    return { anyOf: [inner, { type: "null" }] };
  },
};

const ESTIMATE_SCHEMA = S.obj(
  ["confidence", "about", "items", "lowTotal", "highTotal", "likelyTotal", "totalNote", "scaling", "changeFactors", "nextStep"],
  {
    confidence: { type: "string", description: "e.g. '± 15%'" },
    about: { type: "string", description: "2-3 sentence framing of the estimate; mention currency (LKR) and that a fixed quotation follows." },
    items: S.arr(S.obj(["title", "desc", "effort", "range"], {
      title: S.str,
      desc: { type: "string", description: "One line" },
      effort: { type: "string", description: "e.g. '3–5 d' or '1–2 wk'" },
      range: { type: "string", description: "e.g. '5,000–10,000'" },
    })),
    lowTotal: { type: "string", description: "e.g. 'LKR 35,000'" },
    highTotal: S.str,
    likelyTotal: { type: "string", description: "Midpoint, e.g. '≈ LKR 42,500'" },
    totalNote: { type: "string", description: "e.g. 'Single landing page · Not a final bill'" },
    scaling: S.nullable(S.obj(["title", "rows", "note"], {
      title: { type: "string", description: "e.g. 'How cost scales with page count'" },
      rows: S.arr(S.obj(["scope", "detail", "range"], { scope: S.str, detail: S.str, range: S.str })),
      note: S.str,
    })),
    changeFactors: { type: "string", description: "One short paragraph: what could move the estimate." },
    nextStep: { type: "string", description: "One short paragraph pointing to the questionnaire + fixed quotation." },
  },
);

const QUOTATION_SCHEMA = S.obj(
  ["validUntil", "scopeSummary", "items", "total", "paymentTerms", "notes"],
  {
    validUntil: { type: "string", description: "A date ~30 days from issue, e.g. '05 Sep 2026'" },
    scopeSummary: { type: "string", description: "2-3 sentences of confirmed scope, grounded in the questionnaire answers." },
    items: S.arr(S.obj(["title", "desc", "amount"], { title: S.str, desc: S.str, amount: { type: "string", description: "e.g. '35,000'" } })),
    total: { type: "string", description: "e.g. 'LKR 45,000'" },
    paymentTerms: { type: "array", items: S.str, description: "4-6 short terms covering the FULL money lifecycle: 50% advance to begin; balance due on delivery/launch before handover; included revision rounds; changes beyond scope quoted as written change orders before implementation; 30-day post-launch defect warranty; ongoing care available as a monthly plan." },
    notes: { type: "string", description: "One short paragraph: exclusions/assumptions." },
  },
);

const INVOICE_SCHEMA = S.obj(["dueDate", "ref", "items", "total", "paymentNote"], {
  dueDate: { type: "string", description: "~14 days from issue" },
  ref: { type: "string", description: "The quotation number this bills against" },
  items: S.arr(S.obj(["title", "desc", "amount"], { title: S.str, desc: S.str, amount: S.str })),
  total: S.str,
  paymentNote: { type: "string", description: "Payment instructions placeholder: bank transfer details shared separately; reference the invoice number." },
});

const RECEIPT_SCHEMA = S.obj(["datePaid", "method", "ref", "items", "totalReceived", "balanceNote"], {
  datePaid: S.str,
  method: { type: "string", description: "e.g. 'Bank transfer'" },
  ref: { type: "string", description: "The invoice number this receipt settles" },
  items: S.arr(S.obj(["title", "desc", "amount"], { title: S.str, desc: S.str, amount: S.str })),
  totalReceived: S.str,
  balanceNote: { type: "string", description: "e.g. 'Balance remaining: LKR 22,500 on launch' or 'Fully settled'" },
});

const CONTRACT_SCHEMA = S.obj(["agreementDate", "sow", "clauses"], {
  agreementDate: S.str,
  sow: S.obj(["engagement", "term", "deliverables", "fees"], {
    engagement: S.str,
    term: { type: "string", description: "e.g. '≈ 3 weeks · Aug–Sep 2026'" },
    deliverables: { type: "string", description: "Compact list, ' · ' separated" },
    fees: { type: "string", description: "e.g. 'LKR 45,000 · 50% advance'" },
  }),
  clauses: {
    type: "array",
    description: "9-11 clauses, plain-language but real: Scope of Services; Fees & Payment (advance, balance due on delivery before handover, late-payment handling); Revisions & Change Requests (included rounds; any change beyond scope — including during development or after the advance — is quoted as a written change order and approved before work, and may move the timeline); Timeline & Client Responsibilities; Intellectual Property (transfers on full payment); Confidentiality; Support & Warranty (30-day post-launch defect window; ongoing care as separate plan); Warranties & Liability; Termination; Governing Law (Sri Lanka).",
    items: S.obj(["title", "body"], { title: S.str, body: { type: "string", description: "2-5 sentences; newlines allowed" } }),
  },
});

const PROPOSAL_SCHEMA = S.obj(
  ["headline", "validUntil", "overview", "objectives", "phases", "deliverables", "investment", "whyUs", "nextSteps"],
  {
    headline: { type: "string", description: "One line, e.g. 'A new landing page for X.'" },
    validUntil: S.str,
    overview: { type: "string", description: "2-3 sentences grounded in the client's answers." },
    objectives: S.arr(S.obj(["title", "desc"], { title: S.str, desc: S.str })),
    phases: S.arr(S.obj(["phase", "title", "timeframe", "desc"], {
      phase: { type: "string", description: "'Phase 01' etc." },
      title: S.str,
      timeframe: { type: "string", description: "e.g. 'Week 1'" },
      desc: S.str,
    })),
    deliverables: S.arr(S.str),
    investment: { type: "string", description: "e.g. 'LKR 45,000 fixed'" },
    whyUs: { type: "string", description: "One short paragraph, no invented claims." },
    nextSteps: { type: "string", description: "One short paragraph: sign contract, pay advance, kickoff." },
  },
);

const DOC_SCHEMAS: Record<DocType, Record<string, unknown>> = {
  estimate: ESTIMATE_SCHEMA,
  quotation: QUOTATION_SCHEMA,
  invoice: INVOICE_SCHEMA,
  receipt: RECEIPT_SCHEMA,
  contract: CONTRACT_SCHEMA,
  proposal: PROPOSAL_SCHEMA,
};

const STAGE1_SCHEMA = S.obj(["projectLabel", "estimate", "extraQuestions"], {
  projectLabel: { type: "string", description: "Short label, e.g. 'Landing page — UX & development'" },
  estimate: ESTIMATE_SCHEMA,
  extraQuestions: {
    type: "array",
    description: "0-4 genuinely client-specific discovery questions the standard questionnaire wouldn't catch (industry-specific). Empty array if none needed.",
    items: S.obj(["sectionId", "label", "hint", "kind"], {
      sectionId: { type: "string", enum: ["business", "goals", "customers", "design", "practical"] },
      label: S.str,
      hint: S.nullable(S.str),
      kind: { type: "string", enum: ["text", "textarea"] },
    }),
  },
});

const STAGE2_SCHEMA = S.obj(["quotation", "proposal", "contract"], {
  quotation: QUOTATION_SCHEMA,
  proposal: PROPOSAL_SCHEMA,
  contract: CONTRACT_SCHEMA,
});

// ——— public API ———

function clientContext(client: ClientRecord): string {
  return `CLIENT
Company: ${client.company}${client.reg ? ` (Reg. No: ${client.reg})` : ""}
Address: ${client.address || "—"}
Contact: ${client.contactName || "—"} · ${client.email || "—"} · ${client.phone || "—"}
Project: ${client.projectLabel || "(to be determined)"}
Operator brief: ${client.brief}`;
}

export type Stage1Result = {
  projectLabel: string;
  estimate: EstimateData;
  extraQuestions: (Omit<ExtraQuestion, "hint"> & { hint: string | null })[];
};

export async function stage1(client: ClientRecord, today: string): Promise<Stage1Result> {
  const prompt = `Today is ${today}.

${clientContext(client)}

Draft, for this new client:
1. estimate — a budgetary estimate from the operator brief. Follow any figures in the brief exactly: when the brief prices the workstreams, use ONLY those workstreams as line items (fold sub-tasks like forms, SEO and deployment into their descriptions) so the totals equal the brief's figures. Include a cost-scaling table when the deliverable naturally scales (pages, items, locations), otherwise null.
2. projectLabel — a short project label.
3. extraQuestions — up to 4 discovery questions specific to this client's industry/situation that our standard questionnaire (business, goals, customers, brand assets, design, content, practical, timeline) wouldn't already cover. Only genuinely useful ones; empty array is fine.`;
  return generate<Stage1Result>(prompt, STAGE1_SCHEMA);
}

export type Stage2Result = {
  quotation: QuotationData;
  proposal: ProposalData;
  contract: ContractData;
};

export async function stage2(
  client: ClientRecord,
  answers: Answers,
  estimate: EstimateData | null,
  today: string,
): Promise<Stage2Result> {
  const prompt = `Today is ${today}.

${clientContext(client)}

ESTIMATE PREVIOUSLY SENT (stay consistent with it — the quotation should land inside its range unless the answers clearly expand scope):
${JSON.stringify(estimate)}

CLIENT'S QUESTIONNAIRE ANSWERS (ground every document in these — quote their goals, sections, features, timeline):
${JSON.stringify(answers)}

Draft the three follow-up documents as DRAFTS for the studio to review:
1. quotation — fixed, itemised price derived from the estimate + confirmed scope.
2. proposal — objectives from their stated goals, phases with timeframes respecting their target launch date, deliverables from the sections/features they ticked.
3. contract — Services Agreement & SOW matching the quotation's scope, fees and timeline.
Document numbers are added by the system — do not invent any.`;
  return generate<Stage2Result>(prompt, STAGE2_SCHEMA);
}

export async function reviseDoc(
  client: ClientRecord,
  type: DocType,
  currentData: unknown,
  instructions: string,
  today: string,
): Promise<unknown> {
  const prompt = `Today is ${today}.

${clientContext(client)}

CURRENT ${type.toUpperCase()} DATA:
${JSON.stringify(currentData)}

OPERATOR REVISION INSTRUCTIONS:
${instructions}

Return the full revised ${type} data (same structure), applying the instructions and keeping everything else consistent.`;
  return generate(prompt, DOC_SCHEMAS[type]);
}

export async function generateBilling(
  client: ClientRecord,
  type: "invoice" | "receipt",
  quotation: QuotationData | null,
  instructions: string,
  today: string,
): Promise<unknown> {
  const prompt = `Today is ${today}.

${clientContext(client)}

QUOTATION (basis for billing):
${JSON.stringify(quotation)}

OPERATOR INSTRUCTIONS (what to bill / what was paid):
${instructions || (type === "invoice" ? "Invoice the standard 50% advance against the quotation total." : "Receipt for the advance payment received by bank transfer today.")}

Draft the ${type}.`;
  return generate(prompt, DOC_SCHEMAS[type]);
}
