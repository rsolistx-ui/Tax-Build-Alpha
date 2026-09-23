import { describe, expect, it } from "vitest";
import { validateReceipt } from "./receipt-validation";
import type { ReceiptExtraction } from "../providers/llm";

const base: ReceiptExtraction = {
  date: "2026-09-05", merchant: "Test Supply", subtotal: 60, tax: 4.95, tip: null, total: 64.95, currency: "USD", category: null, confidence: 0.9,
  lineItems: [{ description: "Paper", quantity: 2, unitPrice: 12.5, amount: 25, category: null, confidence: 0.9 }, { description: "Ink", quantity: 1, unitPrice: 35, amount: 35, category: null, confidence: 0.9 }],
};

describe("validateReceipt date check", () => {
  it("passes a dated receipt", () => {
    const result = validateReceipt(base);
    expect(result.checks.find((c) => c.code === "date_present")?.status).toBe("pass");
    expect(result.status).toBe("pass");
  });

  it("warns when no date was read, so the receipt cannot file silently", () => {
    const result = validateReceipt({ ...base, date: null });
    expect(result.checks.find((c) => c.code === "date_present")?.status).toBe("warning");
    expect(result.status).toBe("warning");
  });
});
