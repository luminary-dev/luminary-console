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
import { parseAmount } from "./money";
import { PRICING_REFERENCE, fmtLKR, paymentSchedule } from "./pricing";

const MODEL = "claude-opus-5";

const SYSTEM = `You are the document-drafting engine for Luminary Studio, a full-service digital studio in Colombo, Sri Lanka (luminary-dev.xyz · support@luminary-dev.xyz · +94 77 16 18 093).

Services: web design & development (Next.js/React), brand & graphic design, video & motion graphics, cloud & DevOps engineering, SEO & performance. Process: discovery → design → build → launch → ongoing care. Small senior team, weekly delivery with live staging links, transparent itemised pricing, no hidden fees.

Currency & market: quote in Sri Lankan Rupees (LKR). Luminary prices web work on a fixed per-page build model, not open-ended ranges.

${PRICING_REFERENCE}

Format money as "LKR 65,000" for totals and "65,000" for line amounts. Never invent certifications, client names, or capabilities Luminary doesn't have.

Commercial policy (apply consistently in every document): the process runs Discovery, then Design (3 prototype concepts, the client picks 1, then up to 2 revision rounds on it), then Development (refinements to the approved design are included; new pages, features or direction changes are billable and quoted first as a written change order), then Launch (deploy and handover), then Aftercare. Payment is staged 30/70: 30% on design approval (development begins; this payment also covers the discovery and 3 prototype concepts already delivered in the design stage), 70% on delivery before final handover. There is no upfront signing payment. Once an SOW is signed the price is fixed unless the client requests additional pages or requirements; any such change requested after delivery is quoted first as a written change order and invoiced once that change is completed. Aftercare: the first 5 change requests are free, then LKR 6,000 per change request; a change request is one discrete self-contained change, larger work is several change requests and is quoted first. A 30-day post-launch warranty covers defects at no charge (new features excluded). Intellectual property transfers to the client on full payment. Use hyphens, commas, colons and periods in all copy; do not use em-dashes or en-dashes.

Tone: confident, warm, plain-spoken, precise — a senior studio writing to a client, never salesy or padded. Keep line-item descriptions to one line. British-adjacent Sri Lankan business English ("colour", "itemised").

Authorship: every word you produce is published verbatim on Luminary letterhead — documents the client signs, and questionnaire questions they answer. Write as "we", the studio. Never mention AI, models, automation, generation, drafting engines or assistants, and never refer to yourself: there is no filter between your output and the client.`;

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
      rows: S.arr(S.obj(["scope", "detail", "range"], {
        scope: S.str,
        detail: S.str,
        range: {
          type: "string",
          description:
            "Fixed per-page build price for that page tier, e.g. '65,000' (primary / landing / long-scroll), '22,000' (standard page) or '42,000' (functional page: form / listing / dynamic / integration). Not a range.",
        },
      })),
      note: {
        type: "string",
        description:
          "State that these are fixed per-page prices, that the primary page includes the 3 prototype concepts (later pages reuse that direction), and that pages added after signing use a phase multiplier on the base rate (Design x1.0, Development x1.4, pre-launch x1.8).",
      },
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
    items: S.arr(S.obj(["title", "desc", "amount", "pageType", "qty", "unitRate"], {
      title: S.str,
      desc: S.str,
      amount: { type: "string", description: "Formatted line amount, e.g. '65,000'. For a page line, this is unitRate x qty." },
      pageType: S.nullable({
        type: "string",
        enum: ["primary", "standard", "functional"],
        description:
          "If this line is a page build, its tier: 'primary' (landing / long-scroll, LKR 65,000, includes the 3 prototypes), 'standard' (LKR 22,000) or 'functional' (form / listing / dynamic / integration, LKR 42,000). null for non-page lines (day-rate work, etc.). The system re-prices page lines from these tiers, so use the exact fixed rate.",
      }),
      qty: S.nullable({ type: "number", description: "Number of pages of this tier on this line (default 1). null for non-page lines." }),
      unitRate: S.nullable({ type: "number", description: "The per-page base rate in LKR for this tier (65000 / 22000 / 42000). null for non-page lines." }),
    })),
    total: { type: "string", description: "Sum of all line amounts, e.g. 'LKR 195,000'. Must equal the fixed per-page prices added up." },
    paymentTerms: { type: "array", items: S.str, description: "4-7 short terms covering the FULL money lifecycle under the 30/70 model: 30% on design approval (development begins; also covers the discovery and 3 prototypes delivered in the design stage); 70% on delivery before final handover; no upfront signing payment; the 3 prototypes + pick 1 + up to 2 revision rounds and refinements during development are included; new pages/features/changes requested after delivery are quoted as written change orders and invoiced once each change is completed; aftercare first 5 change requests free then LKR 6,000 each; 30-day post-launch defect warranty; IP transfers on full payment; price fixed once signed. The system may overwrite these with exact 30/70 amounts." },
    notes: { type: "string", description: "One short paragraph: exclusions/assumptions." },
  },
);

const INVOICE_SCHEMA = S.obj(["dueDate", "ref", "items", "total", "paymentNote"], {
  dueDate: { type: "string", description: "Payment due date, e.g. '14 Aug 2026'. Use the exact default date given in the prompt unless the operator's instructions set a different one." },
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
    fees: { type: "string", description: "The fixed total and the 30/70 split, e.g. 'LKR 195,000 fixed · 30% on design approval / 70% on delivery'." },
  }),
  clauses: {
    type: "array",
    description: "9-11 clauses, plain-language but real: Scope of Services (fixed per-page build); Fees & Payment (fixed price; no upfront signing payment; 30% on design approval, which begins development and covers the discovery and 3 prototypes delivered in the design stage; 70% on delivery before final handover; late-payment handling); Design & Revisions (3 prototype concepts, client picks 1, up to 2 revision rounds; refinements to the approved design during development are included); Change Requests & Additional Scope (new pages, features or changes requested after delivery are billable, quoted first as a written change order, invoiced once the change is completed, and may move the timeline; price fixed once signed unless the client adds pages or requirements); Timeline & Client Responsibilities; Intellectual Property (transfers on full payment); Confidentiality; Support, Aftercare & Warranty (30-day post-launch defect window; first 5 change requests free then LKR 6,000 each; additional requirements per item or LKR 20,000 per working day; ongoing care as separate plan); Warranties & Liability; Termination; Governing Law (Sri Lanka). Use hyphens, commas, colons and periods only, never em-dashes or en-dashes.",
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
      title: {
        type: "string",
        description:
          "Aligned to Luminary's five phases in order: Discovery, Design (3 prototype concepts, pick 1, up to 2 revision rounds), Development (build the approved design; refinements included), Launch (deploy and handover), Aftercare (first 5 change requests free, then LKR 6,000 each).",
      },
      timeframe: { type: "string", description: "e.g. 'Week 1'" },
      desc: S.str,
    })),
    deliverables: S.arr(S.str),
    investment: { type: "string", description: "e.g. 'LKR 65,000 fixed'" },
    whyUs: { type: "string", description: "One short paragraph, no invented claims." },
    nextSteps: { type: "string", description: "One short paragraph: sign contract, approve the design, settle the 30% design-approval invoice, kickoff development." },
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

${PRICING_REFERENCE}

Draft, for this new client:
1. estimate — a budgetary estimate built from the fixed per-page prices above, applied to the pages/scope implied by the brief. Use the exact fixed rates (do not invent ranges): a primary page is LKR 65,000 and includes the 3 prototype concepts; standard pages LKR 22,000; functional pages LKR 42,000. Fold sub-tasks like forms, SEO and deployment into line descriptions. Include a cost-scaling table showing the per-page tiers whenever the deliverable scales by page count, otherwise null. If the operator's brief states different figures, treat those as authoritative.
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

${PRICING_REFERENCE}

ESTIMATE PREVIOUSLY SENT (stay consistent with it unless the answers clearly expand scope):
${JSON.stringify(estimate)}

CLIENT'S QUESTIONNAIRE ANSWERS (ground every document in these — quote their goals, sections, features, timeline):
${JSON.stringify(answers)}

Draft the three follow-up documents as DRAFTS for the studio to review:
1. quotation — fixed, itemised price built from the fixed per-page prices above. One line item per page (or per group of same-tier pages), each with pageType, qty and unitRate set from the tier and amount = unitRate x qty. The total must be the sum of those fixed prices. Payment terms follow the 30/70 split.
2. proposal — objectives from their stated goals; phases aligned to Discovery, Design (3 prototypes, pick 1, up to 2 revision rounds), Development, Launch, Aftercare, with timeframes respecting their target launch date; deliverables from the sections/features they ticked.
3. contract — Services Agreement & SOW matching the quotation's scope and fixed price, with the 30/70 fees.
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
  kind: "invoice" | "receipt",
  stage: "advance" | "progress" | "final" | "other",
  context: {
    quotation: QuotationData | null;
    priorBilling: { kind: string; stage: string; no: string; data: unknown }[];
    changeOrders: { at: string; desc: string; amount: string }[];
  },
  instructions: string,
  today: string,
): Promise<unknown> {
  // The 30/70 arc: progress = 30% design-approval milestone (development
  // begins), final = 70% delivery milestone. There is no signing/advance
  // milestone anymore, and change orders are NOT bundled onto the final
  // invoice — post-delivery work is billed as separate additional invoices
  // once each change is completed. Amounts come from lib/pricing.paymentSchedule
  // so the invoices reconcile to the quotation total exactly.
  const quoteTotal = parseAmount(context.quotation?.total ?? null);
  const sched = quoteTotal !== null ? paymentSchedule(quoteTotal) : null;
  // schedule is [designApproval (30%), delivery (70%)]: progress -> 0, final -> 1.
  const idx = stage === "progress" ? 0 : stage === "final" ? 1 : -1;
  const milestone = sched && idx >= 0 ? sched[idx] : null;
  const exact = milestone ? ` exactly ${fmtLKR(milestone.amount)} (${Math.round(milestone.pct * 100)}% of the fixed quotation total of ${fmtLKR(quoteTotal as number)})` : "";
  const defaults: Record<string, string> = {
    "invoice-progress": `Invoice the 30% design-approval milestone:${exact || " 30% of the fixed quotation total"}. It falls due once the client approves the design and development begins, and it covers the discovery and 3 prototype concepts delivered in the design stage.`,
    "invoice-final": `Final invoice on delivery: the 70% delivery milestone${milestone ? ` (${fmtLKR(milestone.amount)})` : " (70% of the fixed quotation total)"}. This is the remaining balance of the fixed quotation total. Do NOT add change orders to this invoice — post-delivery changes are billed separately as additional invoices once each change is completed.`,
    "receipt-progress": "Receipt for the 30% design-approval payment received by bank transfer today, referencing the design-approval (progress) invoice. The balance note should state the remaining 70% falls due on delivery.",
    "receipt-final":
      "Receipt for the final delivery payment received by bank transfer today, referencing the final invoice. The balance note should confirm the account is fully settled and that IP has transferred.",
  };
  // Due dates follow the schedule's per-milestone offsets (design-approval +7,
  // delivery +14); additional invoices default to +14. Operator instructions
  // override.
  const dueDays = milestone ? milestone.dueOffsetDays : stage === "progress" ? 7 : 14;
  const dueDefault = new Date(Date.now() + dueDays * 86_400_000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Colombo",
  });
  const stageWord = stage === "progress" ? "design-approval" : stage === "final" ? "delivery" : "additional";
  const duePolicy =
    kind === "invoice"
      ? `\n\nDUE DATE: unless the operator instructions specify a different due date, set dueDate to exactly "${dueDefault}" (${dueDays} days from today, the standard term for the ${stageWord} invoice).`
      : "";
  const prompt = `Today is ${today}.

${clientContext(client)}

QUOTATION (basis for billing):
${JSON.stringify(context.quotation)}

BILLING HISTORY SO FAR (stay arithmetically consistent with these):
${JSON.stringify(context.priorBilling)}

APPROVED CHANGE ORDERS (work added after the cost was finalised — each is billed as its own ADDITIONAL invoice once that change is completed, NOT on the final/delivery invoice; a change order already itemised on an invoice in the billing history has been billed, NEVER bill the same change order twice):
${JSON.stringify(context.changeOrders)}

OPERATOR INSTRUCTIONS:
${instructions || defaults[`${kind}-${stage}`] || `Draft the ${stage} ${kind}.`}${duePolicy}

Draft the ${stage} ${kind}. All arithmetic must be exact and consistent with the history above.`;
  return generate(prompt, DOC_SCHEMAS[kind]);
}
