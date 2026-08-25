// LC-005: route failures must reach the browser as a safe sentence plus a
// correlation id, never as the internal error string. GAP-3.2a: user text is
// clipped by grapheme, not by UTF-16 code unit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, clipText, newRequestId, problem, problemResponse, toProblem } from "@/lib/errors";
import { atIndex } from "./helpers";

// A realistically-shaped store error. The access key id is the real 20
// character AKIA format on purpose: the redactor deliberately does not match
// a short "AKIAEXAMPLE" style placeholder, because a pattern loose enough to
// catch that would also redact ordinary prose. Testing with a fake shape
// would have proved nothing about production logs.
const SECRET =
  "AccessDenied: console/clients/acme/record.json (key AKIAIOSFODNN7EXAMPLE, endpoint https://acct.r2.cloudflarestorage.com)";

describe("LC-005: the mapper never returns the internal error string", () => {
  let logged: unknown[][];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("answers an unknown throw with a safe sentence and a requestId", () => {
    const body = toProblem(new Error(SECRET), "billing action publish on acme");

    expect(JSON.stringify(body)).not.toContain("AccessDenied");
    expect(JSON.stringify(body)).not.toContain("AKIAEXAMPLE");
    expect(JSON.stringify(body)).not.toContain("record.json");
    expect(body.status).toBe(500);
    expect(body.requestId).toMatch(/^[a-z0-9]+$/i);
    expect(body.detail.length).toBeGreaterThan(0);
  });

  it("keeps the `error` field every form in the console reads", () => {
    const body = toProblem(new Error(SECRET), "doc action publish on acme");

    // Non-ok bodies are consumed as `data.error` by every client component.
    expect(body.error).toBe(body.detail);
    expect(typeof body.error).toBe("string");
  });

  it("carries the RFC 9457 fields", () => {
    const body = problem("not_found", "That client no longer exists.");

    expect(body).toMatchObject({
      type: "/problems/not_found",
      title: "Not found",
      status: 404,
      detail: "That client no longer exists.",
      error: "That client no longer exists.",
    });
    expect(body.requestId).toBeTruthy();
  });

  it("LC-005/LC-017: logs the failure under the same requestId, redacted", () => {
    const raw = new Error(SECRET);
    const body = toProblem(raw, "handover generation for acme");

    // One structured line, carrying the correlation id the caller was given,
    // so "quote the reference" actually finds the cause in the logs.
    expect(logged).toHaveLength(1);
    const line = atIndex(logged, 0).map((part) => String(part)).join(" ");
    expect(line).toContain(body.requestId);
    expect(line).toContain("handover generation for acme");

    // The cause is recoverable in outline: the operation and the failure are
    // there, so the log is still useful for diagnosis.
    expect(line).toContain("AccessDenied");

    // But the secrets inside it are not. This mapper is the funnel every
    // route catch block passes through, and the errors arriving here
    // routinely carry access keys and presigned URLs (LC-017).
    expect(line).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("shows an AppError's own message, since it was authored to be shown", () => {
    const body = toProblem(new AppError("validation", "Enter the live https URL."), "site action set");

    expect(body.status).toBe(400);
    expect(body.error).toBe("Enter the live https URL.");
  });

  it("does not leak the cause of an AppError that wraps one", () => {
    const body = toProblem(
      new AppError("upstream", "The document could not be rendered.", { cause: new Error(SECRET) }),
      "billing action generate",
    );

    expect(JSON.stringify(body)).not.toContain("AKIAEXAMPLE");
    expect(body.status).toBe(502);
  });

  it("hands routes a matching body and status", () => {
    const { body, status } = problemResponse(new Error(SECRET), "client creation for acme");

    expect(status).toBe(body.status);
    expect(status).toBe(500);
  });

  it("gives every failure its own requestId", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

describe("GAP-3.2a: clipText cuts between characters, never inside one", () => {
  it("leaves text already inside the cap untouched", () => {
    expect(clipText("Nimal Perera", 120)).toBe("Nimal Perera");
  });

  it("does not split a surrogate pair", () => {
    // Four astral characters: .slice(0, 3) would return half of the second.
    const s = "\u{1F600}\u{1F601}\u{1F602}\u{1F603}";
    const out = clipText(s, 3);

    expect(out).toBe("\u{1F600}\u{1F601}\u{1F602}");
    expect(out).not.toContain("�");
    expect([...out]).toHaveLength(3);
  });

  it("keeps a Sinhala cluster whole", () => {
    // "\u0DBD\u0D82\u0D9A\u0DCF" is two clusters: consonant plus anusvara, then
    // consonant plus the vowel sign. A code-unit slice at 1 or 3 lands inside
    // one of them and renders as a different word.
    expect(clipText("\u0DBD\u0D82\u0D9A\u0DCF", 1)).toBe("\u0DBD\u0D82");
    expect(clipText("\u0DBD\u0D82\u0D9A\u0DCF", 2)).toBe("\u0DBD\u0D82\u0D9A\u0DCF");
  });

  it("keeps a combining mark with the letter it sits on", () => {
    const s = "e\u0301e\u0301e\u0301"; // e plus combining acute, three times
    const out = clipText(s, 2);

    expect(out).toBe("e\u0301e\u0301");
    // A code-unit slice at 2 would have stranded a combining acute alone.
    expect(out).toHaveLength(4);
  });

  it("adds nothing: the result is a prefix of the input", () => {
    const s = "a".repeat(50);
    const out = clipText(s, 10);

    expect(out).toBe("a".repeat(10));
    expect(s.startsWith(out)).toBe(true);
  });

  it("answers a non-string or a zero cap without throwing", () => {
    expect(clipText(undefined, 10)).toBe("");
    expect(clipText("anything", 0)).toBe("");
  });
});
