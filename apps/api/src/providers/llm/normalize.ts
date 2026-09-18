import type { ReceiptExtraction, ReceiptLineItem } from "./types";

export function safeJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
}

export function normalizeExtraction(raw: Record<string, unknown>): ReceiptExtraction {
  const rawItems = Array.isArray(raw.lineItems)
    ? raw.lineItems
    : Array.isArray(raw.line_items)
      ? raw.line_items
      : [];

  return {
    date: stringOrNull(raw.date),
    merchant: stringOrNull(raw.merchant),
    paymentMethod: stringOrNull(raw.paymentMethod ?? raw.payment_method),
    cardLast4: extractLast4(raw.cardLast4 ?? raw.card_last4 ?? raw.last4 ?? raw.card_number),
    subtotal: numberOrNull(raw.subtotal),
    tax: numberOrNull(raw.tax),
    tip: numberOrNull(raw.tip),
    total: numberOrNull(raw.total ?? raw.amount),
    currency: typeof raw.currency === "string" ? raw.currency.toUpperCase().slice(0, 3) : "USD",
    category: stringOrNull(raw.category),
    confidence: clampConfidence(raw.confidence),
    lineItems: rawItems.map(normalizeLineItem).filter((item) => item.description || item.amount != null),
  };
}

function extractLast4(value: unknown): string | null {
  if (!value) return null;
  const str = String(value).trim();
  const digits = str.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return null;
}

function normalizeLineItem(value: unknown): ReceiptLineItem {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    description: typeof item.description === "string" ? item.description.trim() : "",
    quantity: numberOrNull(item.quantity),
    unitPrice: numberOrNull(item.unitPrice ?? item.unit_price),
    amount: numberOrNull(item.amount),
    category: stringOrNull(item.category),
    confidence: clampConfidence(item.confidence),
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}
