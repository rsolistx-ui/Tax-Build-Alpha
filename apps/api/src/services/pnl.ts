/**
 * Pure P&L business logic, deliberately kept free of any database access so
 * the accounting rules (what counts as income/expense, what stays excluded,
 * how double-counting is prevented) can be unit tested without a live
 * Postgres connection.
 */

export type BusinessDisposition = "business_expense" | "business_income";

export type AnyDisposition =
  | BusinessDisposition
  | "personal"
  | "transfer"
  | "owner_contribution"
  | "owner_draw"
  | "loan"
  | "other_excluded"
  | "unclassified";

export type BankTxnForPnl = {
  id: string;
  date: string | null;
  amount: number;
  disposition: AnyDisposition;
  triage: string;
  categoryName: string | null;
};

export type DatedItem = { date: string | null };

/** Inclusive date-range filter. Items with no date never match a bounded range. */
export function filterByDateRange<T extends DatedItem>(
  items: T[],
  startDate: string | null,
  endDate: string | null,
): T[] {
  return items.filter((item) => {
    if (!item.date) return !startDate && !endDate;
    if (startDate && item.date < startDate) return false;
    if (endDate && item.date > endDate) return false;
    return true;
  });
}

/**
 * A bank transaction only becomes a bank-driven expense line when it has been
 * explicitly classified business_expense AND deliberately resolved without a
 * receipt (triage = no_receipt_required). A transaction matched to a filed
 * receipt (triage = matched) is excluded here even if classified
 * business_expense, because the matched receipt already supplies that
 * expense's detail; counting the bank side too would double it.
 */
export function selectBankExpenseTransactions(transactions: BankTxnForPnl[]): BankTxnForPnl[] {
  return transactions.filter(
    (t) => t.disposition === "business_expense" && t.triage === "no_receipt_required",
  );
}

/**
 * Business income comes only from bank transactions explicitly classified
 * business_income. Receipts never represent income in this system, and
 * triage state is irrelevant here: receipt-matching and income
 * classification are unrelated decisions.
 */
export function selectBankIncomeTransactions(transactions: BankTxnForPnl[]): BankTxnForPnl[] {
  return transactions.filter((t) => t.disposition === "business_income");
}

export function sumAmount(transactions: Array<{ amount: number }>): number {
  return transactions.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
}

export type ReceiptCategoryRow = { category: string; count: number; receiptCount: number; total: number };
export type BankCategoryRow = { category: string; count: number; total: number };
export type MergedCategoryRow = {
  category: string;
  count: number;
  receiptCount: number;
  bankCount: number;
  total: number;
};

/**
 * Combines receipt-evidence category totals with bank-only (no-receipt)
 * expense category totals into one breakdown, matching by category name
 * case-insensitively so Phyllis sees one number per category regardless of
 * which evidence backs it.
 */
export function mergeExpenseCategories(
  receiptRows: ReceiptCategoryRow[],
  bankRows: BankCategoryRow[],
): MergedCategoryRow[] {
  const map = new Map<string, MergedCategoryRow>();

  for (const row of receiptRows) {
    map.set(row.category.toLowerCase(), {
      category: row.category,
      count: row.count,
      receiptCount: row.receiptCount,
      bankCount: 0,
      total: Number(row.total),
    });
  }

  for (const row of bankRows) {
    const key = row.category.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.count += row.count;
      existing.bankCount += row.count;
      existing.total += Number(row.total);
    } else {
      map.set(key, {
        category: row.category,
        count: row.count,
        receiptCount: 0,
        bankCount: row.count,
        total: Number(row.total),
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

export type PnlCompleteness = {
  unclassifiedCount: number;
  unresolvedTriageCount: number;
  isComplete: boolean;
};

const UNRESOLVED_TRIAGE_STATES = new Set(["unmatched", "needs_review", "likely_match", "receipt_pending"]);

export function isUnresolvedTriage(triage: string): boolean {
  return UNRESOLVED_TRIAGE_STATES.has(triage);
}

export function computeCompleteness(transactions: Array<{ disposition: AnyDisposition; triage: string }>): PnlCompleteness {
  const unclassifiedCount = transactions.filter((t) => t.disposition === "unclassified").length;
  const unresolvedTriageCount = transactions.filter((t) => isUnresolvedTriage(t.triage)).length;
  return {
    unclassifiedCount,
    unresolvedTriageCount,
    isComplete: unclassifiedCount === 0 && unresolvedTriageCount === 0,
  };
}
