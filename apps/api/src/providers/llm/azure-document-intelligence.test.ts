import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { createAzureDocumentIntelligenceProvider, mapAzureReceipt } from "./azure-document-intelligence";
import { activeDocumentReaders, getLlmProvider } from "./index";
import { consentRequired } from "../../services/taxpayer-consent";

const analyzed = {
  status: "succeeded",
  analyzeResult: { documents: [{ confidence: 0.97, fields: {
    MerchantName: { valueString: "Office Depot" },
    TransactionDate: { valueDate: "2026-03-04" },
    Subtotal: { valueCurrency: { amount: 40, currencyCode: "USD" } },
    TotalTax: { valueCurrency: { amount: 3.3, currencyCode: "USD" } },
    Total: { valueCurrency: { amount: 43.3, currencyCode: "USD" } },
    Items: { valueArray: [{ confidence: 0.9, valueObject: { Description: { valueString: "Paper" }, Quantity: { valueNumber: 2 }, Price: { valueCurrency: { amount: 20 } }, TotalPrice: { valueCurrency: { amount: 40 } } } }] },
  } }] },
};

describe("Azure Document Intelligence (US-only reading)", () => {
  it("maps receipt fields and leaves the category to the firm's rules", () => {
    expect(mapAzureReceipt(analyzed)).toMatchObject({ merchant: "Office Depot", date: "2026-03-04", subtotal: 40, tax: 3.3, total: 43.3, currency: "USD", category: null,
      lineItems: [{ description: "Paper", quantity: 2, unitPrice: 20, amount: 40 }] });
  });

  it("deletes the submitted document and result right after reading", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const op = "https://tp.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/abc?api-version=2024-11-30";
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") return new Response(null, { status: 202, headers: { "operation-location": op } });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify(analyzed), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createAzureDocumentIntelligenceProvider({ endpoint: "https://tp.cognitiveservices.azure.com/", key: "k" }, { fetch: fake, sleep: async () => {} });
    expect((await provider.extractReceipt({ bytes: new ArrayBuffer(1), contentType: "image/jpeg", filename: "r.jpg" })).total).toBe(43.3);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "DELETE"]);
    expect(calls[2].url).toBe(op);
  });

  it("US-only mode uses only the US reader, never falls back abroad, and needs no consent", () => {
    const env = { US_ONLY_READING: "true", AI: {}, GROQ_API_KEY: "g", AZURE_DI_ENDPOINT: "https://tp.cognitiveservices.azure.com", AZURE_DI_KEY: "k", AZURE_DI_REGION: "eastus" } as unknown as Env;
    const readers = activeDocumentReaders(env);
    expect(readers.map((r) => r.id)).toEqual(["azure-document-intelligence"]);
    expect(consentRequired(readers)).toBe(false);
    expect(getLlmProvider(env).name).toBe("azure-document-intelligence");
  });

  it("refuses a non-US region instead of reading", () => {
    const env = { US_ONLY_READING: "true", AZURE_DI_ENDPOINT: "https://x", AZURE_DI_KEY: "k", AZURE_DI_REGION: "westeurope" } as unknown as Env;
    expect(activeDocumentReaders(env)).toEqual([]);
    expect(() => getLlmProvider(env)).toThrow(/US AZURE_DI_REGION/);
  });

  it("still requires consent when a non-US reader is configured", () => {
    expect(consentRequired(activeDocumentReaders({ AI: {} } as unknown as Env))).toBe(true);
  });
});
