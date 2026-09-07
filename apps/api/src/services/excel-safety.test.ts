import { describe, expect, it } from "vitest";
import { isFormulaInjectionRisk, sanitizeSpreadsheetCell, sanitizeSpreadsheetRow } from "./excel-safety";

describe("formula injection protection", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-1+1", "@SUM(1,2)", "\t=cmd", "\rmalicious"])(
    "flags %s as a formula-injection risk",
    (value) => {
      expect(isFormulaInjectionRisk(value)).toBe(true);
    },
  );

  it.each(["Office Supplies", "123.45", "Bob's Diner", ""])("does not flag ordinary text %s", (value) => {
    expect(isFormulaInjectionRisk(value)).toBe(false);
  });

  it.each(["=SUM(A1:A9)", "+1+1", "-1+1", "@SUM(1,2)"])(
    "prefixes %s with an apostrophe so it is written as inert text",
    (value) => {
      const sanitized = sanitizeSpreadsheetCell(value);
      expect(sanitized.startsWith("'")).toBe(true);
      expect(sanitized).toBe(`'${value}`);
    },
  );

  it("leaves ordinary text unchanged", () => {
    expect(sanitizeSpreadsheetCell("Office Supplies")).toBe("Office Supplies");
  });

  it("sanitizes every string field in a row without touching non-string fields", () => {
    const row = { merchant: "=cmd|'/c calc'!A1", total: 42, filename: "+evil.xlsx", note: null };
    const sanitized = sanitizeSpreadsheetRow(row);
    expect(sanitized.merchant.startsWith("'")).toBe(true);
    expect(sanitized.filename.startsWith("'")).toBe(true);
    expect(sanitized.total).toBe(42);
    expect(sanitized.note).toBeNull();
  });
});
