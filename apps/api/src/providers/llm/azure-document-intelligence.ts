import type { LlmProvider, ReceiptExtraction, ReceiptLineItem } from "./types";

/**
 * US-only receipt reading with Azure AI Document Intelligence (prebuilt-receipt,
 * REST API 2024-11-30). Microsoft processes input "in the same region where the
 * Document Intelligence resource was created" and keeps input and results for up to
 * 24 hours; this provider deletes them as soon as the result is read.
 * Source: learn.microsoft.com/azure/foundry/responsible-ai/document-intelligence/data-privacy-security
 *
 * The resource must be created in a US region; AZURE_DI_REGION records that and
 * is checked against this list.
 */
export const US_AZURE_REGIONS = [
  "eastus", "eastus2", "centralus", "northcentralus", "southcentralus", "westcentralus", "westus", "westus2", "westus3",
];
const API_VERSION = "2024-11-30";
const MODEL = "prebuilt-receipt";

type Field = { valueString?: string; valueDate?: string; valueNumber?: number; valueCurrency?: { amount?: number; currencyCode?: string }; valueArray?: Field[]; valueObject?: Record<string, Field>; content?: string; confidence?: number };
type AnalyzeResult = { status: string; error?: { message?: string }; analyzeResult?: { documents?: Array<{ fields?: Record<string, Field>; confidence?: number }> } };

const money = (f?: Field) => f?.valueCurrency?.amount ?? f?.valueNumber ?? null;

export function mapAzureReceipt(result: AnalyzeResult): ReceiptExtraction {
  const doc = result.analyzeResult?.documents?.[0];
  const f = doc?.fields ?? {};
  const lineItems: ReceiptLineItem[] = (f.Items?.valueArray ?? []).map((item) => {
    const o = item.valueObject ?? {};
    return {
      description: o.Description?.valueString ?? o.Description?.content ?? "",
      quantity: o.Quantity?.valueNumber ?? null,
      unitPrice: money(o.Price),
      amount: money(o.TotalPrice),
      category: null,
      confidence: item.confidence ?? 0,
    };
  });
  return {
    date: f.TransactionDate?.valueDate ?? null,
    merchant: f.MerchantName?.valueString ?? f.MerchantName?.content ?? null,
    subtotal: money(f.Subtotal),
    tax: money(f.TotalTax),
    tip: money(f.Tip),
    total: money(f.Total),
    currency: f.Total?.valueCurrency?.currencyCode ?? "USD",
    // The firm's rules and correction memory assign the category; this service only reads fields.
    category: null,
    confidence: doc?.confidence ?? 0,
    lineItems,
  };
}

export function createAzureDocumentIntelligenceProvider(config: { endpoint: string; key: string }, deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): LlmProvider {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = config.endpoint.replace(/\/+$/, "");
  const headers = { "Ocp-Apim-Subscription-Key": config.key };
  return {
    name: "azure-document-intelligence",
    model: MODEL,
    async extractReceipt({ bytes, contentType }) {
      const body = Array.isArray(bytes) ? bytes[0] : bytes;
      const start = await doFetch(`${base}/documentintelligence/documentModels/${MODEL}:analyze?api-version=${API_VERSION}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType || "application/octet-stream" },
        body,
      });
      if (start.status !== 202) throw new Error(`Document Intelligence error ${start.status}: ${(await start.text()).slice(0, 300)}`);
      const operation = start.headers.get("operation-location");
      if (!operation) throw new Error("Document Intelligence did not return an operation location");

      let result: AnalyzeResult | null = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(attempt === 0 ? 500 : 1000);
        const poll = await doFetch(operation, { headers });
        if (!poll.ok) throw new Error(`Document Intelligence poll error ${poll.status}`);
        result = await poll.json() as AnalyzeResult;
        if (result.status === "succeeded" || result.status === "failed") break;
      }
      // Delete the submitted document and result now instead of after 24 hours.
      await doFetch(operation.split("?")[0] + `?api-version=${API_VERSION}`, { method: "DELETE", headers }).catch(() => undefined);

      if (!result || result.status !== "succeeded") throw new Error(`Document Intelligence did not finish: ${result?.error?.message ?? result?.status ?? "timeout"}`);
      const extraction = mapAzureReceipt(result);
      if (extraction.total == null && extraction.lineItems.length === 0) throw new Error("Document Intelligence found no totals or line items");
      return extraction;
    },
  };
}
