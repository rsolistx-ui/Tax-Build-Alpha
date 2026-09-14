import { describe, expect, it } from "vitest";
import { batchEvaluateTaxFormulas, createTaxFunctionEngine, evaluateTaxFormula } from "../tax-functions";

describe("tax function engine", () => {
  it("evaluates a custom tax function", () => {
    const hf = createTaxFunctionEngine();
    expect(evaluateTaxFormula(hf, 0, "A1", "=TAX_1040_LINE9(80000, 5000, 2000)")).toBe(87000);
  });

  it("lets custom functions read other cells and built-ins", () => {
    const hf = createTaxFunctionEngine();
    evaluateTaxFormula(hf, 0, "A1", "100000");
    evaluateTaxFormula(hf, 0, "B1", "=TAX_SE_TAX(A1)");
    expect(evaluateTaxFormula(hf, 0, "C1", "=SUM(B1, 1000)")).toBeCloseTo(15129.55, 2);
  });

  it("honors optional arguments", () => {
    const hf = createTaxFunctionEngine();
    expect(evaluateTaxFormula(hf, 0, "A1", "=TAX_1040_LINE9(30000)")).toBe(30000);
  });

  it("takes a string filing status", () => {
    const hf = createTaxFunctionEngine();
    expect(evaluateTaxFormula(hf, 0, "A1", '=TAX_1040_STANDARD_DEDUCTION("single", 70)')).toBe(16150);
  });

  it("recalculates dependent cells after their inputs change", () => {
    const hf = createTaxFunctionEngine();
    evaluateTaxFormula(hf, 0, "A1", "100");
    evaluateTaxFormula(hf, 0, "A2", "=TAX_1040_LINE9(A1, 25)");
    expect(hf.getCellValue({ row: 1, col: 0, sheet: 0 })).toBe(125);
    evaluateTaxFormula(hf, 0, "A1", "200");
    expect(hf.getCellValue({ row: 1, col: 0, sheet: 0 })).toBe(225);
  });

  it("batch evaluates multiple formulas", () => {
    const hf = createTaxFunctionEngine();
    const results = batchEvaluateTaxFormulas(hf, 0, {
      A1: "=TAX_1040_LINE9(10, 20)",
      A2: "=TAX_ROUND(10.555)",
    });
    expect(results.A1).toBe(30);
    expect(results.A2).toBe(10.56);
  });
});