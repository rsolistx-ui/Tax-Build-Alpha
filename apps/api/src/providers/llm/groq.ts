import { normalizeExtraction, safeJson } from "./normalize";
import type { LlmProvider, ReceiptBusinessContext, ReceiptExtraction } from "./types";

// Groq currently documents Qwen 3.8 27B as vision-capable. Keep this in one
// place so a model retirement is a single explicit configuration repair.
const MODEL = "qwen/qwen3.8-27b";

export function createGroqProvider(apiKey: string): LlmProvider {
  return {
    name: "groq",
    model: MODEL,
    async extractReceipt({ bytes, contentType, filename, context }): Promise<ReceiptExtraction> {
      if (contentType === "application/pdf") {
        throw new Error("Groq image fallback does not accept PDF receipt evidence");
      }
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You extract accounting evidence from receipts. Return JSON only." },
            { role: "user", content: [
              { type: "text", text: receiptPrompt(filename, context) },
              { type: "image_url", image_url: { url: `data:${contentType || "image/jpeg"};base64,${arrayBufferToBase64(bytes)}` } },
            ] },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Groq error ${response.status}: ${(await response.text()).slice(0, 500)}`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const extraction = normalizeExtraction(safeJson(data.choices?.[0]?.message?.content ?? "{}"));
      if (extraction.total == null && extraction.lineItems.length === 0) throw new Error("Groq returned no usable receipt totals or line items");
      return extraction;
    },
  };
}

function receiptPrompt(filename: string, context?: ReceiptBusinessContext): string {
  const categories = context?.categories?.join(", ") || "use the best accounting category";
  return `Extract this receipt as JSON only. Do not invent missing values. Itemize every purchased line separately. Use client category names when appropriate: ${categories}.
{"date":"YYYY-MM-DD or null","merchant":"string or null","subtotal":number or null,"tax":number or null,"tip":number or null,"total":number or null,"currency":"USD","category":"string or null","confidence":0-1,"lineItems":[{"description":"string","quantity":number or null,"unitPrice":number or null,"amount":number or null,"category":"string or null","confidence":0-1}]}
Filename: ${filename}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); let binary = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
