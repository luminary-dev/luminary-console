// AUDIT.md API-05 (LC-004): the document data contracts are validated at the
// render boundary, so a malformed draft fails with a typed error instead of
// crashing inside a renderer.
import { describe, expect, it } from "vitest";
import { assertDocData } from "@/lib/templates/schema";
import { AppError } from "@/lib/errors";

describe("assertDocData", () => {
  it("accepts a well-formed quotation", () => {
    const data = {
      validUntil: "2026-10-01",
      scopeSummary: "A website.",
      items: [{ title: "Design", desc: "…", amount: "40,000" }],
      total: "40,000",
      paymentTerms: ["50% up front"],
      notes: "",
    };
    expect(() => assertDocData("quotation", data)).not.toThrow();
    expect(assertDocData("quotation", data)).toBe(data);
  });

  it("rejects a quotation whose items array is missing (the crash the model could cause)", () => {
    const bad = { total: "40,000", paymentTerms: [] };
    expect(() => assertDocData("quotation", bad)).toThrow(AppError);
    try {
      assertDocData("quotation", bad);
    } catch (e) {
      expect((e as AppError).kind).toBe("validation");
    }
  });

  it("rejects a proposal missing its phases array", () => {
    expect(() =>
      assertDocData("proposal", { objectives: [], deliverables: [] }),
    ).toThrow(AppError);
  });

  it("leaves extra fields alone (forward-compatible)", () => {
    const data = { items: [{ title: "x", desc: "y", amount: "1" }], total: "1", futureField: 42 };
    expect(() => assertDocData("invoice", data)).not.toThrow();
  });
});
