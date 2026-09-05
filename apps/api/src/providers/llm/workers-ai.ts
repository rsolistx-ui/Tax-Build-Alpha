import type { WorkersAiBinding } from "../../env";
import { normalizeExtraction, safeJson } from "./normalize";
import type { LlmProvider, ReceiptBusinessContext, ReceiptExtraction } from "./types";

export const WORKERS_AI_MODEL = "@cf/qwen/qwen3.8-27b";

export function createWorkersAiProvider(ai: WorkersAiBinding): LlmProvider {
  return {
    name: "workers-ai",
    model: WORKERS_AI_MODEL,
    async extractReceipt({ bytes, contentType, filename, context }): Promise<ReceiptExtraction> {
      const prompt = receiptPrompt(filename, context);
      const text = contentType === "application/pdf"
        ? await extractPdf(ai, bytes, filename, prompt)
        : await extractImage(ai, bytes, contentType, prompt);
      const extraction = normalizeExtraction(safeJson(text));
      if (extraction.total == null && extraction.lineItems.length === 0) {
        throw new Error("Workers AI returned no usable receipt totals or line items");
      }
      return extraction;
    },
  };
}

async function extractPdf(
  ai: WorkersAiBinding,
  bytes: ArrayBuffer,
  filename: string,
  prompt: string,
): Promise<string> {
  const converted = await ai.toMarkdown(
    {
      name: filename,
      blob: new Blob([bytes], { type: "application/pdf" }),
    },
    {
      conversionOptions: {
        output: { format: "text" },
        pdf: { metadata: false },
      },
    },
  );

  const result = Array.isArray(converted) ? converted[0] : converted;
  if (!result || result.format === "error" || !result.data?.trim()) {
    throw new Error(result?.error || "Workers AI could not convert the PDF to text");
  }

  const response = await ai.run(WORKERS_AI_MODEL, {
    messages: [
      { role: "system", content: "You extract accounting evidence from receipts. Return JSON only." },
      {
        role: "user",
        content: `${prompt}\n\nReceipt text from Cloudflare document conversion:\n${result.data.slice(0, 80000)}`,
      },
    ],
    temperature: 0.1,
    max_completion_tokens: 5000,
    response_format: { type: "json_object" },
  });
  return responseText(response);
}

async function extractImage(
  ai: WorkersAiBinding,
  bytes: ArrayBuffer,
  contentType: string,
  prompt: string,
): Promise<string> {
  const dataUri = `data:${contentType || "image/jpeg"};base64,${arrayBufferToBase64(bytes)}`;
  const response = await ai.run(WORKERS_AI_MODEL, {
    messages: [
      { role: "system", content: "You extract accounting evidence from receipts. Return JSON only." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
    temperature: 0.1,
    max_completion_tokens: 5000,
    response_format: { type: "json_object" },
  });
  return responseText(response);
}

function receiptPrompt(filename: string, context?: ReceiptBusinessContext): string {
  const categoryHint = context?.categories?.length ? context.categories.join(", ") : "use the best accounting category";
  const business = [
    context?.clientName ? `Client: ${context.clientName}` : "",
    context?.entityType ? `Entity type: ${context.entityType}` : "",
    context?.industry ? `Industry: ${context.industry}` : "",
    context?.state ? `State: ${context.state}` : "",
    context?.accountingBasis ? `Accounting basis: ${context.accountingBasis}` : "",
  ].filter(Boolean).join("\n");

  return `Extract this receipt into the exact JSON shape below. Do not invent missing values. Preserve each purchased line as its own line item. Monetary values must be numbers without currency symbols. Category values should use one of these client categories when appropriate: ${categoryHint}.

{
  "date": "YYYY-MM-DD or null",
  "merchant": "string or null",
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00,
  "currency": "USD",
  "category": "string or null",
  "confidence": 0.0,
  "lineItems": [
    {
      "description": "exact concise item description",
      "quantity": 1,
      "unitPrice": 0.00,
      "amount": 0.00,
      "category": "string or null",
      "confidence": 0.0
    }
  ]
}

Filename: ${filename}
${business}`;
}

function responseText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "{}";
  const value = response as Record<string, unknown>;
  if (typeof value.response === "string") return value.response;
  if (typeof value.result === "string") return value.result;

  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return message.content;
  if (typeof first?.text === "string") return first.text;
  return "{}";
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
