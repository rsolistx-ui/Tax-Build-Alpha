import type { LlmProvider, ReceiptExtraction } from "./types";

const MODEL = "gemini-2.0-flash";

/**
 * Thin adapter: send image/PDF bytes to Gemini Flash.
 * Heavy PDF CPU parsing is intentionally avoided in the Worker —
 * Gemini accepts PDF/image inline; Worker only forwards bytes.
 */
export function createGeminiProvider(apiKey: string): LlmProvider {
  return {
    name: "gemini",
    async extractReceipt({ bytes, contentType, filename }): Promise<ReceiptExtraction> {
      const b64 = arrayBufferToBase64(bytes);
      const prompt = `Extract receipt fields as JSON only (no markdown):
{"date":"YYYY-MM-DD or null","merchant":"string or null","amount":number or null,"currency":"USD","category":"hotel|travel|food|supplies|other or null","confidence":0-1}
Filename hint: ${filename}`;

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
        throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 400)}`);
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      return normalizeExtraction(safeJson(text));
    },
  };
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeExtraction(raw: Record<string, unknown>): ReceiptExtraction {
  const amount = raw.amount;
  return {
    date: typeof raw.date === "string" ? raw.date : null,
    merchant: typeof raw.merchant === "string" ? raw.merchant : null,
    amount: typeof amount === "number" ? amount : amount != null ? Number(amount) : null,
    currency: typeof raw.currency === "string" ? raw.currency : "USD",
    category: typeof raw.category === "string" ? raw.category : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
  };
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
