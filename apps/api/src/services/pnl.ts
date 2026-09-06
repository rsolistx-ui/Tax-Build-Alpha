/**
 * Pure P&L business logic, deliberately kept free of any database access so
 * the accounting rules (signed aggregation, what counts as income/expense,
 * what stays excluded, how double-counting and disposition conflicts are
 * prevented) can be unit tested without a live Postgres connection.
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
  categoryId: string | null;
  categoryName: string | null;
  currency: string;
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

/**
 * Net business expense from bank activity. Amounts are signed, normalized
 * bank amounts (negative = debit/cash-out, positive = credit/cash-in). A
 * normal expense debit increases the total; a refund, reversal, or
 * chargeback on the same classification (a positive amount) reduces it.
 * Never take an absolute value here - the sign is the accounting direction.
 */
export function sumBankExpenseAmount(transactions: Array<{ amount: number }>): number {
  return transactions.reduce((sum, t) => sum - Number(t.amount), 0);
}

/**
 * Net business income from bank activity. A normal deposit (positive amount)
 * increases the total; a reversal or chargeback (a negative amount) reduces
 * it.
 */
export function sumBankIncomeAmount(transactions: Array<{ amount: number }>): number {
  return transactions.reduce((sum, t) => sum + Number(t.amount), 0);
}

/**
 * A filed receipt is only valid business-expense evidence when its matched
 * bank transaction's disposition does not contradict that. unclassified is
 * not a contradiction (the professional simply hasn't decided yet); the
 * other non-expense dispositions are.
 */
const CONTRADICTS_BUSINESS_EXPENSE = new Set<AnyDisposition>([
  "personal",
  "transfer",
  "owner_contribution",
  "owner_draw",
  "loan",
  "other_excluded",
  "business_income",
]);

export function isReceiptDispositionConflict(matchedBankDisposition: AnyDisposition | null): boolean {
  return matchedBankDisposition !== null && CONTRADICTS_BUSINESS_EXPENSE.has(matchedBankDisposition);
}

export type ReceiptCategoryRow = {
  categoryId: string | null;
  category: string;
  count: number;
  receiptCount: number;
  total: number;
};
export type BankCategoryRow = {
  categoryId: string | null;
  category: string;
  count: number;
  total: number;
};
export type MergedCategoryRow = {
  categoryId: string | null;
  category: string;
  count: number;
  receiptCount: number;
  bankCount: number;
  total: number;
};

const UNCATEGORIZED_KEY = "__uncategorized__";

function categoryKey(categoryId: string | null): string {
  return categoryId ?? UNCATEGORIZED_KEY;
}

/**
 * Combines receipt-evidence category totals with bank-only (no-receipt)
 * expense category totals into one breakdown, matched by canonical category
 * id (never by display-string coincidence, so "Office Supplies" and
 * "office-supplies" are always the same category and never two).
 */
export function mergeExpenseCategories(
  receiptRows: ReceiptCategoryRow[],
  bankRows: BankCategoryRow[],
): MergedCategoryRow[] {
  const map = new Map<string, MergedCategoryRow>();

  for (const row of receiptRows) {
    map.set(categoryKey(row.categoryId), {
      categoryId: row.categoryId,
      category: row.category,
      count: row.count,
      receiptCount: row.receiptCount,
      bankCount: 0,
      total: Number(row.total),
    });
  }

  for (const row of bankRows) {
    const key = categoryKey(row.categoryId);
    const existing = map.get(key);
    if (existing) {
      existing.count += row.count;
      existing.bankCount += row.count;
      existing.total += Number(row.total);
    } else {
      map.set(key, {
        categoryId: row.categoryId,
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

const UNRESOLVED_TRIAGE_STATES = new Set(["unmatched", "needs_review", "likely_match", "receipt_pending"]);

export function isUnresolvedTriage(triage: string): boolean {
  return UNRESOLVED_TRIAGE_STATES.has(triage);
}

export type PnlCompleteness = {
  unclassifiedCount: number;
  unresolvedTriageCount: number;
  uncategorizedCount: number;
  currencyConflictCount: number;
  isComplete: boolean;
};

/**
 * A report is only complete when nothing is left for the professional to
 * decide: every transaction has a disposition, every bank exception is
 * resolved, every material business item is categorized, and nothing is
 * sitting in a currency the report can't safely combine. Excluded/personal
 * activity is never required to carry an expense category.
 */
export function computeCompleteness(input: {
  transactions: Array<{ disposition: AnyDisposition; triage: string; categoryId: string | null }>;
  uncategorizedReceiptLineCount: number;
  currencyConflictCount: number;
}): PnlCompleteness {
  const unclassifiedCount = input.transactions.filter((t) => t.disposition === "unclassified").length;
  const unresolvedTriageCount = input.transactions.filter((t) => isUnresolvedTriage(t.triage)).length;
  const uncategorizedBankCount = input.transactions.filter(
    (t) => (t.disposition === "business_expense" || t.disposition === "business_income") && !t.categoryId,
  ).length;
  const uncategorizedCount = uncategorizedBankCount + input.uncategorizedReceiptLineCount;

  return {
    unclassifiedCount,
    unresolvedTriageCount,
    uncategorizedCount,
    currencyConflictCount: input.currencyConflictCount,
    isComplete:
      unclassifiedCount === 0 &&
      unresolvedTriageCount === 0 &&
      uncategorizedCount === 0 &&
      input.currencyConflictCount === 0,
  };
}

/**
 * The paid alpha has no AR/AP/invoice recognition machinery, so it can only
 * ever produce a cash-derived report. Accrual must never be presented as if
 * it were a real accrual-basis P&L.
 */
export function isAccrualBasisSupported(accountingBasis: string | null): boolean {
  return accountingBasis !== "accrual";
}

/** Strict YYYY-MM-DD validation including real calendar validity (rejects 2026-13-01, 2026-02-30, etc). */
export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isCurrencyMismatch(itemCurrency: string, clientCurrency: string): boolean {
  return itemCurrency.trim().toUpperCase() !== clientCurrency.trim().toUpperCase();
}
