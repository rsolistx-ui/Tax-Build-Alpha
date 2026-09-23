import type { ReceiptBusinessContext, ReceiptExtraction } from "./types";

/**
 * Optional US-only category suggestions from an Azure OpenAI model deployed as a
 * "Standard" (regional) deployment in a US region, which processes requests in that
 * region; "Global" and "Data Zone" deployments may route elsewhere and are refused.
 * Only the text already read from the receipt is sent (merchant, line items, amounts),
 * never the image. A category is a suggestion the preparer reviews.
 */
export const US_OPENAI_REGIONS = ["eastus", "eastus2", "northcentralus", "southcentralus", "westus", "westus3", "centralus"];
const API_VERSION = "2024-10-21";

export type CategorizerConfig = { endpoint: string; key: string; deployment: string };

export async function suggestCategory(
  config: CategorizerConfig,
  extraction: ReceiptExtraction,
  context: ReceiptBusinessContext | undefined,
  deps: { fetch?: typeof fetch } = {},
): Promise<string | null> {
  const categories = context?.categories ?? [];
  if (!categories.length) return null;
  const doFetch = deps.fetch ?? fetch;
  const receipt = {
    merchant: extraction.merchant,
    total: extraction.total,
    items: extraction.lineItems.slice(0, 20).map((i) => ({ description: i.description, amount: i.amount })),
  };
  const response = await doFetch(`${config.endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=${API_VERSION}`, {
    method: "POST",
    headers: { "api-key": config.key, "Content-Type": "application/json" },
    body: JSON.stringify({
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You suggest a bookkeeping category for a receipt. Answer only with JSON {\"category\": <one of the allowed slugs or null>}. Do not decide deductibility." },
        { role: "user", content: JSON.stringify({ allowedCategories: categories, industry: context?.industry ?? null, firmRules: context?.markdownRules ?? null, receipt }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Category suggestion error ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { category?: unknown };
    return typeof parsed.category === "string" && categories.includes(parsed.category) ? parsed.category : null;
  } catch {
    return null;
  }
}
