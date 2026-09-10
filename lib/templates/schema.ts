// Runtime validation for the AI-drafted / stored document data contracts
// (AUDIT.md API-05, the LC-004 residual). Every renderer in docs.ts does
// `data as QuotationData` and then maps `data.items`, prints `data.total`, etc.
// A malformed draft — a model that omitted `items`, or a stored doc from an
// older shape — therefore blew up deep inside a renderer with "cannot read map
// of undefined" instead of a typed error at the boundary. These schemas turn
// that into an AppError("validation") with a clear message.
//
// Deliberately lenient on string CONTENT (`.passthrough()`, optional strings):
// the point is not to second-guess the model's prose but to guarantee the
// SHAPE the renderers iterate — the arrays and the objects they walk — so a
// valid document (which is what the model produces to this contract) always
// passes and only a structurally-broken one is rejected.
import { z } from "zod";
import type { DocType } from "@/lib/types";
import { AppError } from "@/lib/errors";

const str = z.string().optional();
const item = z.object({}).passthrough();

const estimate = z
  .object({
    items: z.array(item),
    scaling: z.object({ rows: z.array(item) }).passthrough().nullable().optional(),
  })
  .passthrough();

const quotation = z
  .object({
    items: z.array(item),
    paymentTerms: z.array(z.string()),
    total: str,
  })
  .passthrough();

const invoice = z.object({ items: z.array(item), total: str }).passthrough();
const receipt = z.object({ items: z.array(item), totalReceived: str }).passthrough();
const contract = z
  .object({
    sow: z.object({}).passthrough(),
    clauses: z.array(item),
  })
  .passthrough();
const proposal = z
  .object({
    objectives: z.array(item),
    phases: z.array(item),
    deliverables: z.array(z.string()),
  })
  .passthrough();

const byType: Partial<Record<DocType, z.ZodTypeAny>> = {
  estimate,
  quotation,
  invoice,
  receipt,
  contract,
  proposal,
};

/** Validate a document's data against its contract, or throw a typed
 *  validation error. Returns the data unchanged on success so it can be used
 *  inline: `renderQuotation(assertDocData("quotation", data), ctx)`. */
export function assertDocData<T = unknown>(type: DocType, data: unknown): T {
  const schema = byType[type];
  if (!schema) return data as T;
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? ` (at ${first.path.join(".")})` : "";
    throw new AppError("validation", `The ${type} data is malformed${where}: ${first?.message ?? "invalid shape"}.`);
  }
  return data as T;
}
