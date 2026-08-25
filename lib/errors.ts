// Boundary safety: one error taxonomy for every API route, one mapper to an
// RFC 9457 problem-details body, and the text clipping used on anything a
// client typed.
//
// Why both live here: they are the two things that must happen at the edge of
// a request before data leaves the process. Routes used to answer failures
// with `{ error: String(e) }`, which put R2 keys, provider messages and stack
// shapes in the browser and gave support nothing to correlate against
// (LC-005). The mapper answers with a safe sentence plus a requestId, and logs
// the real cause under that same id.
//
// Backwards compatibility matters here: every client component in this app
// reads `data.error` off a non-ok JSON body to show a message. The problem
// body therefore carries `error` alongside the RFC fields, holding the same
// safe text as `detail`. Dropping it would break every form.

import { logger } from "./logger";

/** The failure kinds this app distinguishes. Each maps to one status, one
 *  title and one safe default sentence. */
export type ErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "rate_limited"
  | "upstream"
  | "internal";

type KindSpec = { status: number; title: string; detail: string };

const KINDS: Record<ErrorKind, KindSpec> = {
  validation: {
    status: 400,
    title: "Invalid request",
    detail: "Some of what was sent could not be accepted. Check the values and try again.",
  },
  not_found: {
    status: 404,
    title: "Not found",
    detail: "That record no longer exists, or it was never here.",
  },
  conflict: {
    status: 409,
    title: "Conflict",
    detail: "The current state of the record does not allow this action.",
  },
  unauthorized: {
    status: 401,
    title: "Not signed in",
    detail: "Sign in again and retry.",
  },
  rate_limited: {
    status: 429,
    title: "Too many requests",
    detail: "Too many attempts in a short time. Wait a moment and try again.",
  },
  upstream: {
    status: 502,
    title: "A service we depend on failed",
    detail: "An external service did not answer. Nothing was changed. Try again shortly.",
  },
  internal: {
    status: 500,
    title: "Something went wrong",
    detail: "The action did not complete. The failure has been logged, quote the reference below if you report it.",
  },
};

/** A failure with a message we are willing to show a human. Anything thrown
 *  that is NOT an AppError is treated as internal and never surfaced. */
export class AppError extends Error {
  readonly kind: ErrorKind;
  /** Safe, human-readable sentence. Defaults to the kind's own sentence. */
  readonly safeDetail: string;

  constructor(kind: ErrorKind, safeDetail?: string, options?: { cause?: unknown }) {
    super(safeDetail ?? KINDS[kind].detail, options);
    this.name = "AppError";
    this.kind = kind;
    this.safeDetail = safeDetail ?? KINDS[kind].detail;
  }
}

/** RFC 9457 problem details, plus the two fields this app needs:
 *  `requestId` for correlation and `error` for the existing UI contract. */
export type ProblemDetails = {
  /** URI reference identifying the problem kind. */
  type: string;
  title: string;
  status: number;
  /** Safe explanation. Never contains the internal error text. */
  detail: string;
  requestId: string;
  /** Same text as `detail`. Kept because every form in the console reads it. */
  error: string;
};

/** Correlation id: short enough to read out loud, random enough to grep for. */
export function newRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, "").slice(0, 12);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Build a problem body for a known failure, without an exception in hand. */
export function problem(kind: ErrorKind, safeDetail?: string, requestId = newRequestId()): ProblemDetails {
  const spec = KINDS[kind];
  const detail = safeDetail ?? spec.detail;
  return {
    type: `/problems/${kind}`,
    title: spec.title,
    status: spec.status,
    detail,
    requestId,
    error: detail,
  };
}

/** The single mapper every route catch block goes through.
 *
 *  It logs the real error against the requestId (so the internal cause is
 *  recoverable from logs) and returns only safe text. `op` names the action
 *  for the log line, e.g. "billing publish". */
export function toProblem(e: unknown, op: string): ProblemDetails {
  const requestId = newRequestId();
  const app = e instanceof AppError ? e : null;
  const body = problem(app?.kind ?? "internal", app?.safeDetail, requestId);
  // The one place the internal detail is allowed to exist: the server log.
  // It goes through the logger rather than console.error so it is structured,
  // correlated by requestId, and REDACTED (LC-017). This mapper is the single
  // funnel every route catch block passes through, and the errors arriving
  // here routinely carry presigned URLs, provider keys and store paths.
  logger.error(`${op} failed`, { requestId, err: e });
  return body;
}

/** Route helper: the mapper plus the status, ready for NextResponse.json.
 *  Kept framework-free on purpose so it is unit-testable without Next. */
export function problemResponse(e: unknown, op: string): { body: ProblemDetails; status: number } {
  const body = toProblem(e, op);
  return { body, status: body.status };
}

// --- text clipping -------------------------------------------------------

/** Segmenter is constructed once: building one per call is the expensive part.
 *  Undefined where the runtime lacks Intl.Segmenter, which the caller handles
 *  by falling back to code points. */
const graphemes: Intl.Segmenter | undefined = (() => {
  try {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch {
    return undefined;
  }
})();

/** Hard-cap user text at `max` user-perceived characters.
 *
 *  Plain `.slice(max)` counts UTF-16 code units, so it can cut a surrogate
 *  pair in half, strand a combining mark, or split a Sinhala conjunct into
 *  something that renders as a different word (GAP-3.2a). This counts
 *  graphemes instead, so a cut never lands inside a character. No ellipsis is
 *  added: call sites store or quote the result verbatim. */
export function clipText(value: unknown, max: number): string {
  const s = typeof value === "string" ? value : String(value ?? "");
  if (max <= 0) return "";
  // A grapheme is at least one code unit, so a string already inside the cap
  // needs no segmentation at all.
  if (s.length <= max) return s;
  if (!graphemes) {
    // Code points at least keep surrogate pairs intact.
    return Array.from(s).slice(0, max).join("");
  }
  let out = "";
  let n = 0;
  for (const { segment } of graphemes.segment(s)) {
    if (n >= max) break;
    out += segment;
    n++;
  }
  return out;
}
