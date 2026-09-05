import type { LlmProvider, ReceiptExtraction } from "./types";

/** Deterministic local-only provider. Never used as a production fallback. */
export const mockProvider: LlmProvider = {
  name: "mock",
  model: "deterministic-local",
  async extractReceipt({ filename }): Promise<ReceiptExtraction> {
    const seed = [...filename].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const merchants = ["Acme Supplies", "Harbor Hotel", "City Cab", "Green Cafe", "Office Depot"];
    const categories = ["supplies", "hotel", "travel", "food", "supplies"];
    const idx = seed % merchants.length;
    const day = (seed % 27) + 1;
    const itemOne = Math.round(((seed % 70) + 12.5) * 100) / 100;
    const itemTwo = Math.round(((seed % 30) + 4.25) * 100) / 100;
    const subtotal = itemOne + itemTwo;
    const tax = Math.round(subtotal * 0.0825 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    return {
      date: `2026-08-${String(day).padStart(2, "0")}`,
      merchant: merchants[idx],
      subtotal,
      tax,
      tip: 0,
      total,
      currency: "USD",
      category: categories[idx],
      confidence: 0.84,
      lineItems: [
        {
          description: "Primary item",
          quantity: 1,
          unitPrice: itemOne,
          amount: itemOne,
          category: categories[idx],
          confidence: 0.86,
        },
        {
          description: "Secondary item",
          quantity: 1,
          unitPrice: itemTwo,
          amount: itemTwo,
          category: categories[idx],
          confidence: 0.82,
        },
      ],
    };
  },
};
