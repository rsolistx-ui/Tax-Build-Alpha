export type ReceiptMatchCandidate = {
  id: string;
  extracted_date: string | null;
  extracted_merchant: string | null;
  extracted_total: number | null;
  filename: string;
};

export type MatchSuggestion = {
  receiptId: string;
  score: number;
  reason: string;
  ambiguous: boolean;
} | null;

export function suggestReceiptMatch(
  transaction: { date: string; description: string; amount: number },
  receipts: ReceiptMatchCandidate[],
): MatchSuggestion {
  const candidates = receipts
    .map((receipt) => scoreCandidate(transaction, receipt))
    .filter((candidate): candidate is NonNullable<ReturnType<typeof scoreCandidate>> => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.78) return null;
  const second = candidates[1];
  const ambiguous = Boolean(second && second.score >= 0.7 && best.score - second.score <= 0.05);

  return {
    receiptId: best.receipt.id,
    score: best.score,
    reason: best.reason,
    ambiguous,
  };
}

function scoreCandidate(
  transaction: { date: string; description: string; amount: number },
  receipt: ReceiptMatchCandidate,
) {
  if (receipt.extracted_total === null || receipt.extracted_total === undefined || !receipt.extracted_date) return null;
  const amountDifference = Math.abs(Math.abs(transaction.amount) - Math.abs(Number(receipt.extracted_total)));
  if (amountDifference > 0.02) return null;

  const dayDifference = daysBetween(transaction.date, receipt.extracted_date);
  if (dayDifference > 7) return null;

  let score = 0.6;
  const reasons = [`amount within $${amountDifference.toFixed(2)}`];

  if (dayDifference === 0) {
    score += 0.25;
    reasons.push("same date");
  } else if (dayDifference <= 1) {
    score += 0.2;
    reasons.push("date within 1 day");
  } else if (dayDifference <= 3) {
    score += 0.14;
    reasons.push(`date within ${dayDifference} days`);
  } else {
    score += 0.08;
    reasons.push(`date within ${dayDifference} days`);
  }

  const merchantScore = textSimilarity(transaction.description, receipt.extracted_merchant || "");
  if (merchantScore > 0) {
    score += merchantScore * 0.15;
    reasons.push(`merchant similarity ${Math.round(merchantScore * 100)}%`);
  }

  return {
    receipt,
    score: Math.min(1, Math.round(score * 10000) / 10000),
    reason: reasons.join(", "),
  };
}

function daysBetween(a: string, b: string): number {
  const aTime = Date.parse(`${a}T00:00:00Z`);
  const bTime = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(aTime - bTime) / 86400000);
}

function textSimilarity(description: string, merchant: string): number {
  const merchantTokens = tokens(merchant);
  if (merchantTokens.length === 0) return 0;
  const descriptionSet = new Set(tokens(description));
  const hits = merchantTokens.filter((token) => descriptionSet.has(token)).length;
  return hits / merchantTokens.length;
}

function tokens(value: string): string[] {
  const ignored = new Set(["pos", "debit", "credit", "card", "purchase", "payment", "visa", "mastercard", "mc", "check"]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !ignored.has(token));
}
