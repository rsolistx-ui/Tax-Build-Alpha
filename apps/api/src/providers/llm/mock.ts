import type { LlmProvider, ReceiptExtraction } from "./types";

/** Deterministic mock for local/dev without GEMINI_API_KEY */
export const mockProvider: LlmProvider = {
  name: "mock",
  async extractReceipt({ filename }): Promise<ReceiptExtraction> {
    const seed = [...filename].reduce((a, c) => a + c.charCodeAt(0), 0);
    const merchants = ["Acme Supplies", "Harbor Hotel", "City Cab", "Green Cafe", "Office Depot"];
    const categories = ["supplies", "hotel", "travel", "food", "supplies"];
    const idx = seed % merchants.length;
    const day = (seed % 27) + 1;
    return {
      date: `2026-08-${String(day).padStart(2, "0")}`,
      merchant: merchants[idx],
      amount: Math.round(((seed % 200) + 12.5) * 100) / 100,
      currency: "USD",
      category: categories[idx],
      confidence: 0.72 + (seed % 20) / 100,
    };
  },
};
