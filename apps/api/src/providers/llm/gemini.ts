import { normalizeExtraction, safeJson } from "./normalize";
import type { LlmProvider, ReceiptBusinessContext, ReceiptExtraction } from "./types";

const MODEL = "gemini-2.0-flash";

export function createGeminiProvider(apiKey: string): LlmProvider {
  return {
    name: "gemini",
    model: MODEL,
    async extractReceipt({ bytes, contentType, filename, context }): Promise<ReceiptExtraction> {
      const firstBytes = Array.isArray(bytes) ? bytes[0] : bytes;
      const b64 = arrayBufferToBase64(firstBytes);
      const prompt = buildPrompt(filename, context);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: contentType || "image/jpeg", data: b64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 500)}`);
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const extraction = normalizeExtraction(safeJson(text));
      if (extraction.total == null && extraction.lineItems.length === 0) {
        throw new Error("Gemini returned no usable receipt totals or line items");
      }
      return extraction;
    },
  };
}

function buildPrompt(filename: string, context?: ReceiptBusinessContext): string {
  const categories = context?.categories?.join(", ") || "use the best accounting category";
  const rulesHint = context?.markdownRules
    ? `\n\nApply the following professional categorization and tax bucketing rules strictly:\n${context.markdownRules}\n`
    : "";

  return `Extract this receipt as JSON only. Do not invent missing values. Itemize every purchased line separately. Use client category names when appropriate: ${categories}.${rulesHint}
{
  "date":"YYYY-MM-DD or null",
  "merchant":"string or null",
  "paymentMethod":"credit_card | debit_card | cash | check | null",
  "cardLast4":"4 digits or null",
  "subtotal":number or null,
  "tax":number or null,
  "tip":number or null,
  "total":number or null,
  "currency":"USD",
  "category":"string or null",
  "confidence":0-1,
  "lineItems":[{"description":"string","quantity":number or null,"unitPrice":number or null,"amount":number or null,"category":"string or null","confidence":0-1}]
}
Filename: ${filename}
Client: ${context?.clientName ?? "unknown"}
Entity Type: ${context?.entityType ?? "unknown"}
Industry: ${context?.industry ?? "unknown"}
State: ${context?.state ?? "unknown"}
Accounting Basis: ${context?.accountingBasis ?? "unknown"}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
