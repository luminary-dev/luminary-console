import { describe, expect, it } from "vitest";
import { parseAmount, fmtLKR } from "@/lib/money";

describe("test harness", () => {
  it("resolves the @ alias and runs pure lib code", () => {
    expect(parseAmount("LKR 45,000")).toBe(45000);
    expect(fmtLKR(45000)).toBe("LKR 45,000");
  });
  it("refuses ranges rather than guessing", () => {
    expect(parseAmount("5,000-10,000")).toBeNull();
  });
});
